import fs from "node:fs/promises";
import path from "node:path";
import {
  type WhatsAppChatMessageStatus,
  type WhatsAppMessageStatus,
  NotificationQueuePriority,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  getDefaultWhatsAppInstanceId,
} from "@/lib/whatsapp/instance";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import type {
  EnqueueNotificationInput,
  FindQueuedNotificationsInput,
  MarkNotificationDeliveryInput,
  MarkNotificationFailedInput,
  MarkNotificationSentInput,
} from "./types";

const DEFAULT_FIND_LIMIT = 10;
const MAX_FIND_LIMIT = 100;
const MAX_RETRY_COUNT = 5;
const RETRY_DELAYS_MS = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
] as const;
const MESSAGE_LOG_NOT_READ_OR_FAILED: WhatsAppMessageStatus[] = [
  "READ",
  "FAILED",
];
const MESSAGE_LOG_NOT_READ_OR_DELIVERED: WhatsAppMessageStatus[] = [
  "READ",
  "DELIVERED",
];
const CHAT_NOT_READ_OR_FAILED: WhatsAppChatMessageStatus[] = [
  "READ",
  "FAILED",
];
const CHAT_NOT_READ_OR_DELIVERED: WhatsAppChatMessageStatus[] = [
  "READ",
  "DELIVERED",
];

export async function enqueue(input: EnqueueNotificationInput) {
  const queueItem = await prisma.notificationQueue.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      phone: input.phone,
      message: input.message,
      messageType: input.messageType,
      messageLogId: input.messageLogId ?? null,
      appointmentId: input.appointmentId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      priority: input.priority ?? NotificationQueuePriority.NORMAL,
      queuedAt: input.queuedAt ?? new Date(),
      nextAttemptAt: input.nextAttemptAt ?? null,
      status: "QUEUED",
    },
  });

  if (input.documentBase64) {
    await prisma.$executeRaw`
      UPDATE "notification_queue"
      SET
        "document_base64" = ${input.documentBase64},
        "document_mime_type" = ${input.documentMimeType ?? null},
        "document_file_name" = ${input.documentFileName ?? null}
      WHERE "id" = ${queueItem.id}::uuid
    `;
  }

  return queueItem;
}

export async function findQueued(input: FindQueuedNotificationsInput = {}) {
  const now = new Date();

  return prisma.notificationQueue.findMany({
    where: {
      businessId: input.businessId,
      status: "QUEUED",
      OR: [
        { nextAttemptAt: null },
        { nextAttemptAt: { lte: now } },
      ],
    },
    orderBy: [
      { priority: "asc" },
      { queuedAt: "asc" },
      { createdAt: "asc" },
    ],
    take: normalizeLimit(input.limit),
  });
}

export async function markSending(id: string) {
  const result = await prisma.notificationQueue.updateMany({
    where: {
      id,
      status: "QUEUED",
    },
    data: {
      status: "SENDING",
      errorMessage: null,
      nextAttemptAt: null,
    },
  });

  if (!result.count) {
    return null;
  }

  return prisma.notificationQueue.findUnique({
    where: { id },
  });
}

export async function getQueueDocumentAttachment(id: string) {
  const rows = await prisma.$queryRaw<
    {
      documentBase64: string | null;
      documentMimeType: string | null;
      documentFileName: string | null;
    }[]
  >`
    SELECT
      "document_base64" AS "documentBase64",
      "document_mime_type" AS "documentMimeType",
      "document_file_name" AS "documentFileName"
    FROM "notification_queue"
    WHERE "id" = ${id}::uuid
    LIMIT 1
  `;

  return rows[0] ?? {
    documentBase64: null,
    documentMimeType: null,
    documentFileName: null,
  };
}

export async function markSentToServer(input: MarkNotificationSentInput) {
  return prisma.$transaction(async (tx) => {
    const queueItem = await tx.notificationQueue.update({
      where: { id: input.id },
      data: {
        status: "SENT_TO_SERVER",
        providerMessageId: input.providerMessageId,
        sentAt: new Date(),
        errorMessage: null,
        failedAt: null,
        nextAttemptAt: null,
      },
    });

    await markMessageLogSent(tx, queueItem, input.providerMessageId);

    return queueItem;
  });
}

export const markSent = markSentToServer;

export async function markDeliveryStatus(input: MarkNotificationDeliveryInput) {
  const timestamp = input.timestamp ?? new Date();
  const errorMessage = input.errorMessage ?? "WhatsApp delivery failed.";

  return prisma.$transaction(async (tx) => {
    const queueItems = await tx.notificationQueue.findMany({
      where: {
        businessId: input.businessId,
        providerMessageId: input.providerMessageId,
      },
      select: { id: true, messageLogId: true, status: true },
    });

    if (!queueItems.length) {
      return { updated: 0 };
    }

    const queueIdsToUpdate = queueItems
      .filter((queueItem) =>
        shouldApplyDeliveryStatus(queueItem.status, input.status),
      )
      .map((queueItem) => queueItem.id);

    if (queueIdsToUpdate.length) {
      await tx.notificationQueue.updateMany({
        where: { id: { in: queueIdsToUpdate } },
        data: getQueueDeliveryData(input.status, timestamp, errorMessage),
      });
    }

    const messageLogIds = queueItems
      .map((queueItem) => queueItem.messageLogId)
      .filter((messageLogId): messageLogId is string => Boolean(messageLogId));

    if (messageLogIds.length) {
      await tx.whatsAppMessage.updateMany({
        where: {
          id: { in: messageLogIds },
          status: getMessageLogStatusFilter(input.status),
        },
        data: getMessageLogDeliveryData(input.status, timestamp, errorMessage),
      });
    }

    await tx.whatsAppChatMessage.updateMany({
      where: {
        businessId: input.businessId,
        externalMessageId: input.providerMessageId,
        ...(input.instanceId ? { instanceId: input.instanceId } : {}),
        status: getChatMessageStatusFilter(input.status),
      },
      data: getChatMessageDeliveryData(input.status),
    });

    return { updated: queueIdsToUpdate.length };
  });
}

export async function markFailed(input: MarkNotificationFailedInput) {
  return prisma.$transaction(async (tx) => {
    const currentQueueItem = await tx.notificationQueue.findUniqueOrThrow({
      where: { id: input.id },
      select: { retryCount: true },
    });
    const nextRetryCount = currentQueueItem.retryCount + 1;
    const shouldRetry = nextRetryCount < MAX_RETRY_COUNT;

    const queueItem = await tx.notificationQueue.update({
      where: { id: input.id },
      data: {
        status: shouldRetry ? "QUEUED" : "FAILED",
        retryCount: nextRetryCount,
        nextAttemptAt: shouldRetry
          ? getNextAttemptAt(nextRetryCount)
          : null,
        failedAt: shouldRetry ? null : new Date(),
        errorMessage: input.errorMessage,
      },
    });

    await markMessageLogFailed(tx, queueItem, input.errorMessage);

    return queueItem;
  });
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return DEFAULT_FIND_LIMIT;
  }

  return Math.min(limit, MAX_FIND_LIMIT);
}

function getNextAttemptAt(retryCount: number) {
  const delayMs = RETRY_DELAYS_MS[retryCount - 1] ?? RETRY_DELAYS_MS.at(-1)!;

  return new Date(Date.now() + delayMs);
}

async function markMessageLogSent(
  tx: Prisma.TransactionClient,
  queueItem: {
    businessId?: string;
    documentBase64?: string | null;
    documentFileName?: string | null;
    documentMimeType?: string | null;
    messageLogId: string | null;
  },
  providerMessageId: string,
) {
  if (!queueItem.messageLogId) {
    return;
  }

  await tx.whatsAppMessage.updateMany({
    where: { id: queueItem.messageLogId },
    data: {
      status: "SENT_TO_SERVER",
      provider: "WHATSAPP_WEB_AUTO",
      providerMessageId,
      sentAt: new Date(),
      errorMessage: null,
      failedAt: null,
    },
  });

  await syncMessageLogToInbox(tx, queueItem.messageLogId, providerMessageId, {
    documentBase64: queueItem.documentBase64 ?? null,
    documentFileName: queueItem.documentFileName ?? null,
    documentMimeType: queueItem.documentMimeType ?? null,
  });
}

async function markMessageLogFailed(
  tx: Prisma.TransactionClient,
  queueItem: {
    messageLogId: string | null;
    status: string;
  },
  errorMessage: string,
) {
  if (queueItem.status !== "FAILED" || !queueItem.messageLogId) {
    return;
  }

  await tx.whatsAppMessage.updateMany({
    where: { id: queueItem.messageLogId },
    data: {
      status: "FAILED",
      errorMessage,
      failedAt: new Date(),
    },
  });
}

async function syncMessageLogToInbox(
  tx: Prisma.TransactionClient,
  messageLogId: string,
  providerMessageId: string,
  attachment: {
    documentBase64: string | null;
    documentFileName: string | null;
    documentMimeType: string | null;
  },
) {
  const messageLog = await tx.whatsAppMessage.findUnique({
    where: { id: messageLogId },
    select: {
      businessId: true,
      customerId: true,
      messageBody: true,
      messageType: true,
      phone: true,
      recipientPhone: true,
      sentByUserId: true,
      sentAt: true,
      customer: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!messageLog) {
    return;
  }

  const phone = resolveMessageLogInboxPhone(messageLog);

  if (!phone) {
    return;
  }

  const instanceId = await resolveInboxInstanceId(tx, messageLog.businessId, phone);
  const now = messageLog.sentAt ?? new Date();
  const displayName = messageLog.customer?.name?.trim() || phone;
  const syncedMessageType = getAttachmentMessageType(attachment.documentMimeType);
  const existingConversation = await tx.whatsAppConversation.findUnique({
    where: {
      businessId_instanceId_phone: {
        businessId: messageLog.businessId,
        instanceId,
        phone,
      },
    },
    select: {
      remoteJid: true,
    },
  });
  const remoteJid = existingConversation?.remoteJid?.trim() || `${phone}@s.whatsapp.net`;
  const conversation = await tx.whatsAppConversation.upsert({
    where: {
      businessId_instanceId_phone: {
        businessId: messageLog.businessId,
        instanceId,
        phone,
      },
    },
    create: {
      businessId: messageLog.businessId,
      instanceId,
      customerId: messageLog.customerId,
      phone,
      remoteJid,
      displayName,
      lastMessageBody: messageLog.messageBody,
      lastMessageAt: now,
      unreadCount: 0,
    },
    update: {
      ...(messageLog.customerId ? { customerId: messageLog.customerId } : {}),
      ...(messageLog.customer?.name ? { displayName } : {}),
      remoteJid,
      lastMessageBody: messageLog.messageBody,
      lastMessageAt: now,
    },
  });
  const pendingLocalMessage = await tx.whatsAppChatMessage.findFirst({
    where: {
      businessId: messageLog.businessId,
      instanceId,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      messageType:
        syncedMessageType === "IMAGE"
          ? { in: ["IMAGE", "DOCUMENT"] }
          : syncedMessageType,
      body: messageLog.messageBody,
      externalMessageId: null,
      ...(attachment.documentFileName
        ? { mediaFileName: attachment.documentFileName }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      mediaUrl: true,
    },
  });
  const mediaUrl = pendingLocalMessage?.mediaUrl ?? await saveInboxDocumentAttachment({
    documentBase64: attachment.documentBase64,
    documentFileName: attachment.documentFileName,
    documentMimeType: attachment.documentMimeType,
    providerMessageId,
  });

  if (pendingLocalMessage) {
    await tx.whatsAppChatMessage.update({
      where: { id: pendingLocalMessage.id },
      data: {
        customerId: messageLog.customerId,
        sentByUserId: messageLog.sentByUserId,
        messageType: syncedMessageType,
        body: messageLog.messageBody,
        mediaUrl,
        mediaFileName: attachment.documentFileName,
        mediaMimeType: attachment.documentMimeType,
        status: "SENT_TO_SERVER",
        externalMessageId: providerMessageId,
      },
    });
    return;
  }

  await tx.whatsAppChatMessage.upsert({
    where: {
      businessId_instanceId_externalMessageId: {
        businessId: messageLog.businessId,
        instanceId,
        externalMessageId: providerMessageId,
      },
    },
    create: {
      businessId: messageLog.businessId,
      instanceId,
      conversationId: conversation.id,
      customerId: messageLog.customerId,
      sentByUserId: messageLog.sentByUserId,
      direction: "OUTBOUND",
      messageType: syncedMessageType,
      body: messageLog.messageBody,
      mediaUrl,
      mediaFileName: attachment.documentFileName,
      mediaMimeType: attachment.documentMimeType,
      status: "SENT_TO_SERVER",
      externalMessageId: providerMessageId,
      createdAt: now,
    },
    update: {
      conversationId: conversation.id,
      customerId: messageLog.customerId,
      sentByUserId: messageLog.sentByUserId,
      body: messageLog.messageBody,
      mediaUrl,
      mediaFileName: attachment.documentFileName,
      mediaMimeType: attachment.documentMimeType,
      status: "SENT_TO_SERVER",
    },
  });
}

function shouldApplyDeliveryStatus(
  currentStatus: string,
  nextStatus: MarkNotificationDeliveryInput["status"],
) {
  if (nextStatus === "FAILED") {
    return !["FAILED", "DELIVERED", "READ"].includes(currentStatus);
  }

  return getDeliveryStatusRank(nextStatus) >= getDeliveryStatusRank(currentStatus);
}

function getDeliveryStatusRank(status: string) {
  switch (status) {
    case "FAILED":
      return 0;
    case "QUEUED":
    case "SENDING":
      return 1;
    case "SENT":
    case "SENT_TO_SERVER":
    case "SENT_MANUALLY":
    case "DRAFT":
    case "OPENED":
      return 2;
    case "DELIVERED":
      return 3;
    case "READ":
      return 4;
    default:
      return 1;
  }
}

function getQueueDeliveryData(
  status: MarkNotificationDeliveryInput["status"],
  timestamp: Date,
  errorMessage: string,
) {
  if (status === "FAILED") {
    return {
      status: "FAILED" as const,
      failedAt: timestamp,
      errorMessage,
    };
  }

  if (status === "READ") {
    return {
      status: "READ" as const,
      readAt: timestamp,
      deliveredAt: timestamp,
      errorMessage: null,
    };
  }

  return {
    status: "DELIVERED" as const,
    deliveredAt: timestamp,
    errorMessage: null,
  };
}

function getMessageLogDeliveryData(
  status: MarkNotificationDeliveryInput["status"],
  timestamp: Date,
  errorMessage: string,
) {
  if (status === "FAILED") {
    return {
      status: "FAILED" as const,
      errorMessage,
      failedAt: timestamp,
    };
  }

  if (status === "READ") {
    return {
      status: "READ" as const,
      readAt: timestamp,
      deliveredAt: timestamp,
      errorMessage: null,
    };
  }

  return {
    status: "DELIVERED" as const,
    deliveredAt: timestamp,
    errorMessage: null,
  };
}

function getChatMessageDeliveryData(
  status: MarkNotificationDeliveryInput["status"],
) {
  if (status === "FAILED") {
    return { status: "FAILED" as const };
  }

  if (status === "READ") {
    return { status: "READ" as const };
  }

  return { status: "DELIVERED" as const };
}

function getMessageLogStatusFilter(status: MarkNotificationDeliveryInput["status"]) {
  if (status === "READ") {
    return { not: "FAILED" as const };
  }

  if (status === "DELIVERED") {
    return { notIn: MESSAGE_LOG_NOT_READ_OR_FAILED };
  }

  return { notIn: MESSAGE_LOG_NOT_READ_OR_DELIVERED };
}

function getChatMessageStatusFilter(status: MarkNotificationDeliveryInput["status"]) {
  if (status === "READ") {
    return { not: "FAILED" as const };
  }

  if (status === "DELIVERED") {
    return { notIn: CHAT_NOT_READ_OR_FAILED };
  }

  return { notIn: CHAT_NOT_READ_OR_DELIVERED };
}

function resolveMessageLogInboxPhone(messageLog: {
  phone: string;
  recipientPhone: string | null;
}) {
  const rawPhone = [messageLog.recipientPhone, messageLog.phone].find((value) => {
    const trimmed = value?.trim();
    return trimmed && !trimmed.endsWith("@lid");
  });

  return rawPhone ? normalizeMalaysiaWhatsAppPhone(rawPhone) : "";
}

async function resolveInboxInstanceId(
  tx: Prisma.TransactionClient,
  businessId: string,
  phone: string,
) {
  const matchingConversation = await tx.whatsAppConversation.findFirst({
    where: {
      businessId,
      phone,
      instanceId: { not: DEFAULT_WHATSAPP_INSTANCE_ID },
    },
    orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
    select: { instanceId: true },
  });

  if (matchingConversation?.instanceId) {
    return matchingConversation.instanceId;
  }

  const recentInstance = await tx.whatsAppConversation.findFirst({
    where: {
      businessId,
      instanceId: { not: DEFAULT_WHATSAPP_INSTANCE_ID },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: { instanceId: true },
  });

  return recentInstance?.instanceId ?? getDefaultWhatsAppInstanceId();
}

async function saveInboxDocumentAttachment(input: {
  documentBase64: string | null;
  documentFileName: string | null;
  documentMimeType: string | null;
  providerMessageId: string;
}) {
  if (!input.documentBase64 || !input.documentFileName) {
    return null;
  }

  const uploadFolder = input.documentMimeType?.startsWith("audio/")
    ? "whatsapp-audio"
    : input.documentMimeType?.startsWith("image/")
      ? "whatsapp-images"
      : "whatsapp-documents";
  const uploadDir = path.join(process.cwd(), "public", "uploads", uploadFolder);
  await fs.mkdir(uploadDir, { recursive: true });

  const extension = getDocumentExtension(input.documentFileName, input.documentMimeType);
  const fileName = `${sanitizeFileSegment(input.providerMessageId)}-${sanitizeFileSegment(
    path.basename(input.documentFileName, path.extname(input.documentFileName)),
  )}${extension}`;
  const filePath = path.join(uploadDir, fileName);

  await fs.writeFile(filePath, Buffer.from(input.documentBase64, "base64"));

  return `/uploads/${uploadFolder}/${fileName}`;
}

function getDocumentExtension(fileName: string, mimeType: string | null) {
  const extension = path.extname(fileName);

  if (extension) {
    return extension;
  }

  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType?.includes("ogg")) {
    return ".ogg";
  }

  if (mimeType?.startsWith("audio/")) {
    return ".webm";
  }

  return ".bin";
}

function getAttachmentMessageType(mimeType: string | null) {
  if (mimeType?.startsWith("audio/")) {
    return "AUDIO";
  }

  if (mimeType?.startsWith("image/")) {
    return "IMAGE";
  }

  return mimeType ? "DOCUMENT" : "TEXT";
}

function sanitizeFileSegment(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}
