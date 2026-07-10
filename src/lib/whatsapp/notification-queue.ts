import type {
  NotificationQueuePriority,
  WhatsAppMessageType,
} from "@prisma/client";
import { enqueue } from "@/lib/notification-queue/repository";
import { prisma } from "@/lib/prisma";

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
  priority?: NotificationQueuePriority;
};

export async function enqueueWhatsAppLogMessage(
  input: EnqueueWhatsAppLogMessageInput,
) {
  const queuedAt = new Date();
  const queueItem = await enqueue({
    businessId: input.businessId,
    branchId: input.branchId ?? null,
    phone: input.phone,
    message: input.message,
    messageType: input.messageType,
    messageLogId: input.messageLogId,
    documentBase64: input.documentBase64 ?? null,
    documentMimeType: input.documentMimeType ?? null,
    documentFileName: input.documentFileName ?? null,
    priority: input.priority,
    queuedAt,
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
