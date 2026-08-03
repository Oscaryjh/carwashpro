-- Phase 4.0D: canonical, idempotent employee payroll-profile writes.
-- Additive only: existing payroll entries, compensation versions, artifacts,
-- submissions and membership values are not rewritten.

ALTER TYPE "EmployeeCompensationReasonType" ADD VALUE IF NOT EXISTS 'STATUTORY_CORRECTION';
ALTER TYPE "EmployeeCompensationReasonType" ADD VALUE IF NOT EXISTS 'TAX_INFORMATION_UPDATE';
ALTER TYPE "EmployeeCompensationReasonType" ADD VALUE IF NOT EXISTS 'EMPLOYEE_PROVIDED_CORRECTION';

CREATE TYPE "PayrollProfileCommandDomain" AS ENUM (
  'COMPENSATION',
  'WORK_TARGET',
  'STATUTORY',
  'TAX'
);

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "compensation_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "work_target_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "statutory_profile_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tax_profile_revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "employee_membership_compensation_revision_check" CHECK ("compensation_revision" >= 0),
  ADD CONSTRAINT "employee_membership_work_target_revision_check" CHECK ("work_target_revision" >= 0),
  ADD CONSTRAINT "employee_membership_statutory_revision_check" CHECK ("statutory_profile_revision" >= 0),
  ADD CONSTRAINT "employee_membership_tax_revision_check" CHECK ("tax_profile_revision" >= 0);

CREATE TABLE "payroll_profile_command_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "command_id" VARCHAR(128) NOT NULL,
  "command_fingerprint" VARCHAR(64) NOT NULL,
  "domain" "PayrollProfileCommandDomain" NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_profile_command_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_profile_command_id_nonempty_check" CHECK (length(btrim("command_id")) > 0),
  CONSTRAINT "payroll_profile_command_fingerprint_check" CHECK ("command_fingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "payroll_profile_command_actor_command_key"
  ON "payroll_profile_command_records"("business_id", "actor_user_id", "command_id");
CREATE INDEX "payroll_profile_command_membership_domain_created_idx"
  ON "payroll_profile_command_records"("business_id", "membership_id", "domain", "created_at");

ALTER TABLE "payroll_profile_command_records"
  ADD CONSTRAINT "payroll_profile_command_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_profile_command_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_profile_command_membership_business_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_profile_command_record()
RETURNS trigger AS $$
BEGIN
  IF current_setting('tetamu.payroll_profile_command_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Payroll profile command records are append-only.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_profile_command_records_guard_update"
  BEFORE UPDATE ON "payroll_profile_command_records"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_profile_command_record();
CREATE TRIGGER "payroll_profile_command_records_guard_delete"
  BEFORE DELETE ON "payroll_profile_command_records"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_profile_command_record();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_profile_direct_write()
RETURNS trigger AS $$
BEGIN
  IF current_setting('tetamu.payroll_profile_command', true) = 'on'
     OR current_setting('tetamu.payroll_profile_command_maintenance', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW."pay_basis" IS DISTINCT FROM OLD."pay_basis"
    OR NEW."base_salary" IS DISTINCT FROM OLD."base_salary"
    OR NEW."normal_work_minutes_per_day" IS DISTINCT FROM OLD."normal_work_minutes_per_day"
    OR NEW."target_break_minutes" IS DISTINCT FROM OLD."target_break_minutes"
    OR NEW."statutory_nationality" IS DISTINCT FROM OLD."statutory_nationality"
    OR NEW."epf_enabled" IS DISTINCT FROM OLD."epf_enabled"
    OR NEW."epf_member_before_aug_1998" IS DISTINCT FROM OLD."epf_member_before_aug_1998"
    OR NEW."socso_enabled" IS DISTINCT FROM OLD."socso_enabled"
    OR NEW."socso_category" IS DISTINCT FROM OLD."socso_category"
    OR NEW."eis_enabled" IS DISTINCT FROM OLD."eis_enabled"
    OR NEW."eis_previously_contributed" IS DISTINCT FROM OLD."eis_previously_contributed"
    OR NEW."lindung_24_opt_in" IS DISTINCT FROM OLD."lindung_24_opt_in"
    OR NEW."statutory_identity_type" IS DISTINCT FROM OLD."statutory_identity_type"
    OR NEW."statutory_identity_number" IS DISTINCT FROM OLD."statutory_identity_number"
    OR NEW."statutory_country_code" IS DISTINCT FROM OLD."statutory_country_code"
    OR NEW."epf_member_number" IS DISTINCT FROM OLD."epf_member_number"
    OR NEW."socso_member_number" IS DISTINCT FROM OLD."socso_member_number"
    OR NEW."tax_identification_number" IS DISTINCT FROM OLD."tax_identification_number"
    OR NEW."compensation_revision" IS DISTINCT FROM OLD."compensation_revision"
    OR NEW."work_target_revision" IS DISTINCT FROM OLD."work_target_revision"
    OR NEW."statutory_profile_revision" IS DISTINCT FROM OLD."statutory_profile_revision"
    OR NEW."tax_profile_revision" IS DISTINCT FROM OLD."tax_profile_revision" THEN
    RAISE EXCEPTION 'Payroll profile fields must be changed through the canonical command service.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_membership_payroll_profile_write_guard"
  BEFORE UPDATE ON "employee_business_memberships"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_profile_direct_write();
