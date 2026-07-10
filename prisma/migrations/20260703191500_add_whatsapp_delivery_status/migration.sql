ALTER TYPE "NotificationQueueStatus" ADD VALUE IF NOT EXISTS 'SENT_TO_SERVER';
ALTER TYPE "NotificationQueueStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "NotificationQueueStatus" ADD VALUE IF NOT EXISTS 'READ';

ALTER TABLE "notification_queue"
  ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "notification_queue_provider_message_id_idx"
  ON "notification_queue"("provider_message_id");
