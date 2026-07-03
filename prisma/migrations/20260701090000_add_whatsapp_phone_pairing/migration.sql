ALTER TABLE "whatsapp_connections"
  ADD COLUMN "pairing_phone" TEXT,
  ADD COLUMN "pairing_code_text" TEXT,
  ADD COLUMN "pairing_requested_at" TIMESTAMP(3);
