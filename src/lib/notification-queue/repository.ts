import {
  NotificationQueuePriority,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  EnqueueNotificationInput,
  FindQueuedNotificationsInput,
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

export async function enqueue(input: EnqueueNotificationInput) {
  return prisma.notificationQueue.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId ?? null,
      phone: input.phone,
      message: input.message,
      messageType: input.messageType,
      messageLogId: input.messageLogId ?? null,
      priority: input.priority ?? NotificationQueuePriority.NORMAL,
      queuedAt: input.queuedAt ?? new Date(),
      status: "QUEUED",
    },
  });
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

export async function markSent(input: MarkNotificationSentInput) {
  return prisma.$transaction(async (tx) => {
    const queueItem = await tx.notificationQueue.update({
      where: { id: input.id },
      data: {
        status: "SENT",
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
      status: "SENT_MANUALLY",
      provider: "WHATSAPP_WEB_AUTO",
      providerMessageId,
      sentAt: new Date(),
      errorMessage: null,
      failedAt: null,
    },
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
