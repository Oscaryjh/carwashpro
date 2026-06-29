CREATE TYPE "WhatsAppChatMessageType" AS ENUM ('TEXT', 'AUDIO');

ALTER TABLE "whatsapp_chat_messages"
ADD COLUMN "message_type" "WhatsAppChatMessageType" NOT NULL DEFAULT 'TEXT',
ADD COLUMN "media_url" TEXT,
ADD COLUMN "media_mime_type" TEXT,
ADD COLUMN "media_file_name" TEXT;

CREATE INDEX "whatsapp_chat_messages_message_type_idx" ON "whatsapp_chat_messages"("message_type");
