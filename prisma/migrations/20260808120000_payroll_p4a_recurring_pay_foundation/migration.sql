-- Payroll P4A: fixed recurring earnings and deductions with immutable,
-- monthly-effective history and component-level Payroll Entry snapshots.
-- Additive only: no legacy salary or Payroll Entry value is rewritten.

ALTER TYPE "PayrollProfileCommandDomain" ADD VALUE IF NOT EXISTS 'RECURRING_PAY';

CREATE TYPE "EmployeeRecurringPayComponentType" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "EmployeeRecurringPayVersionState" AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE "EmployeeRecurringPayVersionStatus" AS ENUM ('CURRENT', 'SUPERSEDED');

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "recurring_pay_revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "employee_membership_recurring_pay_revision_check"
    CHECK ("recurring_pay_revision" >= 0);

ALTER TABLE "payroll_entries"
  ADD COLUMN "recurring_allowances_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "recurring_deductions_snapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT "payroll_entries_recurring_allowances_nonnegative_check"
    CHECK ("recurring_allowances_snapshot" >= 0),
  ADD CONSTRAINT "payroll_entries_recurring_deductions_nonnegative_check"
    CHECK ("recurring_deductions_snapshot" >= 0);

ALTER TABLE "payroll_entries"
  ADD CONSTRAINT "payroll_entries_id_business_membership_key"
    UNIQUE ("id", "business_id", "membership_id");

CREATE TABLE "employee_recurring_pay_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "type" "EmployeeRecurringPayComponentType" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,

  CONSTRAINT "employee_recurring_pay_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_recurring_pay_component_code_check" CHECK (
    "code" ~ '^[A-Z][A-Z0-9_]{1,63}$'
    AND "code" NOT IN ('BASIC_SALARY', 'EPF', 'SOCSO', 'EIS', 'PCB')
    AND "code" NOT LIKE 'COMMISSION%'
  ),
  CONSTRAINT "employee_recurring_pay_components_id_business_key"
    UNIQUE ("id", "business_id"),
  CONSTRAINT "employee_recurring_pay_components_identity_key"
    UNIQUE ("id", "business_id", "membership_id"),
  CONSTRAINT "employee_recurring_pay_components_business_member_code_key"
    UNIQUE ("business_id", "membership_id", "code")
);

CREATE INDEX "employee_recurring_pay_components_business_member_type_idx"
  ON "employee_recurring_pay_components"("business_id", "membership_id", "type");

ALTER TABLE "employee_recurring_pay_components"
  ADD CONSTRAINT "employee_recurring_pay_components_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_components_membership_business_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_components_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "employee_recurring_pay_component_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "component_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "state" "EmployeeRecurringPayVersionState" NOT NULL DEFAULT 'ACTIVE',
  "status" "EmployeeRecurringPayVersionStatus" NOT NULL DEFAULT 'CURRENT',
  "name" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "source" "EmployeeCompensationSource" NOT NULL,
  "reason_type" "EmployeeCompensationReasonType" NOT NULL,
  "reason_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "supersedes_version_id" UUID,
  "superseded_at" TIMESTAMP(3),
  "superseded_by_id" UUID,

  CONSTRAINT "employee_recurring_pay_component_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_recurring_pay_versions_id_business_key" UNIQUE ("id", "business_id"),
  CONSTRAINT "employee_recurring_pay_versions_snapshot_scope_key"
    UNIQUE ("id", "business_id", "membership_id", "component_id"),
  CONSTRAINT "employee_recurring_pay_versions_component_revision_key" UNIQUE ("component_id", "revision"),
  CONSTRAINT "employee_recurring_pay_versions_month_start_check"
    CHECK ("effective_from_month" = date_trunc('month', "effective_from_month")::date),
  CONSTRAINT "employee_recurring_pay_versions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "employee_recurring_pay_versions_name_check" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "employee_recurring_pay_versions_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "employee_recurring_pay_versions_amount_state_check" CHECK (
    ("state" = 'ACTIVE' AND "amount" > 0)
    OR ("state" = 'ENDED' AND "amount" = 0)
  ),
  CONSTRAINT "employee_recurring_pay_versions_superseded_state_check" CHECK (
    ("status" = 'CURRENT' AND "superseded_at" IS NULL AND "superseded_by_id" IS NULL)
    OR ("status" = 'SUPERSEDED' AND "superseded_at" IS NOT NULL)
  ),
  CONSTRAINT "employee_recurring_pay_versions_no_self_supersession_check"
    CHECK ("supersedes_version_id" IS NULL OR "supersedes_version_id" <> "id")
);

CREATE UNIQUE INDEX "employee_recurring_pay_versions_current_month_key"
  ON "employee_recurring_pay_component_versions"("component_id", "effective_from_month")
  WHERE "status" = 'CURRENT';
CREATE UNIQUE INDEX "employee_recurring_pay_versions_single_successor_key"
  ON "employee_recurring_pay_component_versions"("supersedes_version_id")
  WHERE "supersedes_version_id" IS NOT NULL;
CREATE INDEX "employee_recurring_pay_versions_business_member_month_idx"
  ON "employee_recurring_pay_component_versions"("business_id", "membership_id", "effective_from_month");
CREATE INDEX "employee_recurring_pay_versions_component_status_month_idx"
  ON "employee_recurring_pay_component_versions"("component_id", "status", "effective_from_month");
CREATE INDEX "employee_recurring_pay_versions_supersedes_idx"
  ON "employee_recurring_pay_component_versions"("supersedes_version_id");

ALTER TABLE "employee_recurring_pay_component_versions"
  ADD CONSTRAINT "employee_recurring_pay_versions_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_versions_component_scope_fkey"
    FOREIGN KEY ("component_id", "business_id", "membership_id")
    REFERENCES "employee_recurring_pay_components"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_versions_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_versions_superseded_by_fkey"
    FOREIGN KEY ("superseded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_pay_versions_supersedes_fkey"
    FOREIGN KEY ("supersedes_version_id") REFERENCES "employee_recurring_pay_component_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_entry_recurring_pay_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "source_component_id" UUID NOT NULL,
  "source_version_id" UUID NOT NULL,
  "source_revision" INTEGER NOT NULL,
  "type" "EmployeeRecurringPayComponentType" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "effective_from_month" DATE NOT NULL,
  "calculation_basis" VARCHAR(32) NOT NULL DEFAULT 'FIXED_MONTHLY',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_entry_recurring_pay_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_entry_recurring_pay_snapshots_entry_component_key"
    UNIQUE ("payroll_entry_id", "source_component_id"),
  CONSTRAINT "payroll_entry_recurring_pay_snapshots_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payroll_entry_recurring_pay_snapshots_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "payroll_entry_recurring_pay_snapshots_revision_check" CHECK ("source_revision" > 0),
  CONSTRAINT "payroll_entry_recurring_pay_snapshots_basis_check" CHECK ("calculation_basis" = 'FIXED_MONTHLY')
);

CREATE INDEX "payroll_entry_recurring_pay_snapshots_business_entry_idx"
  ON "payroll_entry_recurring_pay_snapshots"("business_id", "payroll_entry_id");
CREATE INDEX "payroll_entry_recurring_pay_snapshots_source_version_idx"
  ON "payroll_entry_recurring_pay_snapshots"("source_version_id");

ALTER TABLE "payroll_entry_recurring_pay_snapshots"
  ADD CONSTRAINT "payroll_entry_recurring_pay_snapshots_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_recurring_pay_snapshots_entry_business_fkey"
    FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id")
    REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_recurring_pay_snapshots_component_business_fkey"
    FOREIGN KEY ("source_component_id", "business_id", "membership_id")
    REFERENCES "employee_recurring_pay_components"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_recurring_pay_snapshots_version_business_fkey"
    FOREIGN KEY ("source_version_id", "business_id", "membership_id", "source_component_id")
    REFERENCES "employee_recurring_pay_component_versions"("id", "business_id", "membership_id", "component_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_recurring_pay_component()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recurring pay component identities cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Recurring pay component identities are immutable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_recurring_pay_components_guard_update"
  BEFORE UPDATE ON "employee_recurring_pay_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_component();
CREATE TRIGGER "employee_recurring_pay_components_guard_delete"
  BEFORE DELETE ON "employee_recurring_pay_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_component();

CREATE OR REPLACE FUNCTION tetamu_guard_recurring_pay_version()
RETURNS trigger AS $$
DECLARE
  predecessor RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Recurring pay versions are append-only and cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'SUPERSEDED' THEN
      RAISE EXCEPTION 'A superseded recurring pay version is immutable.';
    END IF;
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."component_id" IS DISTINCT FROM OLD."component_id"
      OR NEW."revision" IS DISTINCT FROM OLD."revision"
      OR NEW."effective_from_month" IS DISTINCT FROM OLD."effective_from_month"
      OR NEW."state" IS DISTINCT FROM OLD."state"
      OR NEW."name" IS DISTINCT FROM OLD."name"
      OR NEW."amount" IS DISTINCT FROM OLD."amount"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."source" IS DISTINCT FROM OLD."source"
      OR NEW."reason_type" IS DISTINCT FROM OLD."reason_type"
      OR NEW."reason_note" IS DISTINCT FROM OLD."reason_note"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
      OR NEW."supersedes_version_id" IS DISTINCT FROM OLD."supersedes_version_id" THEN
      RAISE EXCEPTION 'Recurring pay version facts are immutable; create a new effective revision.';
    END IF;
    IF NEW."status" <> 'SUPERSEDED' OR NEW."superseded_at" IS NULL THEN
      RAISE EXCEPTION 'Only CURRENT to SUPERSEDED correction is permitted.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW."supersedes_version_id" IS NOT NULL THEN
    SELECT "id", "business_id", "membership_id", "component_id", "effective_from_month"
      INTO predecessor
      FROM "employee_recurring_pay_component_versions"
      WHERE "id" = NEW."supersedes_version_id";
    IF NOT FOUND
      OR predecessor."business_id" <> NEW."business_id"
      OR predecessor."membership_id" <> NEW."membership_id"
      OR predecessor."component_id" <> NEW."component_id"
      OR predecessor."effective_from_month" <> NEW."effective_from_month" THEN
      RAISE EXCEPTION 'A recurring pay correction must supersede the same component and effective month.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_recurring_pay_versions_guard_insert"
  BEFORE INSERT ON "employee_recurring_pay_component_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_version();
CREATE TRIGGER "employee_recurring_pay_versions_guard_update"
  BEFORE UPDATE ON "employee_recurring_pay_component_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_version();
CREATE TRIGGER "employee_recurring_pay_versions_guard_delete"
  BEFORE DELETE ON "employee_recurring_pay_component_versions"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_version();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_entry_recurring_snapshot()
RETURNS trigger AS $$
DECLARE
  run_status "PayrollRunStatus";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Recurring pay snapshots are immutable.';
  END IF;
  SELECT run."status" INTO run_status
    FROM "payroll_entries" entry
    JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
    WHERE entry."id" = OLD."payroll_entry_id";
  IF run_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Only Draft Payroll recurring pay snapshots may be removed.';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_entry_recurring_pay_snapshots_guard_update"
  BEFORE UPDATE ON "payroll_entry_recurring_pay_snapshots"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_entry_recurring_snapshot();
CREATE TRIGGER "payroll_entry_recurring_pay_snapshots_guard_delete"
  BEFORE DELETE ON "payroll_entry_recurring_pay_snapshots"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_entry_recurring_snapshot();

CREATE OR REPLACE FUNCTION tetamu_guard_non_draft_payroll_entry()
RETURNS trigger AS $$
DECLARE
  run_status "PayrollRunStatus";
BEGIN
  SELECT "status" INTO run_status FROM "payroll_runs"
    WHERE "id" = COALESCE(NEW."payroll_run_id", OLD."payroll_run_id");
  IF run_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Payroll Entries outside Draft are immutable.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_entries_non_draft_guard_update"
  BEFORE UPDATE ON "payroll_entries"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_non_draft_payroll_entry();
CREATE TRIGGER "payroll_entries_non_draft_guard_delete"
  BEFORE DELETE ON "payroll_entries"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_non_draft_payroll_entry();

CREATE OR REPLACE FUNCTION tetamu_guard_recurring_pay_revision_direct_write()
RETURNS trigger AS $$
BEGIN
  IF NEW."recurring_pay_revision" IS DISTINCT FROM OLD."recurring_pay_revision"
    AND current_setting('tetamu.payroll_profile_command', true) IS DISTINCT FROM 'on'
    AND current_setting('tetamu.payroll_profile_command_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Recurring pay revision must be changed through the canonical command service.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_membership_recurring_pay_revision_guard"
  BEFORE UPDATE ON "employee_business_memberships"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_recurring_pay_revision_direct_write();
