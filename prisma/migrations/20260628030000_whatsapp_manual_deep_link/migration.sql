ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "whatsapp_phone" TEXT;

ALTER TABLE "whatsapp_messages"
  ADD COLUMN IF NOT EXISTS "sent_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "sender_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "opened_at" TIMESTAMP(3);

UPDATE "whatsapp_messages"
SET "recipient_phone" = "phone"
WHERE "recipient_phone" IS NULL;

ALTER TABLE "whatsapp_messages"
  ALTER COLUMN "status" DROP DEFAULT;

CREATE TYPE "WhatsAppMessageStatus_new" AS ENUM (
  'DRAFT',
  'OPENED',
  'SENT_MANUALLY',
  'CANCELLED'
);

ALTER TABLE "whatsapp_messages"
  ALTER COLUMN "status" TYPE "WhatsAppMessageStatus_new"
  USING (
    CASE
      WHEN "status"::text IN ('SENT', 'DELIVERED', 'READ') THEN 'SENT_MANUALLY'
      WHEN "status"::text = 'FAILED' THEN 'CANCELLED'
      ELSE 'DRAFT'
    END::"WhatsAppMessageStatus_new"
  );

DROP TYPE "WhatsAppMessageStatus";
ALTER TYPE "WhatsAppMessageStatus_new" RENAME TO "WhatsAppMessageStatus";

ALTER TABLE "whatsapp_messages"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS "whatsapp_messages_sent_by_user_id_idx"
  ON "whatsapp_messages"("sent_by_user_id");

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_sent_by_user_id_fkey"
  FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
