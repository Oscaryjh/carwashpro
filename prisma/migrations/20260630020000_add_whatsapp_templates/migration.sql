CREATE TYPE "WhatsAppTemplateStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "whatsapp_templates" (
    "id" UUID NOT NULL,
    "message_type" "WhatsAppMessageType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "WhatsAppTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_templates_message_type_key" ON "whatsapp_templates"("message_type");
CREATE INDEX "whatsapp_templates_status_idx" ON "whatsapp_templates"("status");
