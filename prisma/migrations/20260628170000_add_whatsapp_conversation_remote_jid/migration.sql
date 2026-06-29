ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "remote_jid" TEXT;

UPDATE "whatsapp_conversations"
SET "remote_jid" = "phone" || '@s.whatsapp.net'
WHERE "remote_jid" IS NULL
  AND "phone" ~ '^60[0-9]{8,12}$';

UPDATE "whatsapp_conversations"
SET "remote_jid" = substring("phone" from 3) || '@lid'
WHERE "remote_jid" IS NULL
  AND "phone" ~ '^601[0-9]{13,}$';

CREATE INDEX "whatsapp_conversations_remote_jid_idx"
  ON "whatsapp_conversations"("remote_jid");
