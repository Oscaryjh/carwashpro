-- Payroll P4B: explainable component lines are the canonical source for Draft
-- Payroll Entry earnings and non-statutory deductions. Aggregate columns remain
-- additive compatibility snapshots and are reconciled at transaction commit.

CREATE TYPE "PayrollEntryComponentType" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "PayrollEntryComponentSourceType" AS ENUM (
  'BASIC_SALARY',
  'PAYROLL_CALCULATION',
  'RECURRING_PAY',
  'MANUAL_ADJUSTMENT'
);
CREATE TYPE "PayrollEntryComponentOrigin" AS ENUM ('SYSTEM', 'MANUAL');

ALTER TABLE "payroll_entries"
  ADD COLUMN "calculation_revision" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "payroll_entries_calculation_revision_check"
    CHECK ("calculation_revision" >= 0);

CREATE TABLE "payroll_entry_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "line_key" VARCHAR(160) NOT NULL,
  "type" "PayrollEntryComponentType" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "source_type" "PayrollEntryComponentSourceType" NOT NULL,
  "source_id" UUID,
  "source_version_id" UUID,
  "source_revision" INTEGER,
  "effective_from_month" DATE,
  "calculation_basis" VARCHAR(64) NOT NULL,
  "origin" "PayrollEntryComponentOrigin" NOT NULL,
  "reason" TEXT,
  "sort_order" INTEGER NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_entry_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_entry_components_entry_line_key" UNIQUE ("payroll_entry_id", "line_key"),
  CONSTRAINT "payroll_entry_components_line_key_check"
    CHECK ("line_key" ~ '^[A-Z0-9][A-Z0-9_:.-]{1,159}$'),
  CONSTRAINT "payroll_entry_components_code_check"
    CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "payroll_entry_components_name_check"
    CHECK (length(btrim("name")) > 0),
  CONSTRAINT "payroll_entry_components_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payroll_entry_components_currency_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "payroll_entry_components_source_revision_check"
    CHECK ("source_revision" IS NULL OR "source_revision" > 0),
  CONSTRAINT "payroll_entry_components_effective_month_check"
    CHECK (
      "effective_from_month" IS NULL
      OR "effective_from_month" = date_trunc('month', "effective_from_month")::date
    ),
  CONSTRAINT "payroll_entry_components_sort_order_check" CHECK ("sort_order" >= 0),
  CONSTRAINT "payroll_entry_components_manual_check" CHECK (
    (
      "origin" = 'MANUAL'
      AND "source_type" = 'MANUAL_ADJUSTMENT'
      AND "source_id" IS NULL
      AND "source_version_id" IS NULL
      AND "source_revision" IS NULL
      AND "effective_from_month" IS NULL
      AND length(btrim(COALESCE("reason", ''))) >= 5
    )
    OR
    (
      "origin" = 'SYSTEM'
      AND "source_type" <> 'MANUAL_ADJUSTMENT'
      AND "reason" IS NULL
    )
  )
);

CREATE INDEX "payroll_entry_components_business_run_entry_idx"
  ON "payroll_entry_components"("business_id", "payroll_run_id", "payroll_entry_id");
CREATE INDEX "payroll_entry_components_business_membership_idx"
  ON "payroll_entry_components"("business_id", "membership_id");
CREATE INDEX "payroll_entry_components_source_version_idx"
  ON "payroll_entry_components"("source_version_id");

ALTER TABLE "payroll_entry_components"
  ADD CONSTRAINT "payroll_entry_components_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_components_run_business_fkey"
    FOREIGN KEY ("payroll_run_id", "business_id")
    REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_components_entry_scope_fkey"
    FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id")
    REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_components_membership_business_fkey"
    FOREIGN KEY ("membership_id", "business_id")
    REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_entry_components_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_entry_component()
RETURNS trigger AS $$
DECLARE
  run_status "PayrollRunStatus";
  entry_run_id UUID;
  entry_compensation_version_id UUID;
BEGIN
  IF current_setting('tetamu.payroll_profile_command_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT run."status", entry."payroll_run_id", entry."compensation_version_id"
    INTO run_status, entry_run_id, entry_compensation_version_id
    FROM "payroll_entries" entry
    JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
    WHERE entry."id" = COALESCE(NEW."payroll_entry_id", OLD."payroll_entry_id");

  IF run_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Payroll component lines outside Draft are immutable.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."origin" <> 'MANUAL' OR NEW."origin" <> 'MANUAL' THEN
      RAISE EXCEPTION 'System payroll component lines must be regenerated, not edited.';
    END IF;
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."payroll_run_id" IS DISTINCT FROM OLD."payroll_run_id"
      OR NEW."payroll_entry_id" IS DISTINCT FROM OLD."payroll_entry_id"
      OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."line_key" IS DISTINCT FROM OLD."line_key"
      OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."source_type" IS DISTINCT FROM OLD."source_type"
      OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
      OR NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id"
      OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
      OR NEW."effective_from_month" IS DISTINCT FROM OLD."effective_from_month"
      OR NEW."calculation_basis" IS DISTINCT FROM OLD."calculation_basis"
      OR NEW."origin" IS DISTINCT FROM OLD."origin"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Manual payroll adjustment identity and provenance are immutable.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'BASIC_SALARY' THEN
    IF NEW."source_id" IS NOT NULL
      OR NEW."source_version_id" IS NULL
      OR NEW."source_version_id" IS DISTINCT FROM entry_compensation_version_id THEN
      RAISE EXCEPTION 'Basic Salary line must reference the Payroll Entry compensation version.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'RECURRING_PAY' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "payroll_entry_recurring_pay_snapshots" snapshot
      WHERE snapshot."payroll_entry_id" = NEW."payroll_entry_id"
        AND snapshot."business_id" = NEW."business_id"
        AND snapshot."membership_id" = NEW."membership_id"
        AND snapshot."source_component_id" = NEW."source_id"
        AND snapshot."source_version_id" = NEW."source_version_id"
        AND snapshot."source_revision" = NEW."source_revision"
    ) THEN
      RAISE EXCEPTION 'Recurring Pay line must reference its Payroll Entry snapshot.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW."source_type" IN ('PAYROLL_CALCULATION', 'MANUAL_ADJUSTMENT')
    AND (NEW."source_id" IS NOT NULL OR NEW."source_version_id" IS NOT NULL OR NEW."source_revision" IS NOT NULL) THEN
    RAISE EXCEPTION 'Calculated and manual lines cannot claim external source provenance.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_entry_components_guard_insert"
  BEFORE INSERT ON "payroll_entry_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_entry_component();
CREATE TRIGGER "payroll_entry_components_guard_update"
  BEFORE UPDATE ON "payroll_entry_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_entry_component();
CREATE TRIGGER "payroll_entry_components_guard_delete"
  BEFORE DELETE ON "payroll_entry_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_entry_component();

CREATE OR REPLACE FUNCTION tetamu_reconcile_payroll_entry_components_by_id(target_entry_id UUID)
RETURNS void AS $$
DECLARE
  entry_record RECORD;
  earning_total DECIMAL(14,2);
  deduction_total DECIMAL(14,2);
  allowance_total DECIMAL(14,2);
  recurring_earning_total DECIMAL(14,2);
  recurring_deduction_total DECIMAL(14,2);
  expected_net DECIMAL(14,2);
BEGIN
  SELECT * INTO entry_record FROM "payroll_entries" WHERE "id" = target_entry_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'EARNING'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "type" = 'DEDUCTION'), 0),
    COALESCE(SUM("amount") FILTER (
      WHERE "type" = 'EARNING' AND "source_type" IN ('RECURRING_PAY', 'MANUAL_ADJUSTMENT')
    ), 0),
    COALESCE(SUM("amount") FILTER (
      WHERE "type" = 'EARNING' AND "source_type" = 'RECURRING_PAY'
    ), 0),
    COALESCE(SUM("amount") FILTER (
      WHERE "type" = 'DEDUCTION' AND "source_type" = 'RECURRING_PAY'
    ), 0)
  INTO earning_total, deduction_total, allowance_total,
       recurring_earning_total, recurring_deduction_total
  FROM "payroll_entry_components"
  WHERE "payroll_entry_id" = target_entry_id;

  expected_net := GREATEST(
    0,
    earning_total - deduction_total
      - entry_record."epf_employee"
      - entry_record."socso_employee"
      - entry_record."eis_employee"
      - entry_record."lindung_24_employee"
      - entry_record."pcb"
  );

  IF entry_record."gross_pay" <> earning_total
    OR entry_record."allowances" <> allowance_total
    OR entry_record."other_deductions" <> deduction_total
    OR entry_record."recurring_allowances_snapshot" <> recurring_earning_total
    OR entry_record."recurring_deductions_snapshot" <> recurring_deduction_total
    OR entry_record."net_pay" <> expected_net THEN
    RAISE EXCEPTION 'PAYROLL_COMPONENT_RECONCILIATION_FAILED';
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_reconcile_payroll_entry_component_trigger()
RETURNS trigger AS $$
BEGIN
  PERFORM tetamu_reconcile_payroll_entry_components_by_id(
    CASE WHEN TG_OP = 'DELETE' THEN OLD."payroll_entry_id" ELSE NEW."payroll_entry_id" END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_reconcile_payroll_entry_trigger()
RETURNS trigger AS $$
BEGIN
  PERFORM tetamu_reconcile_payroll_entry_components_by_id(
    CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payroll_entry_components_reconcile"
  AFTER INSERT OR UPDATE OR DELETE ON "payroll_entry_components"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tetamu_reconcile_payroll_entry_component_trigger();

CREATE CONSTRAINT TRIGGER "payroll_entries_components_reconcile"
  AFTER INSERT OR UPDATE OF "gross_pay", "net_pay", "allowances", "other_deductions",
    "recurring_allowances_snapshot", "recurring_deductions_snapshot",
    "epf_employee", "socso_employee", "eis_employee", "lindung_24_employee", "pcb"
  ON "payroll_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION tetamu_reconcile_payroll_entry_trigger();

CREATE OR REPLACE FUNCTION tetamu_prevent_payroll_entry_component_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payroll component lines cannot be truncated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_entry_components_truncate_guard"
  BEFORE TRUNCATE ON "payroll_entry_components"
  FOR EACH STATEMENT EXECUTE FUNCTION tetamu_prevent_payroll_entry_component_truncate();
