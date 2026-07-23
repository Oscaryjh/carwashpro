-- Add closing snapshot WhatsApp automation settings, recipients, and send audit records.

CREATE TYPE "BusinessLanguage" AS ENUM ('EN', 'ZH');
CREATE TYPE "ClosingWhatsAppRecipientRole" AS ENUM ('OWNER', 'BRANCH_MANAGER', 'FINANCE');
CREATE TYPE "ClosingWhatsAppRecipientScope" AS ENUM ('BUSINESS', 'BRANCH');
CREATE TYPE "ClosingWhatsAppSendType" AS ENUM ('CLOSING_REPORT', 'UNCLOSED_REMINDER');
CREATE TYPE "ClosingWhatsAppSendTrigger" AS ENUM ('AUTO_CLOSING', 'AUTO_REMINDER', 'MANUAL_RETRY', 'MANUAL_RESEND');

ALTER TYPE "WhatsAppMessageType" ADD VALUE IF NOT EXISTS 'DAILY_CLOSING_REPORT';
ALTER TYPE "WhatsAppMessageType" ADD VALUE IF NOT EXISTS 'DAILY_CLOSING_UNCLOSED_REMINDER';

ALTER TABLE "businesses"
  ADD COLUMN "language" "BusinessLanguage" NOT NULL DEFAULT 'EN';

CREATE TABLE "closing_whatsapp_settings" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "send_closing_report" BOOLEAN NOT NULL DEFAULT true,
  "send_unclosed_reminder" BOOLEAN NOT NULL DEFAULT true,
  "deadline_time" TEXT NOT NULL DEFAULT '22:30',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "closing_whatsapp_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "closing_whatsapp_settings_business_id_key" UNIQUE ("business_id"),
  CONSTRAINT "closing_whatsapp_settings_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "closing_whatsapp_branch_settings" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "use_business_recipients" BOOLEAN NOT NULL DEFAULT true,
  "deadline_time_override" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "closing_whatsapp_branch_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "closing_whatsapp_branch_settings_branch_id_key" UNIQUE ("branch_id"),
  CONSTRAINT "closing_whatsapp_branch_settings_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_branch_settings_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "closing_whatsapp_branch_settings_business_id_idx"
  ON "closing_whatsapp_branch_settings"("business_id");
CREATE UNIQUE INDEX "closing_whatsapp_branch_settings_business_id_branch_id_key"
  ON "closing_whatsapp_branch_settings"("business_id", "branch_id");

CREATE TABLE "closing_whatsapp_recipients" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "scope" "ClosingWhatsAppRecipientScope" NOT NULL DEFAULT 'BUSINESS',
  "scope_key" TEXT NOT NULL DEFAULT 'BUSINESS',
  "role" "ClosingWhatsAppRecipientRole" NOT NULL,
  "label" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "normalized_phone" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "closing_whatsapp_recipients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "closing_whatsapp_recipients_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_recipients_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "closing_whatsapp_recipient_scope_phone_key"
  ON "closing_whatsapp_recipients"("business_id", "scope", "scope_key", "normalized_phone");
CREATE INDEX "closing_whatsapp_recipients_business_id_scope_scope_key_idx"
  ON "closing_whatsapp_recipients"("business_id", "scope", "scope_key");
CREATE INDEX "closing_whatsapp_recipients_branch_id_idx"
  ON "closing_whatsapp_recipients"("branch_id");
CREATE INDEX "closing_whatsapp_recipients_normalized_phone_idx"
  ON "closing_whatsapp_recipients"("normalized_phone");

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "daily_closing_snapshot_id" UUID;

ALTER TABLE "notification_queue"
  ADD COLUMN "daily_closing_snapshot_id" UUID;

CREATE INDEX "whatsapp_messages_daily_closing_snapshot_id_idx"
  ON "whatsapp_messages"("daily_closing_snapshot_id");
CREATE INDEX "notification_queue_daily_closing_snapshot_id_idx"
  ON "notification_queue"("daily_closing_snapshot_id");

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_daily_closing_snapshot_id_fkey"
  FOREIGN KEY ("daily_closing_snapshot_id") REFERENCES "daily_closing_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_queue"
  ADD CONSTRAINT "notification_queue_daily_closing_snapshot_id_fkey"
  FOREIGN KEY ("daily_closing_snapshot_id") REFERENCES "daily_closing_snapshots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "closing_whatsapp_send_attempts" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "daily_closing_snapshot_id" UUID,
  "recipient_id" UUID,
  "queue_id" UUID,
  "message_log_id" UUID,
  "requested_by_user_id" UUID,
  "send_type" "ClosingWhatsAppSendType" NOT NULL,
  "trigger" "ClosingWhatsAppSendTrigger" NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "normalized_phone" TEXT NOT NULL,
  "reason" TEXT,
  "status" "NotificationQueueStatus" NOT NULL DEFAULT 'QUEUED',
  "error_message" TEXT,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "closing_whatsapp_send_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "closing_whatsapp_send_attempts_dedupe_key_key" UNIQUE ("dedupe_key"),
  CONSTRAINT "closing_whatsapp_send_attempts_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_daily_closing_snapshot_id_fkey"
    FOREIGN KEY ("daily_closing_snapshot_id") REFERENCES "daily_closing_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_recipient_id_fkey"
    FOREIGN KEY ("recipient_id") REFERENCES "closing_whatsapp_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_queue_id_fkey"
    FOREIGN KEY ("queue_id") REFERENCES "notification_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_message_log_id_fkey"
    FOREIGN KEY ("message_log_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "closing_whatsapp_send_attempts_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "closing_whatsapp_send_attempts_business_id_idx"
  ON "closing_whatsapp_send_attempts"("business_id");
CREATE INDEX "closing_whatsapp_send_attempts_branch_id_idx"
  ON "closing_whatsapp_send_attempts"("branch_id");
CREATE INDEX "closing_whatsapp_send_attempts_daily_closing_snapshot_id_idx"
  ON "closing_whatsapp_send_attempts"("daily_closing_snapshot_id");
CREATE INDEX "closing_whatsapp_send_attempts_queue_id_idx"
  ON "closing_whatsapp_send_attempts"("queue_id");
CREATE INDEX "closing_whatsapp_send_attempts_message_log_id_idx"
  ON "closing_whatsapp_send_attempts"("message_log_id");
CREATE INDEX "closing_whatsapp_send_attempts_requested_by_user_id_idx"
  ON "closing_whatsapp_send_attempts"("requested_by_user_id");
CREATE INDEX "closing_whatsapp_send_attempts_send_type_status_idx"
  ON "closing_whatsapp_send_attempts"("send_type", "status");
