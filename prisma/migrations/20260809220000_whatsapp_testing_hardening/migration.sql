-- WhatsApp Testing Hardening is additive. Legacy message and queue rows remain unchanged.

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "dedupe_key" TEXT;

CREATE UNIQUE INDEX "whatsapp_messages_dedupe_key_key"
  ON "whatsapp_messages"("dedupe_key");

ALTER TABLE "notification_queue"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error_category" TEXT,
  ADD COLUMN "claim_token" UUID,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "last_attempt_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "notification_queue_id_business_id_key"
  ON "notification_queue"("id", "business_id");

CREATE INDEX "notification_queue_status_lease_expires_at_idx"
  ON "notification_queue"("status", "lease_expires_at");

CREATE TABLE "whatsapp_send_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "queue_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "claim_token" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "retryable" BOOLEAN,
  "error_category" TEXT,
  "error_message" TEXT,
  "provider_message_id" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_send_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_send_attempts_attempt_number_check"
    CHECK ("attempt_number" > 0),
  CONSTRAINT "whatsapp_send_attempts_queue_scope_fkey"
    FOREIGN KEY ("queue_id", "business_id")
    REFERENCES "notification_queue"("id", "business_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "whatsapp_send_attempts_queue_attempt_key"
  ON "whatsapp_send_attempts"("queue_id", "attempt_number");
CREATE INDEX "whatsapp_send_attempts_business_id_started_at_idx"
  ON "whatsapp_send_attempts"("business_id", "started_at");
CREATE INDEX "whatsapp_send_attempts_queue_id_started_at_idx"
  ON "whatsapp_send_attempts"("queue_id", "started_at");
CREATE INDEX "whatsapp_send_attempts_status_started_at_idx"
  ON "whatsapp_send_attempts"("status", "started_at");

CREATE TABLE "whatsapp_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "instance_id" TEXT NOT NULL DEFAULT 'default',
  "provider" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "payload_fingerprint" TEXT NOT NULL,
  "provider_occurred_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "effect_applied" BOOLEAN NOT NULL DEFAULT false,
  "outcome" TEXT,

  CONSTRAINT "whatsapp_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_webhook_events_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_webhook_events_duplicate_count_check"
    CHECK ("duplicate_count" >= 0)
);

CREATE UNIQUE INDEX "whatsapp_webhook_events_business_provider_event_key"
  ON "whatsapp_webhook_events"("business_id", "provider", "event_key");
CREATE INDEX "whatsapp_webhook_events_business_id_provider_message_id_idx"
  ON "whatsapp_webhook_events"("business_id", "provider_message_id");
CREATE INDEX "whatsapp_webhook_events_expires_at_idx"
  ON "whatsapp_webhook_events"("expires_at");
CREATE INDEX "whatsapp_webhook_events_event_type_received_at_idx"
  ON "whatsapp_webhook_events"("event_type", "received_at");
