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

export type MarkNotificationFailedInput = {
  id: string;
  errorMessage: string;
};

export type NotificationQueueState = NotificationQueueStatus;
export type NotificationQueueLevel = NotificationQueuePriority;
