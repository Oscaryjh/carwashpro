import type {
  BusinessLanguage,
  ClosingWhatsAppSendTrigger,
  ClosingWhatsAppSendType,
  NotificationQueueStatus,
  WhatsAppMessageStatus,
} from "@prisma/client";
import { WhatsAppMessageType } from "@prisma/client";

export const CLOSING_REPORT_MESSAGE_TYPE =
  WhatsAppMessageType.DAILY_CLOSING_REPORT;
export const UNCLOSED_REMINDER_MESSAGE_TYPE =
  WhatsAppMessageType.DAILY_CLOSING_UNCLOSED_REMINDER;

export const CLOSING_WHATSAPP_MAX_AUTO_RETRIES = 5;
export const CLOSING_WHATSAPP_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
] as const;

export type ClosingWhatsAppMessageType =
  | typeof CLOSING_REPORT_MESSAGE_TYPE
  | typeof UNCLOSED_REMINDER_MESSAGE_TYPE;

export type ClosingWhatsAppRecipientInput = {
  id: string | null;
  label: string;
  phone: string;
  normalizedPhone: string;
};

export type ClosingWhatsAppQueueResult = {
  created: number;
  skipped: number;
  recipients: ClosingWhatsAppRecipientInput[];
};

export type ClosingWhatsAppSendStatus =
  | NotificationQueueStatus
  | WhatsAppMessageStatus
  | "QUEUED";

export type ClosingWhatsAppSendAuditInput = {
  dedupeKey: string;
  errorMessage?: string | null;
  messageLogId?: string | null;
  queueId?: string | null;
  reason?: string | null;
  requestedByUserId?: string | null;
  status?: ClosingWhatsAppSendStatus;
  trigger: ClosingWhatsAppSendTrigger;
  type: ClosingWhatsAppSendType;
};

export type ClosingWhatsAppLanguage = BusinessLanguage | null | undefined;
