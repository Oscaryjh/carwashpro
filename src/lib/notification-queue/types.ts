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
  appointmentId?: string | null;
  dailyClosingSnapshotId?: string | null;
  dedupeKey?: string | null;
  priority?: NotificationQueuePriority;
  queuedAt?: Date;
  nextAttemptAt?: Date | null;
};

export type FindQueuedNotificationsInput = {
  limit?: number;
  businessId?: string;
  queuedAfter?: Date;
};

export type MarkNotificationSentInput = {
  claimToken: string;
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
  claimToken: string;
  errorCategory: string;
  id: string;
  errorMessage: string;
  retryable: boolean;
};

export type NotificationQueueState = NotificationQueueStatus;
export type NotificationQueueLevel = NotificationQueuePriority;
