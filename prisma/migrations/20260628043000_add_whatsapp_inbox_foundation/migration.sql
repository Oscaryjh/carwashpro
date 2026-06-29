CREATE TYPE "WhatsAppConnectionStatus" AS ENUM (
  'DISCONNECTED',
  'QR_REQUIRED',
  'CONNECTED',
  'ERROR'
);

CREATE TYPE "WhatsAppChatDirection" AS ENUM (
  'INBOUND',
  'OUTBOUND'
);

CREATE TYPE "WhatsAppChatMessageStatus" AS ENUM (
  'RECEIVED',
  'SENT',
  'FAILED'
);

CREATE TABLE "whatsapp_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "phone_number" TEXT,
  "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "qr_code_text" TEXT,
  "session_name" TEXT,
  "connected_at" TIMESTAMP(3),
  "disconnected_at" TIMESTAMP(3),
  "last_seen_at" TIMESTAMP(3),
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "customer_id" UUID,
  "phone" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "last_message_body" TEXT,
  "last_message_at" TIMESTAMP(3),
  "unread_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_chat_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "customer_id" UUID,
  "sent_by_user_id" UUID,
  "direction" "WhatsAppChatDirection" NOT NULL,
  "body" TEXT NOT NULL,
  "status" "WhatsAppChatMessageStatus" NOT NULL DEFAULT 'SENT',
  "external_message_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_connections_business_id_key"
  ON "whatsapp_connections"("business_id");
CREATE INDEX "whatsapp_connections_status_idx"
  ON "whatsapp_connections"("status");

CREATE UNIQUE INDEX "whatsapp_conversations_business_id_phone_key"
  ON "whatsapp_conversations"("business_id", "phone");
CREATE INDEX "whatsapp_conversations_business_id_idx"
  ON "whatsapp_conversations"("business_id");
CREATE INDEX "whatsapp_conversations_customer_id_idx"
  ON "whatsapp_conversations"("customer_id");
CREATE INDEX "whatsapp_conversations_last_message_at_idx"
  ON "whatsapp_conversations"("last_message_at");

CREATE INDEX "whatsapp_chat_messages_business_id_idx"
  ON "whatsapp_chat_messages"("business_id");
CREATE INDEX "whatsapp_chat_messages_conversation_id_idx"
  ON "whatsapp_chat_messages"("conversation_id");
CREATE INDEX "whatsapp_chat_messages_customer_id_idx"
  ON "whatsapp_chat_messages"("customer_id");
CREATE INDEX "whatsapp_chat_messages_sent_by_user_id_idx"
  ON "whatsapp_chat_messages"("sent_by_user_id");
CREATE INDEX "whatsapp_chat_messages_created_at_idx"
  ON "whatsapp_chat_messages"("created_at");

ALTER TABLE "whatsapp_connections"
  ADD CONSTRAINT "whatsapp_connections_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_chat_messages"
  ADD CONSTRAINT "whatsapp_chat_messages_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "whatsapp_chat_messages"
  ADD CONSTRAINT "whatsapp_chat_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_chat_messages"
  ADD CONSTRAINT "whatsapp_chat_messages_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_chat_messages"
  ADD CONSTRAINT "whatsapp_chat_messages_sent_by_user_id_fkey"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER whatsapp_connections_set_updated_at
BEFORE UPDATE ON "whatsapp_connections"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER whatsapp_conversations_set_updated_at
BEFORE UPDATE ON "whatsapp_conversations"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER whatsapp_chat_messages_set_updated_at
BEFORE UPDATE ON "whatsapp_chat_messages"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
