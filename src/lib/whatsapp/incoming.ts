import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import { getDefaultWhatsAppInstanceId, normalizeWhatsAppInstanceId } from "./instance";
import { encodeWhatsAppStoredText } from "./message-codec";

export type IncomingWhatsAppMessageInput = {
  businessId?: string | null;
  direction?: "INBOUND" | "OUTBOUND";
  instanceId?: string | null;
  body: string;
  from: string;
  messageId: string;
  messageType: "audio" | "document" | "image" | "text";
  mediaBase64?: string | null;
  mediaFileName?: string | null;
  mediaMimeType?: string | null;
  pushName?: string | null;
  remoteJid?: string | null;
  rawMessageJson?: unknown | null;
  timestamp?: string | null;
};

export async function recordIncomingWhatsAppMessage(
  input: IncomingWhatsAppMessageInput,
) {
  const businessId = await resolveIncomingBusinessId(input.businessId);
  const instanceId = normalizeWhatsAppInstanceId(
    input.instanceId ?? getDefaultWhatsAppInstanceId(),
  );
  const phone = normalizeMalaysiaWhatsAppPhone(input.from);

  if (!phone) {
    throw new Error("Incoming WhatsApp message has no valid sender phone.");
  }

  const customer = await findCustomerByPhone(businessId, phone);
  const storedBody = encodeWhatsAppStoredText(input.body) ?? input.body;
  const messageDate = parseIncomingTimestamp(input.timestamp) ?? new Date();
  const remoteJid = input.remoteJid?.trim() || `${phone}@s.whatsapp.net`;
  const direction = input.direction ?? "INBOUND";
  const isInbound = direction === "INBOUND";
  const incomingDisplayName = customer?.name ?? input.pushName?.trim() ?? phone;
  const chatMessageType =
    input.messageType === "audio"
      ? "AUDIO"
      : input.messageType === "document"
        ? "DOCUMENT"
        : input.messageType === "image"
          ? "IMAGE"
          : "TEXT";
  const mediaUrl =
    chatMessageType === "AUDIO" ||
    chatMessageType === "DOCUMENT" ||
    chatMessageType === "IMAGE"
      ? await saveIncomingMediaAttachment({
          mediaBase64: input.mediaBase64 ?? null,
          mediaFileName: input.mediaFileName ?? null,
          mediaMimeType: input.mediaMimeType ?? null,
          messageId: input.messageId,
          type: chatMessageType,
        })
      : null;

  return prisma.$transaction(async (tx) => {
    const existingMessage = await tx.whatsAppChatMessage.findFirst({
      where: {
        businessId,
        instanceId,
        externalMessageId: input.messageId,
      },
      select: { id: true },
    });

    if (existingMessage) {
      return {
        created: false,
        messageId: existingMessage.id,
      };
    }

    const conversation = await tx.whatsAppConversation.upsert({
      where: {
        businessId_instanceId_phone: {
          businessId,
          instanceId,
          phone,
        },
      },
      create: {
        businessId,
        instanceId,
        customerId: customer?.id ?? null,
        phone,
        remoteJid,
        displayName: isInbound ? incomingDisplayName : phone,
        lastMessageBody: storedBody,
        lastMessageAt: messageDate,
        unreadCount: isInbound ? 1 : 0,
      },
      update: {
        customerId: customer?.id,
        remoteJid,
        ...(isInbound ? { displayName: incomingDisplayName } : {}),
        lastMessageBody: storedBody,
        lastMessageAt: messageDate,
        ...(isInbound ? { unreadCount: { increment: 1 } } : {}),
      },
    });

    const chatMessage = await tx.whatsAppChatMessage.create({
      data: {
        businessId,
        instanceId,
        conversationId: conversation.id,
        customerId: customer?.id ?? null,
        direction,
        messageType: chatMessageType,
        body: storedBody,
        mediaUrl,
        mediaFileName: input.mediaFileName ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        status: isInbound ? "RECEIVED" : "SENT",
        externalMessageId: input.messageId,
        rawMessageJson: toPrismaJson(input.rawMessageJson),
        createdAt: messageDate,
      },
      select: {
        id: true,
      },
    });

    return {
      created: true,
      conversationId: conversation.id,
      messageId: chatMessage.id,
    };
  });
}

async function saveIncomingMediaAttachment(input: {
  mediaBase64: string | null;
  mediaFileName: string | null;
  mediaMimeType: string | null;
  messageId: string;
  type: "AUDIO" | "DOCUMENT" | "IMAGE";
}) {
  if (!input.mediaBase64) {
    return null;
  }

  const uploadFolder =
    input.type === "IMAGE"
      ? "whatsapp-images"
      : input.type === "DOCUMENT"
        ? "whatsapp-documents"
        : "whatsapp-audio";
  const uploadDir = path.join(process.cwd(), "public", "uploads", uploadFolder);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension =
    input.type === "IMAGE"
      ? getImageExtension(input.mediaFileName, input.mediaMimeType)
      : input.type === "DOCUMENT"
        ? getDocumentExtension(input.mediaFileName, input.mediaMimeType)
        : getAudioExtension(input.mediaFileName, input.mediaMimeType);
  const fileName = `${sanitizeFileSegment(input.messageId)}${extension}`;
  const filePath = path.join(uploadDir, fileName);

  await fs.writeFile(filePath, Buffer.from(input.mediaBase64, "base64"));

  return `/uploads/${uploadFolder}/${fileName}`;
}

function getAudioExtension(fileName: string | null, mimeType: string | null) {
  const existingExtension = fileName ? path.extname(fileName) : "";

  if (existingExtension) {
    return existingExtension;
  }

  if (mimeType?.includes("mpeg") || mimeType?.includes("mp3")) {
    return ".mp3";
  }

  if (mimeType?.includes("mp4")) {
    return ".m4a";
  }

  if (mimeType?.includes("wav")) {
    return ".wav";
  }

  if (mimeType?.includes("webm")) {
    return ".webm";
  }

  return ".ogg";
}

function getImageExtension(fileName: string | null, mimeType: string | null) {
  const existingExtension = fileName ? path.extname(fileName) : "";

  if (existingExtension) {
    return existingExtension;
  }

  if (mimeType?.includes("png")) {
    return ".png";
  }

  if (mimeType?.includes("webp")) {
    return ".webp";
  }

  if (mimeType?.includes("gif")) {
    return ".gif";
  }

  return ".jpg";
}

function getDocumentExtension(fileName: string | null, mimeType: string | null) {
  const existingExtension = fileName ? path.extname(fileName) : "";

  if (existingExtension) {
    return existingExtension;
  }

  if (mimeType?.includes("pdf")) {
    return ".pdf";
  }

  if (mimeType?.includes("word") || mimeType?.includes("document")) {
    return ".docx";
  }

  if (mimeType?.includes("spreadsheet") || mimeType?.includes("excel")) {
    return ".xlsx";
  }

  return ".bin";
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "attachment";
}

async function resolveIncomingBusinessId(payloadBusinessId?: string | null) {
  if (payloadBusinessId) {
    const business = await prisma.business.findUnique({
      where: { id: payloadBusinessId },
      select: { id: true },
    });

    if (!business) {
      throw new Error("Incoming WhatsApp payload businessId does not match a business.");
    }

    return business.id;
  }

  const configuredBusinessId = process.env.WHATSAPP_INCOMING_BUSINESS_ID?.trim();

  if (configuredBusinessId) {
    const business = await prisma.business.findUnique({
      where: { id: configuredBusinessId },
      select: { id: true },
    });

    if (!business) {
      throw new Error("WHATSAPP_INCOMING_BUSINESS_ID does not match a business.");
    }

    return business.id;
  }

  const businesses = await prisma.business.findMany({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    take: 2,
    select: { id: true },
  });

  if (businesses.length === 1) {
    return businesses[0].id;
  }

  throw new Error(
    "Unable to resolve incoming WhatsApp business. Set WHATSAPP_INCOMING_BUSINESS_ID.",
  );
}

function toPrismaJson(value: unknown) {
  if (value == null) {
    return undefined;
  }

  return value as Prisma.InputJsonValue;
}

async function findCustomerByPhone(businessId: string, phone: string) {
  return prisma.customer.findFirst({
    where: {
      businessId,
      phone: {
        in: getPhoneCandidates(phone),
        mode: "insensitive",
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
    },
  });
}

function getPhoneCandidates(phone: string) {
  const candidates = new Set<string>([phone, `+${phone}`]);

  if (phone.startsWith("60")) {
    candidates.add(`0${phone.slice(2)}`);
  }

  return [...candidates];
}

function parseIncomingTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return null;
  }

  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? null : date;
}
