-- Payment P0: additive employee bank versioning and payroll payment integrity foundation.
-- This migration deliberately does not rewrite PayrollRun, PayrollEntry, Payslip,
-- Statutory Artifact, POS Payment, or any existing business data.

CREATE TYPE "EmployeeBankAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUPERSEDED', 'REJECTED');
CREATE TYPE "EmployeeBankVerificationStatus" AS ENUM ('UNVERIFIED', 'MANUALLY_VERIFIED', 'REJECTED');
CREATE TYPE "PayrollPaymentBatchType" AS ENUM ('ORIGINAL', 'CORRECTION');
CREATE TYPE "PayrollPaymentBatchStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'INSTRUCTION_READY', 'CANCELLED', 'SUPERSEDED');
CREATE TYPE "PayrollPaymentInstructionStatus" AS ENUM ('BLOCKED', 'READY', 'INCLUDED', 'EXCLUDED');
CREATE TYPE "PayrollPaymentBlockerCode" AS ENUM ('MISSING_BANK_ACCOUNT', 'BANK_ACCOUNT_UNVERIFIED', 'BANK_ACCOUNT_INACTIVE', 'BANK_ACCOUNT_NOT_EFFECTIVE', 'NET_PAY_ZERO', 'NET_PAY_NEGATIVE', 'DUPLICATE_PAYMENT_ALLOCATION', 'BUSINESS_MISMATCH');
CREATE TYPE "PayrollPaymentCommandType" AS ENUM ('CREATE_BANK_VERSION', 'VERIFY_BANK_VERSION', 'DEACTIVATE_BANK_VERSION', 'CREATE_BATCH', 'SUBMIT_BATCH', 'APPROVE_BATCH', 'CANCEL_BATCH', 'CREATE_CORRECTION_BATCH');
CREATE TYPE "PayrollPaymentEventAction" AS ENUM ('BANK_VERSION_CREATED', 'BANK_VERSION_VERIFIED', 'BANK_VERSION_DEACTIVATED', 'BATCH_CREATED', 'BATCH_SUBMITTED_FOR_APPROVAL', 'BATCH_APPROVED', 'BATCH_CANCELLED', 'CORRECTION_BATCH_CREATED', 'INSTRUCTION_BLOCKED', 'INSTRUCTION_READY', 'INSTRUCTION_EXCLUDED');

CREATE UNIQUE INDEX "payroll_runs_id_business_id_key" ON "payroll_runs"("id", "business_id");
CREATE UNIQUE INDEX "payroll_entries_id_business_id_key" ON "payroll_entries"("id", "business_id");

CREATE TABLE "employee_bank_account_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "employee_membership_id" UUID NOT NULL,
  "bank_code" VARCHAR(32) NOT NULL,
  "bank_name_snapshot" VARCHAR(160) NOT NULL,
  "account_holder_name" VARCHAR(160) NOT NULL,
  "account_number_ciphertext" BYTEA NOT NULL,
  "account_number_iv" BYTEA NOT NULL,
  "account_number_auth_tag" BYTEA NOT NULL,
  "encryption_key_version" VARCHAR(40) NOT NULL,
  "account_number_last_4" VARCHAR(4) NOT NULL,
  "account_number_fingerprint_hmac" CHAR(64) NOT NULL,
  "verification_status" "EmployeeBankVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "verification_method" VARCHAR(64),
  "verified_at" TIMESTAMP(3),
  "verified_by_id" UUID,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "effective_until" TIMESTAMP(3),
  "status" "EmployeeBankAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "is_primary" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedes_version_id" UUID,
  "superseded_by_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason_type" VARCHAR(64) NOT NULL,
  "reason_safe" VARCHAR(500),
  CONSTRAINT "employee_bank_account_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_bank_effective_dates_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from"),
  CONSTRAINT "employee_bank_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "employee_bank_last4_check" CHECK ("account_number_last_4" ~ '^[0-9A-Za-z]{1,4}$'),
  CONSTRAINT "employee_bank_fingerprint_check" CHECK ("account_number_fingerprint_hmac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "employee_bank_iv_check" CHECK (octet_length("account_number_iv") = 12),
  CONSTRAINT "employee_bank_tag_check" CHECK (octet_length("account_number_auth_tag") = 16),
  CONSTRAINT "employee_bank_no_self_supersession" CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id" <> "id")
);
CREATE UNIQUE INDEX "employee_bank_account_versions_id_business_key" ON "employee_bank_account_versions"("id", "business_id");
CREATE UNIQUE INDEX "employee_bank_account_versions_supersedes_key" ON "employee_bank_account_versions"("supersedes_version_id") WHERE "supersedes_version_id" IS NOT NULL;
CREATE INDEX "employee_bank_account_versions_member_status_effective_idx" ON "employee_bank_account_versions"("business_id", "employee_membership_id", "status", "effective_from");
CREATE INDEX "employee_bank_account_versions_fingerprint_idx" ON "employee_bank_account_versions"("account_number_fingerprint_hmac");
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_membership_business_fkey" FOREIGN KEY ("employee_membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_verified_by_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_superseded_by_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_bank_account_versions" ADD CONSTRAINT "employee_bank_supersedes_version_fkey" FOREIGN KEY ("supersedes_version_id", "business_id") REFERENCES "employee_bank_account_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_payment_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "batch_number" VARCHAR(80) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "batch_type" "PayrollPaymentBatchType" NOT NULL DEFAULT 'ORIGINAL',
  "status" "PayrollPaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "instruction_count" INTEGER NOT NULL DEFAULT 0,
  "ready_count" INTEGER NOT NULL DEFAULT 0,
  "blocked_count" INTEGER NOT NULL DEFAULT 0,
  "excluded_count" INTEGER NOT NULL DEFAULT 0,
  "total_ready_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "payroll_calculation_digest" CHAR(64) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "submitted_by_id" UUID,
  "approved_by_id" UUID,
  "cancelled_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "supersedes_batch_id" UUID,
  "superseded_by_id" UUID,
  "current_artifact_id" UUID,
  "reason_type" VARCHAR(64) NOT NULL,
  "reason_safe" VARCHAR(500),
  CONSTRAINT "payroll_payment_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_payment_batch_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "payroll_payment_batch_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "payroll_payment_batch_counts_check" CHECK ("instruction_count" >= 0 AND "ready_count" >= 0 AND "blocked_count" >= 0 AND "excluded_count" >= 0 AND "instruction_count" = "ready_count" + "blocked_count" + "excluded_count"),
  CONSTRAINT "payroll_payment_batch_amount_check" CHECK ("total_ready_amount" >= 0),
  CONSTRAINT "payroll_payment_batch_digest_check" CHECK ("payroll_calculation_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payroll_payment_batch_no_self_supersession" CHECK (("supersedes_batch_id" IS NULL OR "supersedes_batch_id" <> "id") AND ("superseded_by_id" IS NULL OR "superseded_by_id" <> "id")),
  CONSTRAINT "payroll_payment_batch_maker_checker" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "created_by_id")
);
CREATE UNIQUE INDEX "payroll_payment_batches_id_business_key" ON "payroll_payment_batches"("id", "business_id");
CREATE UNIQUE INDEX "payroll_payment_batches_run_revision_key" ON "payroll_payment_batches"("payroll_run_id", "revision");
CREATE UNIQUE INDEX "payroll_payment_batches_business_number_key" ON "payroll_payment_batches"("business_id", "batch_number");
CREATE UNIQUE INDEX "payroll_payment_batches_one_active_run_key" ON "payroll_payment_batches"("payroll_run_id") WHERE "status" IN ('DRAFT','AWAITING_APPROVAL','APPROVED','INSTRUCTION_READY');
CREATE INDEX "payroll_payment_batches_business_status_created_idx" ON "payroll_payment_batches"("business_id", "status", "created_at");
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_run_business_fkey" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_submitted_by_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_approved_by_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_cancelled_by_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_supersedes_fkey" FOREIGN KEY ("supersedes_batch_id", "business_id") REFERENCES "payroll_payment_batches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_superseded_by_fkey" FOREIGN KEY ("superseded_by_id", "business_id") REFERENCES "payroll_payment_batches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_payment_instructions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payment_batch_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "employee_membership_id" UUID NOT NULL,
  "bank_account_version_id" UUID,
  "employee_name_snapshot" TEXT NOT NULL,
  "employee_code_snapshot" TEXT NOT NULL,
  "bank_code_snapshot" VARCHAR(32),
  "bank_name_snapshot" VARCHAR(160),
  "account_holder_name_snapshot" VARCHAR(160),
  "account_number_ciphertext_snapshot" BYTEA,
  "account_number_iv_snapshot" BYTEA,
  "account_number_auth_tag_snapshot" BYTEA,
  "encryption_key_version_snapshot" VARCHAR(40),
  "account_number_last_4_snapshot" VARCHAR(4),
  "account_fingerprint_snapshot" CHAR(64),
  "net_pay_snapshot" DECIMAL(14,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "reference" VARCHAR(140) NOT NULL,
  "status" "PayrollPaymentInstructionStatus" NOT NULL,
  "blocker_code" "PayrollPaymentBlockerCode",
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_payment_instructions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_payment_instruction_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "payroll_payment_instruction_state_check" CHECK (("status" = 'BLOCKED' AND "blocker_code" IS NOT NULL) OR ("status" <> 'BLOCKED' AND "blocker_code" IS NULL)),
  CONSTRAINT "payroll_payment_instruction_crypto_check" CHECK (("bank_account_version_id" IS NULL AND "account_number_ciphertext_snapshot" IS NULL AND "account_number_iv_snapshot" IS NULL AND "account_number_auth_tag_snapshot" IS NULL) OR ("bank_account_version_id" IS NOT NULL AND "account_number_ciphertext_snapshot" IS NOT NULL AND octet_length("account_number_iv_snapshot") = 12 AND octet_length("account_number_auth_tag_snapshot") = 16))
);
CREATE UNIQUE INDEX "payroll_payment_instructions_id_business_key" ON "payroll_payment_instructions"("id", "business_id");
CREATE UNIQUE INDEX "payroll_payment_instructions_batch_entry_key" ON "payroll_payment_instructions"("payment_batch_id", "payroll_entry_id");
CREATE INDEX "payroll_payment_instructions_business_member_idx" ON "payroll_payment_instructions"("business_id", "employee_membership_id");
CREATE INDEX "payroll_payment_instructions_bank_version_idx" ON "payroll_payment_instructions"("bank_account_version_id");
ALTER TABLE "payroll_payment_instructions" ADD CONSTRAINT "payroll_payment_instruction_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_instructions" ADD CONSTRAINT "payroll_payment_instruction_batch_business_fkey" FOREIGN KEY ("payment_batch_id", "business_id") REFERENCES "payroll_payment_batches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_instructions" ADD CONSTRAINT "payroll_payment_instruction_entry_business_fkey" FOREIGN KEY ("payroll_entry_id", "business_id") REFERENCES "payroll_entries"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_instructions" ADD CONSTRAINT "payroll_payment_instruction_member_business_fkey" FOREIGN KEY ("employee_membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_instructions" ADD CONSTRAINT "payroll_payment_instruction_bank_business_fkey" FOREIGN KEY ("bank_account_version_id", "business_id") REFERENCES "employee_bank_account_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_payment_command_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "command_id" VARCHAR(128) NOT NULL,
  "command_type" "PayrollPaymentCommandType" NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_safe" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_payment_command_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_payment_command_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "payroll_payment_command_actor_command_key" ON "payroll_payment_command_records"("business_id", "actor_id", "command_id");
CREATE INDEX "payroll_payment_command_type_created_idx" ON "payroll_payment_command_records"("business_id", "command_type", "created_at");
ALTER TABLE "payroll_payment_command_records" ADD CONSTRAINT "payroll_payment_command_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_command_records" ADD CONSTRAINT "payroll_payment_command_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_payment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "batch_id" UUID,
  "instruction_id" UUID,
  "bank_account_version_id" UUID,
  "action" "PayrollPaymentEventAction" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason_type" VARCHAR(64) NOT NULL,
  "reason_safe" VARCHAR(500),
  "metadata_safe" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_payment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_payment_events_business_created_idx" ON "payroll_payment_events"("business_id", "created_at");
CREATE INDEX "payroll_payment_events_batch_created_idx" ON "payroll_payment_events"("batch_id", "created_at");
CREATE INDEX "payroll_payment_events_bank_created_idx" ON "payroll_payment_events"("bank_account_version_id", "created_at");
ALTER TABLE "payroll_payment_events" ADD CONSTRAINT "payroll_payment_event_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_events" ADD CONSTRAINT "payroll_payment_event_batch_fkey" FOREIGN KEY ("batch_id", "business_id") REFERENCES "payroll_payment_batches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_events" ADD CONSTRAINT "payroll_payment_event_instruction_fkey" FOREIGN KEY ("instruction_id", "business_id") REFERENCES "payroll_payment_instructions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_events" ADD CONSTRAINT "payroll_payment_event_bank_fkey" FOREIGN KEY ("bank_account_version_id", "business_id") REFERENCES "employee_bank_account_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_events" ADD CONSTRAINT "payroll_payment_event_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_payment_artifacts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payment_batch_id" UUID NOT NULL,
  "provider_key" VARCHAR(80) NOT NULL,
  "format_version" VARCHAR(40) NOT NULL,
  "revision" INTEGER NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "iv" BYTEA NOT NULL,
  "auth_tag" BYTEA NOT NULL,
  "encryption_key_version" VARCHAR(40) NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "record_count" INTEGER NOT NULL,
  "filename" TEXT NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_payment_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_payment_artifact_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "payroll_payment_artifact_sha_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payroll_payment_artifact_size_check" CHECK ("byte_length" >= 0 AND "record_count" >= 0),
  CONSTRAINT "payroll_payment_artifact_iv_check" CHECK (octet_length("iv") = 12),
  CONSTRAINT "payroll_payment_artifact_tag_check" CHECK (octet_length("auth_tag") = 16)
);
CREATE UNIQUE INDEX "payroll_payment_artifacts_id_business_key" ON "payroll_payment_artifacts"("id", "business_id");
CREATE UNIQUE INDEX "payroll_payment_artifacts_batch_provider_revision_key" ON "payroll_payment_artifacts"("payment_batch_id", "provider_key", "revision");
CREATE INDEX "payroll_payment_artifacts_business_created_idx" ON "payroll_payment_artifacts"("business_id", "created_at");
ALTER TABLE "payroll_payment_artifacts" ADD CONSTRAINT "payroll_payment_artifact_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_artifacts" ADD CONSTRAINT "payroll_payment_artifact_batch_business_fkey" FOREIGN KEY ("payment_batch_id", "business_id") REFERENCES "payroll_payment_batches"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_artifacts" ADD CONSTRAINT "payroll_payment_artifact_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches" ADD CONSTRAINT "payroll_payment_batch_current_artifact_fkey" FOREIGN KEY ("current_artifact_id") REFERENCES "payroll_payment_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bank versions are append-only facts. Only controlled lifecycle fields may change.
CREATE OR REPLACE FUNCTION tetamu_guard_employee_bank_version() RETURNS trigger AS $$
DECLARE overlap_count INTEGER; prior_membership_id UUID;
BEGIN
  IF current_setting('tetamu.payroll_payment_test_maintenance', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employee bank account versions are append-only.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."supersedes_version_id" IS NOT NULL THEN
      SELECT "employee_membership_id" INTO prior_membership_id
      FROM "employee_bank_account_versions"
      WHERE "id" = NEW."supersedes_version_id" AND "business_id" = NEW."business_id";
      IF prior_membership_id IS NULL OR prior_membership_id <> NEW."employee_membership_id" THEN
        RAISE EXCEPTION 'A bank account version may supersede only the same employee in the same business.';
      END IF;
    END IF;
    IF NEW."is_primary" AND NEW."status" = 'ACTIVE' THEN
      SELECT count(*) INTO overlap_count FROM "employee_bank_account_versions" v
      WHERE v."business_id" = NEW."business_id"
        AND v."employee_membership_id" = NEW."employee_membership_id"
        AND v."is_primary" AND v."status" = 'ACTIVE'
        AND tsrange(v."effective_from", COALESCE(v."effective_until", 'infinity'), '[)') && tsrange(NEW."effective_from", COALESCE(NEW."effective_until", 'infinity'), '[)');
      IF overlap_count > 0 THEN RAISE EXCEPTION 'An active primary salary account already overlaps this effective period.'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'ACTIVE' THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Superseded or inactive employee bank versions are immutable.'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = OLD."status"
    AND (to_jsonb(NEW) - 'verification_status' - 'verification_method' - 'verified_at' - 'verified_by_id')
      = (to_jsonb(OLD) - 'verification_status' - 'verification_method' - 'verified_at' - 'verified_by_id')
    AND OLD."verification_status" = 'UNVERIFIED'
    AND NEW."verification_status" IN ('MANUALLY_VERIFIED', 'REJECTED')
    AND NEW."verified_at" IS NOT NULL
    AND NEW."verified_by_id" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."status" = 'SUPERSEDED'
    AND OLD."effective_until" IS NULL
    AND NEW."effective_until" IS NOT NULL
    AND NEW."superseded_by_id" IS NOT NULL
    AND (to_jsonb(NEW) - 'status' - 'effective_until' - 'superseded_by_id')
      = (to_jsonb(OLD) - 'status' - 'effective_until' - 'superseded_by_id') THEN
    RETURN NEW;
  END IF;
  IF NEW."status" = 'INACTIVE'
    AND NEW."superseded_by_id" IS NOT NULL
    AND (to_jsonb(NEW) - 'status' - 'effective_until' - 'superseded_by_id')
      = (to_jsonb(OLD) - 'status' - 'effective_until' - 'superseded_by_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Employee bank account version facts are immutable; create a superseding version.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_bank_version_guard" BEFORE INSERT OR UPDATE OR DELETE ON "employee_bank_account_versions" FOR EACH ROW EXECUTE FUNCTION tetamu_guard_employee_bank_version();
CREATE TRIGGER "employee_bank_version_no_truncate" BEFORE TRUNCATE ON "employee_bank_account_versions" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_guard_employee_bank_version();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_payment_batch() RETURNS trigger AS $$
DECLARE run_status "PayrollRunStatus"; prior_batch RECORD;
BEGIN
  IF current_setting('tetamu.payroll_payment_test_maintenance', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll payment batches cannot be deleted or truncated.'; END IF;
  SELECT "status" INTO run_status FROM "payroll_runs" WHERE "id" = NEW."payroll_run_id" AND "business_id" = NEW."business_id";
  IF run_status IS DISTINCT FROM 'FINALIZED' THEN RAISE EXCEPTION 'Payroll payment batches require a finalized payroll run.'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."batch_type" = 'ORIGINAL' AND NEW."supersedes_batch_id" IS NOT NULL THEN
      RAISE EXCEPTION 'An original payment batch cannot supersede another batch.';
    END IF;
    IF NEW."batch_type" = 'CORRECTION' THEN
      IF NEW."supersedes_batch_id" IS NULL THEN
        RAISE EXCEPTION 'A correction payment batch must reference its cancelled predecessor.';
      END IF;
      SELECT "payroll_run_id", "business_id", "status" INTO prior_batch
      FROM "payroll_payment_batches"
      WHERE "id" = NEW."supersedes_batch_id" AND "business_id" = NEW."business_id";
      IF prior_batch."payroll_run_id" IS DISTINCT FROM NEW."payroll_run_id"
        OR prior_batch."status" IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'A correction payment batch must supersede a cancelled batch for the same payroll run.';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('APPROVED','INSTRUCTION_READY','CANCELLED','SUPERSEDED') THEN
    IF OLD."status" = 'APPROVED'
      AND NEW."status" = 'INSTRUCTION_READY'
      AND OLD."current_artifact_id" IS NULL
      AND NEW."current_artifact_id" IS NOT NULL
      AND (to_jsonb(NEW) - 'status' - 'current_artifact_id') = (to_jsonb(OLD) - 'status' - 'current_artifact_id') THEN
      RETURN NEW;
    END IF;
    IF OLD."status" = 'CANCELLED'
      AND OLD."superseded_by_id" IS NULL
      AND NEW."superseded_by_id" IS NOT NULL
      AND (to_jsonb(NEW) - 'superseded_by_id') = (to_jsonb(OLD) - 'superseded_by_id') THEN
      RETURN NEW;
    END IF;
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Approved or terminal payroll payment batch facts are immutable.'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'DRAFT' AND NEW."status" = 'AWAITING_APPROVAL'
    AND NEW."submitted_by_id" IS NOT NULL AND NEW."submitted_at" IS NOT NULL
    AND (to_jsonb(NEW) - 'status' - 'submitted_by_id' - 'submitted_at') = (to_jsonb(OLD) - 'status' - 'submitted_by_id' - 'submitted_at') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('DRAFT','AWAITING_APPROVAL') AND NEW."status" = 'CANCELLED'
    AND NEW."cancelled_by_id" IS NOT NULL AND NEW."cancelled_at" IS NOT NULL
    AND (to_jsonb(NEW) - 'status' - 'cancelled_by_id' - 'cancelled_at') = (to_jsonb(OLD) - 'status' - 'cancelled_by_id' - 'cancelled_at') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'AWAITING_APPROVAL' AND NEW."status" = 'APPROVED'
    AND NEW."approved_by_id" IS NOT NULL AND NEW."approved_at" IS NOT NULL
    AND (to_jsonb(NEW) - 'status' - 'approved_by_id' - 'approved_at') = (to_jsonb(OLD) - 'status' - 'approved_by_id' - 'approved_at') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Payroll payment batch changes must follow the controlled state machine.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_payment_batch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_payment_batches" FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_payment_batch();
CREATE TRIGGER "payroll_payment_batch_no_truncate" BEFORE TRUNCATE ON "payroll_payment_batches" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_guard_payroll_payment_batch();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_payment_instruction() RETURNS trigger AS $$
DECLARE batch_record RECORD; entry_record RECORD; bank_record RECORD;
BEGIN
  IF current_setting('tetamu.payroll_payment_test_maintenance', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'TRUNCATE' OR TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll payment instructions cannot be deleted or truncated.'; END IF;
  SELECT "payroll_run_id", "business_id", "status" INTO batch_record FROM "payroll_payment_batches" WHERE "id" = NEW."payment_batch_id";
  SELECT "payroll_run_id", "business_id", "membership_id" INTO entry_record FROM "payroll_entries" WHERE "id" = NEW."payroll_entry_id";
  IF batch_record."business_id" <> NEW."business_id" OR entry_record."business_id" <> NEW."business_id" OR entry_record."payroll_run_id" <> batch_record."payroll_run_id" OR entry_record."membership_id" <> NEW."employee_membership_id" THEN
    RAISE EXCEPTION 'Payroll payment instruction identity does not match its batch, payroll entry, or employee.';
  END IF;
  IF NEW."bank_account_version_id" IS NOT NULL THEN
    SELECT "business_id", "employee_membership_id" INTO bank_record FROM "employee_bank_account_versions" WHERE "id" = NEW."bank_account_version_id";
    IF bank_record."business_id" <> NEW."business_id" OR bank_record."employee_membership_id" <> NEW."employee_membership_id" THEN RAISE EXCEPTION 'Payroll payment instruction bank version is outside its employee scope.'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND batch_record."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Payment instructions are immutable after the batch leaves draft.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_payment_instruction_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_payment_instructions" FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_payment_instruction();
CREATE TRIGGER "payroll_payment_instruction_no_truncate" BEFORE TRUNCATE ON "payroll_payment_instructions" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_guard_payroll_payment_instruction();

CREATE OR REPLACE FUNCTION tetamu_reject_payment_append_only_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('tetamu.payroll_payment_test_maintenance', TRUE) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Payroll payment integrity records are append-only.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_payment_command_guard" BEFORE UPDATE OR DELETE ON "payroll_payment_command_records" FOR EACH ROW EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
CREATE TRIGGER "payroll_payment_command_no_truncate" BEFORE TRUNCATE ON "payroll_payment_command_records" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
CREATE TRIGGER "payroll_payment_event_guard" BEFORE UPDATE OR DELETE ON "payroll_payment_events" FOR EACH ROW EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
CREATE TRIGGER "payroll_payment_event_no_truncate" BEFORE TRUNCATE ON "payroll_payment_events" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
CREATE TRIGGER "payroll_payment_artifact_guard" BEFORE UPDATE OR DELETE ON "payroll_payment_artifacts" FOR EACH ROW EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
CREATE TRIGGER "payroll_payment_artifact_no_truncate" BEFORE TRUNCATE ON "payroll_payment_artifacts" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_payment_append_only_mutation();
