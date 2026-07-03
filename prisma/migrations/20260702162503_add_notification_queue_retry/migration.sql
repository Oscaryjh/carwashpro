-- AlterTable
ALTER TABLE "notification_queue" ADD COLUMN     "next_attempt_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_queue_status_next_attempt_at_idx" ON "notification_queue"("status", "next_attempt_at");
