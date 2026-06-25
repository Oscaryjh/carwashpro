ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'QUEUED';
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'SENDING';
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'READ';

ALTER TABLE "whatsapp_messages"
  ADD COLUMN "error_message" TEXT,
  ADD COLUMN "queued_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "read_at" TIMESTAMP(3),
  ADD COLUMN "failed_at" TIMESTAMP(3);
