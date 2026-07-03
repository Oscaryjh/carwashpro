import {
  Prisma,
  WhatsAppWorkerCommandStatus,
  WhatsAppWorkerCommandType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

type JsonPayload = Record<string, unknown>;

function toJsonPayload(payload: JsonPayload): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

export async function enqueueWhatsAppStartSession(
  businessId: string,
  input: { reset?: boolean; pairingPhone?: string | null } = {},
) {
  await prisma.whatsAppWorkerCommand.updateMany({
    where: {
      businessId,
      type: WhatsAppWorkerCommandType.START_SESSION,
      status: WhatsAppWorkerCommandStatus.PENDING,
    },
    data: {
      status: WhatsAppWorkerCommandStatus.FAILED,
      errorMessage: "Superseded by a newer WhatsApp QR request.",
      processedAt: new Date(),
    },
  });

  return prisma.whatsAppWorkerCommand.create({
    data: {
      businessId,
      type: WhatsAppWorkerCommandType.START_SESSION,
      payload: toJsonPayload(input),
    },
  });
}

export async function enqueueWhatsAppDisconnect(businessId: string) {
  return prisma.whatsAppWorkerCommand.create({
    data: {
      businessId,
      type: WhatsAppWorkerCommandType.DISCONNECT,
      payload: toJsonPayload({}),
    },
  });
}

export async function enqueueWhatsAppTextMessage(input: {
  businessId: string;
  conversationId: string;
  body: string;
  sentByUserId: string;
  messageLogId?: string | null;
}) {
  return prisma.whatsAppWorkerCommand.create({
    data: {
      businessId: input.businessId,
      type: WhatsAppWorkerCommandType.SEND_TEXT,
      payload: toJsonPayload({
        conversationId: input.conversationId,
        body: input.body,
        sentByUserId: input.sentByUserId,
        messageLogId: input.messageLogId ?? null,
      }),
    },
  });
}

export async function enqueueWhatsAppDocumentMessage(input: {
  businessId: string;
  conversationId: string;
  body: string;
  sentByUserId: string;
  documentBase64: string;
  fileName: string;
  mimeType: string;
  messageLogId?: string | null;
}) {
  return prisma.whatsAppWorkerCommand.create({
    data: {
      businessId: input.businessId,
      type: WhatsAppWorkerCommandType.SEND_DOCUMENT,
      payload: toJsonPayload({
        conversationId: input.conversationId,
        body: input.body,
        sentByUserId: input.sentByUserId,
        documentBase64: input.documentBase64,
        fileName: input.fileName,
        mimeType: input.mimeType,
        messageLogId: input.messageLogId ?? null,
      }),
    },
  });
}
