-- Phase 4.0C: monthly-effective employee compensation versions.
-- This migration is additive. Existing Payroll Entry amounts and snapshots are not rewritten.

CREATE TYPE "EmployeeCompensationVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
CREATE TYPE "EmployeeCompensationSource" AS ENUM ('LEGACY_BASELINE', 'MANUAL', 'DATA_MIGRATION', 'SYSTEM');
CREATE TYPE "EmployeeCompensationReasonType" AS ENUM (
  'PROMOTION',
  'ANNUAL_INCREMENT',
  'SALARY_CORRECTION',
  'ROLE_CHANGE',
  'MARKET_ADJUSTMENT',
  'PAYROLL_POLICY_CHANGE',
  'DATA_MIGRATION',
  'OTHER'
);

ALTER TABLE "employee_business_memberships"
  ADD CONSTRAINT "employee_business_memberships_id_business_id_key"
  UNIQUE ("id", "business_id");

CREATE TABLE "employee_compensation_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "pay_basis" "EmployeePayBasis" NOT NULL,
  "base_rate" DECIMAL(12,2) NOT NULL,
  "status" "EmployeeCompensationVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "EmployeeCompensationSource" NOT NULL,
  "reason_type" "EmployeeCompensationReasonType" NOT NULL,
  "reason_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersedes_version_id" UUID,
  "superseded_at" TIMESTAMP(3),
  "superseded_by_id" UUID,

  CONSTRAINT "employee_compensation_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_compensation_versions_month_start_check"
    CHECK ("effective_from_month" = date_trunc('month', "effective_from_month")::date),
  CONSTRAINT "employee_compensation_versions_nonnegative_rate_check"
    CHECK ("base_rate" >= 0),
  CONSTRAINT "employee_compensation_versions_no_self_supersession_check"
    CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id" <> "id"),
  CONSTRAINT "employee_compensation_versions_superseded_state_check"
    CHECK (
      ("status" = 'ACTIVE' AND "superseded_at" IS NULL AND "superseded_by_id" IS NULL)
      OR
      ("status" = 'SUPERSEDED' AND "superseded_at" IS NOT NULL)
    )
);

CREATE INDEX "employee_compensation_versions_business_membership_month_idx"
  ON "employee_compensation_versions"("business_id", "membership_id", "effective_from_month");
CREATE INDEX "employee_compensation_versions_membership_status_month_idx"
  ON "employee_compensation_versions"("membership_id", "status", "effective_from_month");
CREATE INDEX "employee_compensation_versions_supersedes_version_id_idx"
  ON "employee_compensation_versions"("supersedes_version_id");
CREATE UNIQUE INDEX "employee_compensation_versions_active_month_key"
  ON "employee_compensation_versions"("membership_id", "effective_from_month")
  WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "employee_compensation_versions_single_successor_key"
  ON "employee_compensation_versions"("supersedes_version_id")
  WHERE "supersedes_version_id" IS NOT NULL;

ALTER TABLE "employee_compensation_versions"
  ADD CONSTRAINT "employee_compensation_versions_business_id_fkey"
  FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_compensation_versions_membership_business_fkey"
  FOREIGN KEY ("membership_id", "business_id")
  REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_compensation_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_compensation_versions_superseded_by_id_fkey"
  FOREIGN KEY ("superseded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_compensation_versions_supersedes_version_id_fkey"
  FOREIGN KEY ("supersedes_version_id") REFERENCES "employee_compensation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_entries"
  ADD COLUMN "compensation_version_id" UUID,
  ADD COLUMN "compensation_effective_from_month_snapshot" DATE,
  ADD COLUMN "compensation_source_snapshot" "EmployeeCompensationSource";

CREATE INDEX "payroll_entries_compensation_version_id_idx"
  ON "payroll_entries"("compensation_version_id");

ALTER TABLE "payroll_entries"
  ADD CONSTRAINT "payroll_entries_compensation_version_id_fkey"
  FOREIGN KEY ("compensation_version_id") REFERENCES "employee_compensation_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_compensation_version()
RETURNS trigger AS $$
DECLARE
  predecessor RECORD;
BEGIN
  IF current_setting('tetamu.compensation_version_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employee compensation versions are append-only and cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'SUPERSEDED' THEN
      RAISE EXCEPTION 'A superseded compensation version is immutable.';
    END IF;
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."effective_from_month" IS DISTINCT FROM OLD."effective_from_month"
      OR NEW."pay_basis" IS DISTINCT FROM OLD."pay_basis"
      OR NEW."base_rate" IS DISTINCT FROM OLD."base_rate"
      OR NEW."source" IS DISTINCT FROM OLD."source"
      OR NEW."reason_type" IS DISTINCT FROM OLD."reason_type"
      OR NEW."reason_note" IS DISTINCT FROM OLD."reason_note"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
      OR NEW."supersedes_version_id" IS DISTINCT FROM OLD."supersedes_version_id" THEN
      RAISE EXCEPTION 'Compensation version facts are immutable; create a superseding version.';
    END IF;
    IF NEW."status" <> 'SUPERSEDED' OR NEW."superseded_at" IS NULL THEN
      RAISE EXCEPTION 'The only permitted compensation version update is ACTIVE to SUPERSEDED.';
    END IF;
  END IF;

  IF NEW."supersedes_version_id" IS NOT NULL THEN
    SELECT "id", "business_id", "membership_id", "effective_from_month"
      INTO predecessor
      FROM "employee_compensation_versions"
      WHERE "id" = NEW."supersedes_version_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The superseded compensation version does not exist.';
    END IF;
    IF predecessor."business_id" <> NEW."business_id"
      OR predecessor."membership_id" <> NEW."membership_id" THEN
      RAISE EXCEPTION 'A compensation version may only supersede the same employee membership.';
    END IF;
    IF predecessor."effective_from_month" <> NEW."effective_from_month" THEN
      RAISE EXCEPTION 'A correction may only supersede a version for the same effective month.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_compensation_versions_guard_insert"
  BEFORE INSERT ON "employee_compensation_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_compensation_version();
CREATE TRIGGER "employee_compensation_versions_guard_update"
  BEFORE UPDATE ON "employee_compensation_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_compensation_version();
CREATE TRIGGER "employee_compensation_versions_guard_delete"
  BEFORE DELETE ON "employee_compensation_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_compensation_version();

-- Activation baseline: this records the verified configuration at the Phase 4.0C
-- activation month only. It does not claim that earlier payrolls used these values.
INSERT INTO "employee_compensation_versions" (
  "business_id",
  "membership_id",
  "effective_from_month",
  "pay_basis",
  "base_rate",
  "status",
  "source",
  "reason_type"
)
SELECT
  membership."business_id",
  membership."id",
  DATE '2026-08-01',
  membership."pay_basis",
  membership."base_salary",
  'ACTIVE',
  'LEGACY_BASELINE',
  'DATA_MIGRATION'
FROM "employee_business_memberships" membership
WHERE membership."base_salary" IS NOT NULL;

INSERT INTO "audit_logs" (
  "id",
  "business_id",
  "action",
  "entity_type",
  "entity_id",
  "summary",
  "metadata"
)
SELECT
  gen_random_uuid(),
  version."business_id",
  'EMPLOYEE_COMPENSATION_BASELINE_CREATED',
  'EmployeeCompensationVersion',
  version."id",
  'Legacy compensation baseline created for the Phase 4.0C activation month.',
  jsonb_build_object(
    'membershipId', version."membership_id",
    'versionId', version."id",
    'effectiveMonth', to_char(version."effective_from_month", 'YYYY-MM'),
    'payBasis', version."pay_basis",
    'source', version."source",
    'baseRate', '[REDACTED]',
    'result', 'CREATED'
  )
FROM "employee_compensation_versions" version
WHERE version."source" = 'LEGACY_BASELINE'
  AND version."effective_from_month" = DATE '2026-08-01';
