-- CreateEnum
CREATE TYPE "WhatsAppWorkerCommandType" AS ENUM ('START_SESSION', 'DISCONNECT', 'SEND_TEXT', 'SEND_DOCUMENT');

-- CreateEnum
CREATE TYPE "WhatsAppWorkerCommandStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_worker_commands" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "type" "WhatsAppWorkerCommandType" NOT NULL,
    "status" "WhatsAppWorkerCommandStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_worker_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_worker_commands_status_created_at_idx" ON "whatsapp_worker_commands"("status", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_worker_commands_business_id_idx" ON "whatsapp_worker_commands"("business_id");

-- AddForeignKey
ALTER TABLE "whatsapp_worker_commands" ADD CONSTRAINT "whatsapp_worker_commands_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
