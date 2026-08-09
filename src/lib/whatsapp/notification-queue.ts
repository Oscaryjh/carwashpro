import type {
  NotificationQueuePriority,
  WhatsAppMessageType,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { enqueue } from "@/lib/notification-queue/repository";
import { prisma } from "@/lib/prisma";
import { normalizeWhatsAppQueueRecipient } from "@/lib/whatsappDeepLink";

type EnqueueWhatsAppLogMessageInput = {
  businessId: string;
  branchId?: string | null;
  messageLogId: string;
  messageType: WhatsAppMessageType;
  phone: string;
  message: string;
  documentBase64?: string | null;
  documentMimeType?: string | null;
  documentFileName?: string | null;
  appointmentId?: string | null;
  dedupeKey?: string | null;
  priority?: NotificationQueuePriority;
  queuedAt?: Date;
  nextAttemptAt?: Date | null;
};

export async function enqueueWhatsAppLogMessage(
  input: EnqueueWhatsAppLogMessageInput,
) {
  const queuedAt = input.queuedAt ?? new Date();
  const normalizedPhone = normalizeWhatsAppQueueRecipient(input.phone);
  if (!normalizedPhone) {
    await prisma.whatsAppMessage.updateMany({
      where: { businessId: input.businessId, id: input.messageLogId },
      data: {
        errorMessage: "Invalid WhatsApp recipient number.",
        failedAt: queuedAt,
        status: "FAILED",
      },
    });
    throw new Error("Invalid WhatsApp recipient number.");
  }
  const normalizedInput = { ...input, phone: normalizedPhone };
  if (input.dedupeKey) {
    return enqueueDeduplicatedWhatsAppIntent(
      { ...normalizedInput, dedupeKey: input.dedupeKey },
      queuedAt,
    );
  }
  const queueItem = await enqueue({
    businessId: normalizedInput.businessId,
    branchId: normalizedInput.branchId ?? null,
    phone: normalizedInput.phone,
    message: normalizedInput.message,
    messageType: normalizedInput.messageType,
    messageLogId: normalizedInput.messageLogId,
    appointmentId: normalizedInput.appointmentId ?? null,
    dedupeKey: normalizedInput.dedupeKey ?? null,
    documentBase64: normalizedInput.documentBase64 ?? null,
    documentMimeType: normalizedInput.documentMimeType ?? null,
    documentFileName: normalizedInput.documentFileName ?? null,
    priority: normalizedInput.priority,
    queuedAt,
    nextAttemptAt: normalizedInput.nextAttemptAt ?? null,
  });

  await prisma.whatsAppMessage.update({
    where: { id: input.messageLogId },
    data: {
      queuedAt,
      errorMessage: null,
    },
  });

  return queueItem;
}

async function enqueueDeduplicatedWhatsAppIntent(
  input: EnqueueWhatsAppLogMessageInput & { dedupeKey: string },
  queuedAt: Date,
  transactionRetry = 0,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.notificationQueue.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) {
        assertExistingIntentScope(existing.businessId, input.businessId);
        await removeOrphanMessageLog(tx, input.messageLogId, existing.messageLogId);
        return existing;
      }

      const messageLog = await tx.whatsAppMessage.updateMany({
        where: { businessId: input.businessId, id: input.messageLogId },
        data: {
          dedupeKey: input.dedupeKey,
          errorMessage: null,
          queuedAt,
        },
      });
      if (messageLog.count !== 1) {
        throw new Error("WhatsApp message log is outside the trusted business scope.");
      }

      return tx.notificationQueue.create({
        data: {
          appointmentId: input.appointmentId ?? null,
          branchId: input.branchId ?? null,
          businessId: input.businessId,
          dedupeKey: input.dedupeKey,
          documentBase64: input.documentBase64 ?? null,
          documentFileName: input.documentFileName ?? null,
          documentMimeType: input.documentMimeType ?? null,
          message: input.message,
          messageLogId: input.messageLogId,
          messageType: input.messageType,
          nextAttemptAt: input.nextAttemptAt ?? null,
          phone: input.phone,
          priority: input.priority,
          queuedAt,
          status: "QUEUED",
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializableConflict(error) && transactionRetry < 2) {
      return enqueueDeduplicatedWhatsAppIntent(
        input,
        queuedAt,
        transactionRetry + 1,
      );
    }
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await prisma.notificationQueue.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (!existing) {
      throw error;
    }
    assertExistingIntentScope(existing.businessId, input.businessId);
    await prisma.whatsAppMessage.deleteMany({
      where: {
        businessId: input.businessId,
        id: input.messageLogId,
        queueItems: { none: {} },
      },
    });
    return existing;
  }
}

async function removeOrphanMessageLog(
  tx: Prisma.TransactionClient,
  candidateMessageLogId: string,
  canonicalMessageLogId: string | null,
) {
  if (candidateMessageLogId === canonicalMessageLogId) {
    return;
  }

  await tx.whatsAppMessage.deleteMany({
    where: {
      id: candidateMessageLogId,
      queueItems: { none: {} },
    },
  });
}

function assertExistingIntentScope(existingBusinessId: string, businessId: string) {
  if (existingBusinessId !== businessId) {
    throw new Error("WhatsApp intent dedupe key belongs to another business.");
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

function isSerializableConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034"
  );
}
