-- Leave Management Phase 2E adds private, tenant-scoped supporting evidence.
-- Stored file bytes remain outside the database and outside public web roots.
-- Legacy text references are retained as explicit legacy evidence only.

CREATE TYPE "LeaveEvidenceStatus" AS ENUM (
  'NOT_REVIEWED',
  'VERIFIED',
  'REJECTED',
  'REVIEW_REQUIRED'
);

CREATE TYPE "LeaveSupportingDocumentType" AS ENUM (
  'MEDICAL_CERTIFICATE',
  'HOSPITALISATION_SUPPORT',
  'MATERNITY_SUPPORT',
  'PATERNITY_SUPPORT',
  'SUPPORTING_DOCUMENT',
  'OTHER'
);

CREATE TYPE "LeaveSupportingDocumentSource" AS ENUM ('UPLOAD', 'LEGACY_REFERENCE');
CREATE TYPE "LeaveSupportingDocumentLifecycleStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REMOVED', 'LEGACY_REFERENCE');
CREATE TYPE "LeaveDocumentSecurityStatus" AS ENUM ('SCAN_NOT_AVAILABLE', 'PENDING_SECURITY_SCAN', 'CLEAN', 'REJECTED');
CREATE TYPE "LeaveDocumentPrivacyClass" AS ENUM ('SENSITIVE_HR', 'SENSITIVE_MEDICAL');

ALTER TABLE "leave_requests"
  ADD COLUMN "supporting_evidence_required_snapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supporting_evidence_status" "LeaveEvidenceStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  ADD COLUMN "supporting_evidence_present_snapshot" BOOLEAN,
  ADD COLUMN "supporting_evidence_status_snapshot" "LeaveEvidenceStatus",
  ADD COLUMN "supporting_evidence_reference_snapshot" CHAR(64),
  ADD COLUMN "supporting_evidence_document_count_snapshot" INTEGER;

-- Existing leave rows are protected by the final-closure transition trigger.
-- This migration only backfills newly-added evidence metadata; it does not
-- change workflow state or immutable leave facts. Disable that one guard while
-- the table is locked for the metadata backfill, then restore it below.
ALTER TABLE "leave_requests" DISABLE TRIGGER "leave_request_transition_guard";

UPDATE "leave_requests" request
SET "supporting_evidence_required_snapshot" = version."requires_document"
FROM "leave_policy_versions" version
WHERE version."id" = request."policy_version_id"
  AND request."supporting_evidence_required_snapshot" IS DISTINCT FROM version."requires_document";

CREATE TABLE "leave_supporting_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "leave_request_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "source" "LeaveSupportingDocumentSource" NOT NULL,
  "document_type" "LeaveSupportingDocumentType" NOT NULL DEFAULT 'SUPPORTING_DOCUMENT',
  "object_key" VARCHAR(300),
  "legacy_reference" VARCHAR(500),
  "sanitized_file_name" VARCHAR(120),
  "mime_type" VARCHAR(80),
  "byte_length" INTEGER,
  "checksum_sha256" CHAR(64),
  "security_status" "LeaveDocumentSecurityStatus" NOT NULL DEFAULT 'SCAN_NOT_AVAILABLE',
  "privacy_class" "LeaveDocumentPrivacyClass" NOT NULL DEFAULT 'SENSITIVE_HR',
  "lifecycle_status" "LeaveSupportingDocumentLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
  "review_status" "LeaveEvidenceStatus" NOT NULL DEFAULT 'NOT_REVIEWED',
  "uploaded_by_user_id" UUID,
  "uploaded_by_membership_id" UUID,
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" VARCHAR(500),
  "superseded_by_id" UUID,
  "removed_at" TIMESTAMP(3),
  "removed_by_user_id" UUID,
  "removed_by_membership_id" UUID,
  "retention_class" VARCHAR(60) NOT NULL DEFAULT 'HR_LEAVE_EVIDENCE',
  "retain_until" DATE,
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "leave_supporting_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_supporting_documents_object_key_key" UNIQUE ("object_key"),
  CONSTRAINT "leave_supporting_documents_tenant_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "leave_supporting_documents_request_fkey" FOREIGN KEY ("leave_request_id", "business_id") REFERENCES "leave_requests"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "leave_supporting_documents_source_check" CHECK (
    ("source" = 'UPLOAD' AND "object_key" IS NOT NULL AND "legacy_reference" IS NULL AND "sanitized_file_name" IS NOT NULL AND "mime_type" IS NOT NULL AND "byte_length" > 0 AND "checksum_sha256" IS NOT NULL)
    OR
    ("source" = 'LEGACY_REFERENCE' AND "object_key" IS NULL AND "legacy_reference" IS NOT NULL AND "lifecycle_status" = 'LEGACY_REFERENCE')
  )
);

CREATE INDEX "leave_supporting_documents_request_idx" ON "leave_supporting_documents"("business_id", "leave_request_id", "lifecycle_status");
CREATE INDEX "leave_supporting_documents_member_idx" ON "leave_supporting_documents"("business_id", "membership_id", "created_at");
CREATE INDEX "leave_supporting_documents_review_idx" ON "leave_supporting_documents"("business_id", "review_status", "created_at");

INSERT INTO "leave_supporting_documents" (
  "business_id",
  "leave_request_id",
  "membership_id",
  "source",
  "document_type",
  "legacy_reference",
  "lifecycle_status",
  "review_status",
  "privacy_class",
  "updated_at"
)
SELECT
  "business_id",
  "id",
  "membership_id",
  'LEGACY_REFERENCE',
  'SUPPORTING_DOCUMENT',
  "document_reference",
  'LEGACY_REFERENCE',
  'REVIEW_REQUIRED',
  'SENSITIVE_HR',
  CURRENT_TIMESTAMP
FROM "leave_requests"
WHERE "document_reference" IS NOT NULL AND btrim("document_reference") <> '';

UPDATE "leave_requests"
SET "supporting_evidence_status" = 'REVIEW_REQUIRED'
WHERE "document_reference" IS NOT NULL
  AND btrim("document_reference") <> ''
  AND "supporting_evidence_status" IS DISTINCT FROM 'REVIEW_REQUIRED';

ALTER TABLE "leave_requests" ENABLE TRIGGER "leave_request_transition_guard";

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_evidence_snapshot_count_check"
  CHECK ("supporting_evidence_document_count_snapshot" IS NULL OR "supporting_evidence_document_count_snapshot" >= 0);
