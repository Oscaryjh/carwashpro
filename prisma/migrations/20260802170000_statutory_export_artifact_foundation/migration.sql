BEGIN;

ALTER TYPE "PayrollStatutorySubmissionStatus"
  RENAME TO "PayrollStatutorySubmissionStatus_old";

CREATE TYPE "PayrollStatutorySubmissionStatus" AS ENUM (
  'DRAFT',
  'EXPORTED',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED'
);

ALTER TABLE "payroll_statutory_submissions"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "PayrollStatutorySubmissionStatus"
    USING ("status"::text::"PayrollStatutorySubmissionStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "PayrollStatutorySubmissionStatus_old";

CREATE TYPE "StatutoryArtifactIntegrityStatus" AS ENUM (
  'PENDING_ARTIFACT',
  'VERIFIED',
  'LEGACY_UNVERIFIED'
);

ALTER TABLE "payroll_statutory_submissions"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "integrity_status" "StatutoryArtifactIntegrityStatus" NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
  ADD COLUMN "supersedes_submission_id" UUID,
  ALTER COLUMN "export_version" DROP NOT NULL,
  ALTER COLUMN "exported_at" DROP DEFAULT,
  ALTER COLUMN "exported_at" DROP NOT NULL;

ALTER TABLE "payroll_statutory_submissions"
  ALTER COLUMN "integrity_status" SET DEFAULT 'PENDING_ARTIFACT';

DROP INDEX "payroll_statutory_submissions_payroll_run_id_provider_key";

CREATE UNIQUE INDEX "payroll_statutory_submissions_run_provider_revision_key"
  ON "payroll_statutory_submissions"("payroll_run_id", "provider", "revision");

CREATE UNIQUE INDEX "payroll_statutory_submissions_supersedes_key"
  ON "payroll_statutory_submissions"("supersedes_submission_id")
  WHERE "supersedes_submission_id" IS NOT NULL;

ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_supersedes_fkey"
  FOREIGN KEY ("supersedes_submission_id")
  REFERENCES "payroll_statutory_submissions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_statutory_export_artifacts" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "provider" "PayrollStatutoryProvider" NOT NULL,
  "revision" INTEGER NOT NULL,
  "export_version" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "plaintext_sha256" CHAR(64) NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "initialization_vector" BYTEA NOT NULL,
  "authentication_tag" BYTEA NOT NULL,
  "encryption_algorithm" TEXT NOT NULL DEFAULT 'AES-256-GCM',
  "encryption_key_version" TEXT NOT NULL,
  "aad_version" TEXT NOT NULL DEFAULT 'v1',
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_statutory_export_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_statutory_export_artifacts_byte_length_check" CHECK ("byte_length" >= 0),
  CONSTRAINT "payroll_statutory_export_artifacts_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "payroll_statutory_export_artifacts_sha256_check" CHECK ("plaintext_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payroll_statutory_export_artifacts_algorithm_check" CHECK ("encryption_algorithm" = 'AES-256-GCM'),
  CONSTRAINT "payroll_statutory_export_artifacts_iv_check" CHECK (octet_length("initialization_vector") = 12),
  CONSTRAINT "payroll_statutory_export_artifacts_tag_check" CHECK (octet_length("authentication_tag") = 16),
  CONSTRAINT "payroll_statutory_export_artifacts_submission_fkey"
    FOREIGN KEY ("submission_id") REFERENCES "payroll_statutory_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_statutory_export_artifacts_payroll_run_fkey"
    FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payroll_statutory_export_artifacts_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payroll_statutory_export_artifacts_submission_key"
  ON "payroll_statutory_export_artifacts"("submission_id");

CREATE UNIQUE INDEX "payroll_statutory_export_artifacts_run_provider_revision_key"
  ON "payroll_statutory_export_artifacts"("payroll_run_id", "provider", "revision");

CREATE INDEX "payroll_statutory_export_artifacts_business_provider_created_idx"
  ON "payroll_statutory_export_artifacts"("business_id", "provider", "created_at");

CREATE OR REPLACE FUNCTION "prevent_payroll_statutory_artifact_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Statutory export artifacts are immutable and cannot be updated or deleted.'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_statutory_export_artifacts_immutable"
BEFORE UPDATE OR DELETE ON "payroll_statutory_export_artifacts"
FOR EACH ROW EXECUTE FUNCTION "prevent_payroll_statutory_artifact_mutation"();

COMMIT;
