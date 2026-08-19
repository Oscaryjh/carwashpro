-- Local / Testing receipt-to-expense autofill foundation.
-- The scan is an expiring private staging record and never creates or confirms an expense by itself.
CREATE TYPE "ExpenseDocumentType" AS ENUM ('EXPENSE_RECEIPT', 'SUPPLIER_INVOICE', 'CLAIM_RECEIPT', 'UNKNOWN');
CREATE TYPE "ExpenseDocumentConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE "expense_document_scans" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID,
  "created_by_id" UUID NOT NULL,
  "expense_id" UUID,
  "object_key" VARCHAR(300) NOT NULL,
  "sanitized_file_name" VARCHAR(120) NOT NULL,
  "mime_type" VARCHAR(80) NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "checksum_sha256" CHAR(64) NOT NULL,
  "malware_status" "ClaimAttachmentMalwareStatus" NOT NULL DEFAULT 'NOT_SCANNED',
  "privacy_metadata_status" "ClaimAttachmentPrivacyStatus" NOT NULL DEFAULT 'NOT_CHECKED',
  "quarantine_disposition" VARCHAR(30) NOT NULL DEFAULT 'QUARANTINED',
  "document_type" "ExpenseDocumentType" NOT NULL DEFAULT 'UNKNOWN',
  "confidence" "ExpenseDocumentConfidence" NOT NULL DEFAULT 'LOW',
  "extraction" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "duplicate_candidates" JSONB NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "provider_model" VARCHAR(120) NOT NULL,
  "provider_request_id" VARCHAR(160),
  "extraction_version" VARCHAR(80) NOT NULL DEFAULT 'expense-document-v1',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expense_document_scans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_document_scans_size_check" CHECK ("byte_length" > 0 AND "byte_length" <= 10485760),
  CONSTRAINT "expense_document_scans_checksum_check" CHECK ("checksum_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "expense_document_scans_mime_check" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT "expense_document_scans_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "expense_document_scans_consumed_check" CHECK (("expense_id" IS NULL AND "consumed_at" IS NULL) OR ("expense_id" IS NOT NULL AND "consumed_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "expense_document_scans_expense_id_key" ON "expense_document_scans"("expense_id");
CREATE UNIQUE INDEX "expense_document_scans_object_key_key" ON "expense_document_scans"("object_key");
CREATE UNIQUE INDEX "expense_document_scans_id_business_id_key" ON "expense_document_scans"("id", "business_id");
CREATE UNIQUE INDEX "expense_document_scans_expense_id_business_id_key" ON "expense_document_scans"("expense_id", "business_id");
CREATE INDEX "expense_document_scans_business_id_created_by_id_created_at_idx" ON "expense_document_scans"("business_id", "created_by_id", "created_at");
CREATE INDEX "expense_document_scans_business_id_checksum_sha256_idx" ON "expense_document_scans"("business_id", "checksum_sha256");
CREATE INDEX "expense_document_scans_business_id_document_type_created_at_idx" ON "expense_document_scans"("business_id", "document_type", "created_at");
CREATE INDEX "expense_document_scans_expires_at_consumed_at_idx" ON "expense_document_scans"("expires_at", "consumed_at");

ALTER TABLE "expense_document_scans" ADD CONSTRAINT "expense_document_scans_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_document_scans" ADD CONSTRAINT "expense_document_scans_branch_id_business_id_fkey"
  FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_document_scans" ADD CONSTRAINT "expense_document_scans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_document_scans" ADD CONSTRAINT "expense_document_scans_expense_id_business_id_fkey"
  FOREIGN KEY ("expense_id", "business_id") REFERENCES "business_expenses"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
