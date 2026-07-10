ALTER TABLE "whatsapp_conversations"
  ADD COLUMN IF NOT EXISTS "instance_id" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "whatsapp_chat_messages"
  ADD COLUMN IF NOT EXISTS "instance_id" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "raw_message_json" JSONB;

CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "instance_id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "remote_jid" TEXT,
  "display_name" TEXT NOT NULL,
  "raw_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conversations_business_id_phone_key'
  ) THEN
    ALTER TABLE "whatsapp_conversations"
      DROP CONSTRAINT "whatsapp_conversations_business_id_phone_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "whatsapp_conversations_business_id_phone_key";

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversations_business_id_instance_id_phone_key"
  ON "whatsapp_conversations"("business_id", "instance_id", "phone");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_chat_messages_instance_id_external_message_id_key"
  ON "whatsapp_chat_messages"("instance_id", "external_message_id");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contacts_business_id_instance_id_phone_key"
  ON "whatsapp_contacts"("business_id", "instance_id", "phone");

CREATE INDEX IF NOT EXISTS "whatsapp_conversations_business_id_instance_id_idx"
  ON "whatsapp_conversations"("business_id", "instance_id");

CREATE INDEX IF NOT EXISTS "whatsapp_chat_messages_business_id_instance_id_idx"
  ON "whatsapp_chat_messages"("business_id", "instance_id");

CREATE INDEX IF NOT EXISTS "whatsapp_contacts_business_id_idx"
  ON "whatsapp_contacts"("business_id");

CREATE INDEX IF NOT EXISTS "whatsapp_contacts_business_id_instance_id_idx"
  ON "whatsapp_contacts"("business_id", "instance_id");

CREATE INDEX IF NOT EXISTS "whatsapp_contacts_remote_jid_idx"
  ON "whatsapp_contacts"("remote_jid");

ALTER TABLE "whatsapp_contacts"
  ADD CONSTRAINT "whatsapp_contacts_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
