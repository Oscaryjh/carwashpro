import { prisma } from "../prisma";
import { normalizeMalaysiaWhatsAppPhone } from "../whatsappDeepLink";
import {
  getConnectorSession,
  logoutConnectorSession,
  reconnectConnectorSession,
  sendConnectorTextMessage,
  type ConnectorStatusValue,
} from "./connector-client";
import { encodeWhatsAppStoredText } from "./message-codec";

export type WhatsAppStartResult = {
  status: "DISCONNECTED" | "QR_REQUIRED" | "CONNECTED" | "ERROR";
  qrCodeText?: string;
  pairingPhone?: string | null;
  pairingCodeText?: string | null;
  phoneNumber?: string;
  errorMessage?: string;
};

export async function startWhatsAppSession(
  businessId: string,
  input: { pairingPhone?: string | null } = {},
): Promise<WhatsAppStartResult> {
  const pairingPhone = input.pairingPhone
    ? normalizeMalaysiaWhatsAppPhone(input.pairingPhone)
    : null;

  try {
    await reconnectConnectorSession(businessId);
    const session = await getConnectorSession(businessId);
    const result = toStartResult(session.status, {
      phoneNumber: session.phone ?? undefined,
      pairingPhone,
    });

    await syncConnectionState(businessId, result);
    return result;
  } catch (error) {
    const result = {
      status: "ERROR",
      pairingPhone,
      errorMessage: getErrorMessage(error) || "Unable to reach WhatsApp connector.",
    } satisfies WhatsAppStartResult;
    await syncConnectionState(businessId, result);
    return result;
  }
}

export async function disconnectWhatsAppSession(businessId: string) {
  await logoutConnectorSession(businessId);
  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      disconnectedAt: new Date(),
      lastSeenAt: new Date(),
      status: "DISCONNECTED",
    },
    update: {
      disconnectedAt: new Date(),
      errorMessage: null,
      lastSeenAt: new Date(),
      pairingCodeText: null,
      pairingPhone: null,
      pairingRequestedAt: null,
      phoneNumber: null,
      qrCodeText: null,
      sessionName: null,
      status: "DISCONNECTED",
    },
  });
}

export async function sendWhatsAppTextMessage(input: {
  businessId: string;
  conversationId: string;
  body: string;
  sentByUserId: string;
}) {
  const conversation = await prisma.whatsAppConversation.findFirstOrThrow({
    where: {
      id: input.conversationId,
      businessId: input.businessId,
    },
  });
  const phone = resolveConversationPhone(conversation.remoteJid, conversation.phone);
  const sent = await sendConnectorTextMessage({
    businessId: input.businessId,
    phone,
    message: input.body,
  });
  const externalMessageId = sent.messageId;
  const storedBody = toStoredMessageBody(input.body);

  await prisma.$transaction([
    prisma.whatsAppChatMessage.create({
      data: {
        businessId: input.businessId,
        instanceId: conversation.instanceId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        sentByUserId: input.sentByUserId,
        direction: "OUTBOUND",
        body: storedBody,
        status: "SENT",
        externalMessageId,
      },
    }),
    prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageBody: storedBody,
        lastMessageAt: new Date(),
      },
    }),
  ]);

  return { externalMessageId };
}

export async function sendWhatsAppDocumentMessage(input: {
  businessId: string;
  conversationId: string;
  body: string;
  sentByUserId: string;
  document: Buffer;
  fileName: string;
  mimeType: string;
}) {
  const conversation = await prisma.whatsAppConversation.findFirstOrThrow({
    where: {
      id: input.conversationId,
      businessId: input.businessId,
    },
  });
  const phone = resolveConversationPhone(conversation.remoteJid, conversation.phone);
  const sent = await sendConnectorTextMessage({
    businessId: input.businessId,
    phone,
    message: input.body || input.fileName,
  });
  const externalMessageId = sent.messageId;
  const storedBody = toStoredMessageBody(input.body || input.fileName);

  await prisma.$transaction([
    prisma.whatsAppChatMessage.create({
      data: {
        businessId: input.businessId,
        instanceId: conversation.instanceId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        sentByUserId: input.sentByUserId,
        direction: "OUTBOUND",
        messageType: "DOCUMENT",
        body: storedBody,
        mediaFileName: input.fileName,
        mediaMimeType: input.mimeType,
        status: "SENT",
        externalMessageId,
      },
    }),
    prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageBody: storedBody,
        lastMessageAt: new Date(),
      },
    }),
  ]);

  return { externalMessageId };
}

function toStartResult(
  status: ConnectorStatusValue,
  input: { phoneNumber?: string; pairingPhone?: string | null },
): WhatsAppStartResult {
  if (status === "connected") {
    return {
      status: "CONNECTED",
      phoneNumber: input.phoneNumber,
    };
  }

  if (status === "qr") {
    return {
      status: "QR_REQUIRED",
      pairingPhone: input.pairingPhone ?? null,
    };
  }

  if (status === "session_expired" || status === "error") {
    return {
      status: "ERROR",
      pairingPhone: input.pairingPhone ?? null,
      errorMessage: "WhatsApp session needs to be reconnected.",
    };
  }

  return {
    status: "DISCONNECTED",
    pairingPhone: input.pairingPhone ?? null,
  };
}

async function syncConnectionState(
  businessId: string,
  result: WhatsAppStartResult,
) {
  await prisma.whatsAppConnection.upsert({
    where: { businessId },
    create: {
      businessId,
      connectedAt: result.status === "CONNECTED" ? new Date() : null,
      errorMessage: result.errorMessage ?? null,
      lastSeenAt: new Date(),
      pairingCodeText: result.pairingCodeText ?? null,
      pairingPhone: result.pairingPhone ?? null,
      phoneNumber: result.phoneNumber ?? null,
      qrCodeText: result.qrCodeText ?? null,
      status: result.status,
    },
    update: {
      connectedAt: result.status === "CONNECTED" ? new Date() : undefined,
      errorMessage: result.errorMessage ?? null,
      lastSeenAt: new Date(),
      pairingCodeText: result.pairingCodeText ?? null,
      pairingPhone: result.pairingPhone ?? null,
      phoneNumber: result.phoneNumber ?? null,
      qrCodeText: result.qrCodeText ?? null,
      status: result.status,
    },
  });
}

function resolveConversationPhone(remoteJid: string | null, phone: string) {
  const rawPhone = remoteJid?.endsWith("@s.whatsapp.net")
    ? remoteJid.replace("@s.whatsapp.net", "")
    : phone;
  const normalizedPhone = normalizeMalaysiaWhatsAppPhone(rawPhone);

  if (!normalizedPhone) {
    throw new Error("Conversation has no valid WhatsApp phone number.");
  }

  return normalizedPhone;
}

function toStoredMessageBody(body: string) {
  return encodeWhatsAppStoredText(body) ?? body;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}
