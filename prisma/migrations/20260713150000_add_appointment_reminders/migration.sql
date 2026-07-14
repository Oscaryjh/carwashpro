ALTER TYPE "WhatsAppMessageType" ADD VALUE IF NOT EXISTS 'APPOINTMENT_REMINDER';

ALTER TYPE "NotificationQueueStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "whatsapp_messages"
ADD COLUMN "appointment_id" UUID;

ALTER TABLE "notification_queue"
ADD COLUMN "appointment_id" UUID,
ADD COLUMN "dedupe_key" TEXT;

CREATE INDEX "whatsapp_messages_appointment_id_idx"
ON "whatsapp_messages"("appointment_id");

CREATE UNIQUE INDEX "notification_queue_dedupe_key_key"
ON "notification_queue"("dedupe_key");

CREATE INDEX "notification_queue_appointment_id_idx"
ON "notification_queue"("appointment_id");

ALTER TABLE "whatsapp_messages"
ADD CONSTRAINT "whatsapp_messages_appointment_id_fkey"
FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_queue"
ADD CONSTRAINT "notification_queue_appointment_id_fkey"
FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
