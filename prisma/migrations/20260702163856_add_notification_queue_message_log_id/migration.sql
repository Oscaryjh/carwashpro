-- AlterEnum
ALTER TYPE "WhatsAppMessageStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "notification_queue" ADD COLUMN     "message_log_id" UUID;

-- CreateIndex
CREATE INDEX "notification_queue_message_log_id_idx" ON "notification_queue"("message_log_id");

-- AddForeignKey
ALTER TABLE "notification_queue" ADD CONSTRAINT "notification_queue_message_log_id_fkey" FOREIGN KEY ("message_log_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
