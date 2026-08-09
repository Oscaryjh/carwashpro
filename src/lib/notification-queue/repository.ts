import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  type NotificationQueueStatus,
  type WhatsAppChatMessageStatus,
  NotificationQueuePriority,
  Prisma,
} from "@prisma/client";
import {
  CLOSING_REPORT_MESSAGE_TYPE,
  CLOSING_WHATSAPP_MAX_AUTO_RETRIES,
  CLOSING_WHATSAPP_RETRY_DELAYS_MS,
  type ClosingWhatsAppMessageType,
  UNCLOSED_REMINDER_MESSAGE_TYPE,
} from "@/lib/closing-whatsapp/types";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_WHATSAPP_INSTANCE_ID,
  getDefaultWhatsAppInstanceId,
} from "@/lib/whatsapp/instance";
import { normalizeMalaysiaWhatsAppPhone } from "@/lib/whatsappDeepLink";
import { planWhatsAppStatusTransition } from "@/lib/whatsapp/status-state";
import type {
  EnqueueNotificationInput,
  FindQueuedNotificationsInput,
  MarkNotificationDeliveryInput,
  MarkNotificationFailedInput,
  MarkNotificationSentInput,
} from "./types";

const DEFAULT_FIND_LIMIT = 10;
const MAX_FIND_LIMIT = 100;
export const WHATSAPP_MAX_SEND_ATTEMPTS = 5;
export const WHATSAPP_SENDING_LEASE_MS = 2 * 60 * 1000;
const RETRY_DELAYS_MS = [
  30 * 1000,
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
] as const;

export async function enqueue(input: EnqueueNotificationInput) {
  let queueItem;
  try {
    queueItem = await prisma.notificationQueue.create({
      data: {
        businessId: input.businessId,
        branchId: input.branchId ?? null,
        phone: input.phone,
        message: input.message,
        messageType: input.messageType,
        messageLogId: input.messageLogId ?? null,
        appointmentId: input.appointmentId ?? null,
        dailyClosingSnapshotId: input.dailyClosingSnapshotId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        priority: input.priority ?? NotificationQueuePriority.NORMAL,
        queuedAt: input.queuedAt ?? new Date(),
        nextAttemptAt: input.nextAttemptAt ?? null,
        status: "QUEUED",
      },
    });
  } catch (error) {
    if (!(input.dedupeKey && isUniqueConstraintError(error))) throw error;

    const existing = await prisma.notificationQueue.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (!existing || existing.businessId !== input.businessId) throw error;
    return existing;
  }

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

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2002";
}

export async function findQueued(input: FindQueuedNotificationsInput = {}) {
  const now = new Date();

  return prisma.notificationQueue.findMany({
    where: {
      businessId: input.businessId,
      status: "QUEUED",
      ...(input.queuedAfter
        ? { queuedAt: { gte: input.queuedAfter } }
        : {}),
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
  const now = new Date();
  const claimToken = randomUUID();

  return prisma.$transaction(async (tx) => {
    const result = await tx.notificationQueue.updateMany({
      where: {
        id,
        status: "QUEUED",
        attemptCount: { lt: WHATSAPP_MAX_SEND_ATTEMPTS },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      data: {
        attemptCount: { increment: 1 },
        claimToken,
        errorMessage: null,
        lastAttemptAt: now,
        lastErrorCategory: null,
        leaseExpiresAt: new Date(now.getTime() + WHATSAPP_SENDING_LEASE_MS),
        nextAttemptAt: null,
        status: "SENDING",
      },
    });

    if (!result.count) {
      return null;
    }

    const queueItem = await tx.notificationQueue.findUniqueOrThrow({
      where: { id },
    });
    await tx.whatsAppSendAttempt.create({
      data: {
        attemptNumber: queueItem.attemptCount,
        businessId: queueItem.businessId,
        claimToken,
        queueId: queueItem.id,
        status: "STARTED",
        startedAt: now,
      },
    });

    return queueItem;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recoverExpiredSending(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const expired = await tx.notificationQueue.findMany({
      where: {
        status: "SENDING",
        leaseExpiresAt: { lte: now },
      },
      select: {
        attemptCount: true,
        claimToken: true,
        id: true,
        messageLogId: true,
      },
    });

    if (!expired.length) {
      return { exhausted: 0, recovered: 0 };
    }

    const recoverableIds = expired
      .filter((item) => item.attemptCount < WHATSAPP_MAX_SEND_ATTEMPTS)
      .map((item) => item.id);
    const exhausted = expired.filter(
      (item) => item.attemptCount >= WHATSAPP_MAX_SEND_ATTEMPTS,
    );
    const exhaustedIds = exhausted.map((item) => item.id);

    if (recoverableIds.length) {
      await tx.notificationQueue.updateMany({
        where: { id: { in: recoverableIds }, status: "SENDING" },
        data: {
          claimToken: null,
          errorMessage: "WhatsApp worker lease expired; retry scheduled.",
          lastErrorCategory: "WORKER_LEASE_EXPIRED",
          leaseExpiresAt: null,
          nextAttemptAt: now,
          retryCount: { increment: 1 },
          status: "QUEUED",
        },
      });
    }

    if (exhaustedIds.length) {
      await tx.notificationQueue.updateMany({
        where: { id: { in: exhaustedIds }, status: "SENDING" },
        data: {
          claimToken: null,
          errorMessage: "WhatsApp send attempts exhausted after worker lease expiry.",
          failedAt: now,
          lastErrorCategory: "RETRY_EXHAUSTED",
          leaseExpiresAt: null,
          nextAttemptAt: null,
          retryCount: { increment: 1 },
          status: "FAILED",
        },
      });
      const exhaustedMessageLogIds = exhausted
        .map((item) => item.messageLogId)
        .filter((id): id is string => Boolean(id));
      if (exhaustedMessageLogIds.length) {
        await tx.whatsAppMessage.updateMany({
          where: { id: { in: exhaustedMessageLogIds } },
          data: {
            errorMessage: "WhatsApp send attempts exhausted.",
            failedAt: now,
            status: "FAILED",
          },
        });
      }
    }

    await tx.whatsAppSendAttempt.updateMany({
      where: {
        queueId: { in: recoverableIds },
        status: "STARTED",
      },
      data: {
        completedAt: now,
        errorCategory: "WORKER_LEASE_EXPIRED",
        errorMessage: "Worker lease expired before completion.",
        retryable: true,
        status: "RETRY_SCHEDULED",
      },
    });
    await tx.whatsAppSendAttempt.updateMany({
      where: {
        queueId: { in: exhaustedIds },
        status: "STARTED",
      },
      data: {
        completedAt: now,
        errorCategory: "RETRY_EXHAUSTED",
        errorMessage: "Worker lease expired and no attempts remain.",
        retryable: false,
        status: "FAILED_FINAL",
      },
    });

    return { exhausted: exhaustedIds.length, recovered: recoverableIds.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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
    const updated = await tx.notificationQueue.updateMany({
      where: {
        claimToken: input.claimToken,
        id: input.id,
        status: "SENDING",
      },
      data: {
        claimToken: null,
        status: "SENT_TO_SERVER",
        providerMessageId: input.providerMessageId,
        sentAt: new Date(),
        errorMessage: null,
        failedAt: null,
        lastErrorCategory: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
    if (!updated.count) {
      return null;
    }
    const queueItem = await tx.notificationQueue.findUniqueOrThrow({
      where: { id: input.id },
    });

    await tx.whatsAppSendAttempt.updateMany({
      where: {
        claimToken: input.claimToken,
        queueId: input.id,
        status: "STARTED",
      },
      data: {
        completedAt: queueItem.sentAt,
        providerMessageId: input.providerMessageId,
        retryable: false,
        status: "SENT_TO_SERVER",
      },
    });

    await markMessageLogSent(tx, queueItem, input.providerMessageId);
    await syncClosingWhatsAppAttemptStatus(tx, queueItem.id, {
      errorMessage: null,
      messageLogId: queueItem.messageLogId,
      status: "SENT_TO_SERVER",
    });

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
      select: {
        deliveredAt: true,
        failedAt: true,
        id: true,
        messageLogId: true,
        readAt: true,
        status: true,
      },
    });

    if (!queueItems.length) {
      return {
        ignoredDowngrades: 0,
        ignoredDuplicates: 0,
        matched: 0,
        updated: 0,
      };
    }

    let updated = 0;
    let ignoredDowngrades = 0;
    let ignoredDuplicates = 0;
    for (const queueItem of queueItems) {
      const plan = planWhatsAppStatusTransition({
        currentStatus: queueItem.status,
        deliveredAt: queueItem.deliveredAt,
        failedAt: queueItem.failedAt,
        nextStatus: input.status,
        readAt: queueItem.readAt,
      });
      if (!plan.shouldMutate) {
        if (plan.outcome === "IGNORED_DOWNGRADE") {
          ignoredDowngrades += 1;
        } else if (plan.outcome === "DUPLICATE") {
          ignoredDuplicates += 1;
        }
        continue;
      }

      await tx.notificationQueue.update({
        where: { id: queueItem.id },
        data: getLifecycleMutation(plan, timestamp, errorMessage),
      });
      if (plan.stateChanged) {
        await tx.closingWhatsAppSendAttempt.updateMany({
          where: { queueId: queueItem.id },
          data: {
            completedAt:
              input.status === "DELIVERED" || input.status === "READ"
                ? timestamp
                : undefined,
            errorMessage: input.status === "FAILED" ? errorMessage : null,
            status: plan.nextStatus as NotificationQueueStatus,
          },
        });
      }
      updated += 1;
    }

    const messageLogIds = queueItems
      .map((queueItem) => queueItem.messageLogId)
      .filter((messageLogId): messageLogId is string => Boolean(messageLogId));

    if (messageLogIds.length) {
      const messageLogs = await tx.whatsAppMessage.findMany({
        where: { businessId: input.businessId, id: { in: messageLogIds } },
        select: {
          deliveredAt: true,
          failedAt: true,
          id: true,
          readAt: true,
          status: true,
        },
      });
      for (const messageLog of messageLogs) {
        const plan = planWhatsAppStatusTransition({
          currentStatus: messageLog.status,
          deliveredAt: messageLog.deliveredAt,
          failedAt: messageLog.failedAt,
          nextStatus: input.status,
          readAt: messageLog.readAt,
        });
        if (!plan.shouldMutate) {
          continue;
        }
        await tx.whatsAppMessage.update({
          where: { id: messageLog.id },
          data: getLifecycleMutation(plan, timestamp, errorMessage),
        });
      }
    }

    const chatMessages = await tx.whatsAppChatMessage.findMany({
      where: {
        businessId: input.businessId,
        externalMessageId: input.providerMessageId,
        ...(input.instanceId ? { instanceId: input.instanceId } : {}),
      },
      select: { id: true, status: true },
    });
    for (const chatMessage of chatMessages) {
      const plan = planWhatsAppStatusTransition({
        currentStatus: chatMessage.status,
        nextStatus: input.status,
      });
      if (!plan.stateChanged) {
        continue;
      }
      await tx.whatsAppChatMessage.update({
        where: { id: chatMessage.id },
        data: { status: plan.nextStatus as WhatsAppChatMessageStatus },
      });
    }

    return {
      ignoredDowngrades,
      ignoredDuplicates,
      matched: queueItems.length,
      updated,
    };
  });
}

export async function markFailed(input: MarkNotificationFailedInput) {
  return prisma.$transaction(async (tx) => {
    const currentQueueItem = await tx.notificationQueue.findUniqueOrThrow({
      where: { id: input.id },
      select: {
        attemptCount: true,
        claimToken: true,
        messageType: true,
        retryCount: true,
        status: true,
      },
    });
    if (
      currentQueueItem.status !== "SENDING" ||
      currentQueueItem.claimToken !== input.claimToken
    ) {
      return tx.notificationQueue.findUniqueOrThrow({ where: { id: input.id } });
    }
    const nextRetryCount = currentQueueItem.retryCount + 1;
    const shouldRetry =
      input.retryable &&
      currentQueueItem.attemptCount < WHATSAPP_MAX_SEND_ATTEMPTS &&
      shouldRetryQueueItem(currentQueueItem.messageType, nextRetryCount);

    const queueItem = await tx.notificationQueue.update({
      where: { id: input.id },
      data: {
        claimToken: null,
        status: shouldRetry ? "QUEUED" : "FAILED",
        retryCount: nextRetryCount,
        nextAttemptAt: shouldRetry
          ? getNextAttemptAt(nextRetryCount, currentQueueItem.messageType)
          : null,
        failedAt: shouldRetry ? null : new Date(),
        errorMessage: input.errorMessage,
        lastErrorCategory: input.errorCategory,
        leaseExpiresAt: null,
      },
    });

    await tx.whatsAppSendAttempt.updateMany({
      where: {
        claimToken: input.claimToken,
        queueId: input.id,
        status: "STARTED",
      },
      data: {
        completedAt: new Date(),
        errorCategory: input.errorCategory,
        errorMessage: input.errorMessage,
        retryable: shouldRetry,
        status: shouldRetry ? "RETRY_SCHEDULED" : "FAILED_FINAL",
      },
    });

    await markMessageLogFailed(tx, queueItem, input.errorMessage);
    await syncClosingWhatsAppAttemptStatus(tx, queueItem.id, {
      completedAt: shouldRetry ? null : queueItem.failedAt,
      errorMessage: input.errorMessage,
      messageLogId: queueItem.messageLogId,
      queueId: queueItem.id,
      status: queueItem.status,
    });

    return queueItem;
  });
}

function normalizeLimit(limit: number | undefined) {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return DEFAULT_FIND_LIMIT;
  }

  return Math.min(limit, MAX_FIND_LIMIT);
}

function getNextAttemptAt(retryCount: number, messageType: string) {
  const retryDelays = isClosingWhatsAppMessageType(messageType)
    ? CLOSING_WHATSAPP_RETRY_DELAYS_MS
    : RETRY_DELAYS_MS;
  const delayMs = retryDelays[retryCount - 1] ?? retryDelays.at(-1)!;

  return new Date(Date.now() + delayMs);
}

function shouldRetryQueueItem(messageType: string, retryCount: number) {
  if (isClosingWhatsAppMessageType(messageType)) {
    return retryCount <= CLOSING_WHATSAPP_MAX_AUTO_RETRIES;
  }

  return retryCount < WHATSAPP_MAX_SEND_ATTEMPTS;
}

function isClosingWhatsAppMessageType(
  messageType: string,
): messageType is ClosingWhatsAppMessageType {
  return (
    messageType === CLOSING_REPORT_MESSAGE_TYPE ||
    messageType === UNCLOSED_REMINDER_MESSAGE_TYPE
  );
}

async function syncClosingWhatsAppAttemptStatus(
  tx: Prisma.TransactionClient,
  queueId: string,
  data: Prisma.ClosingWhatsAppSendAttemptUncheckedUpdateManyInput,
) {
  await tx.closingWhatsAppSendAttempt.updateMany({
    where: { queueId },
    data,
  });
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

function getLifecycleMutation(
  plan: ReturnType<typeof planWhatsAppStatusTransition>,
  timestamp: Date,
  errorMessage: string,
) {
  return {
    ...(plan.stateChanged
      ? { status: plan.nextStatus as "DELIVERED" | "FAILED" | "READ" }
      : {}),
    ...(plan.setDeliveredAt ? { deliveredAt: timestamp } : {}),
    ...(plan.setReadAt ? { readAt: timestamp } : {}),
    ...(plan.setFailedAt ? { failedAt: timestamp } : {}),
    ...(plan.nextStatus === "FAILED"
      ? { errorMessage }
      : plan.shouldMutate
        ? { errorMessage: null }
        : {}),
  };
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
