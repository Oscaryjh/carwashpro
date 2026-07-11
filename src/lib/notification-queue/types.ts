import type {
  NotificationQueuePriority,
  NotificationQueueStatus,
} from "@prisma/client";

export type EnqueueNotificationInput = {
  businessId: string;
  branchId?: string | null;
  phone: string;
  message: string;
  messageType: string;
  documentBase64?: string | null;
  documentMimeType?: string | null;
  documentFileName?: string | null;
  messageLogId?: string | null;
  priority?: NotificationQueuePriority;
  queuedAt?: Date;
};

export type FindQueuedNotificationsInput = {
  limit?: number;
  businessId?: string;
};

export type MarkNotificationSentInput = {
  id: string;
  providerMessageId: string;
};

export type MarkNotificationDeliveryInput = {
  businessId: string;
  instanceId?: string | null;
  providerMessageId: string;
  status: "DELIVERED" | "READ" | "FAILED";
  errorMessage?: string | null;
  timestamp?: Date;
};

export type MarkNotificationFailedInput = {
  id: string;
  errorMessage: string;
};

export type NotificationQueueState = NotificationQueueStatus;
export type NotificationQueueLevel = NotificationQueuePriority;
