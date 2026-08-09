ALTER TYPE "PayrollEntryComponentSourceType" ADD VALUE IF NOT EXISTS 'VARIABLE_PAY';
ALTER TYPE "PayrollEntryComponentSourceType" ADD VALUE IF NOT EXISTS 'CORRECTION';

CREATE TYPE "PayrollAdjustmentCategory" AS ENUM (
  'ONE_OFF', 'CORRECTION', 'ARREARS', 'RECOVERY', 'BONUS', 'OTHER'
);
CREATE TYPE "PayrollVariablePayType" AS ENUM (
  'BONUS', 'COMMISSION', 'INCENTIVE', 'ONE_OFF_EARNING',
  'ONE_OFF_DEDUCTION', 'ARREARS', 'RECOVERY'
);
CREATE TYPE "PayrollVariablePayOrigin" AS ENUM ('MANUAL', 'IMPORTED', 'SYSTEM');
CREATE TYPE "PayrollVariablePayStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED');
CREATE TYPE "PayrollCorrectionStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED');

ALTER TABLE "payroll_entry_components"
  ADD COLUMN "adjustment_category" "PayrollAdjustmentCategory",
  ADD COLUMN "source_reason" TEXT;

CREATE TABLE "payroll_variable_pay" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "type" "PayrollVariablePayType" NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'MYR',
  "earned_period_start" DATE NOT NULL,
  "earned_period_end" DATE NOT NULL,
  "payroll_period_start" DATE NOT NULL,
  "origin" "PayrollVariablePayOrigin" NOT NULL DEFAULT 'MANUAL',
  "source_reference" VARCHAR(160),
  "reason" VARCHAR(500) NOT NULL,
  "status" "PayrollVariablePayStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "cancelled_by_id" UUID,
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" VARCHAR(500),
  "applied_payroll_entry_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_variable_pay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_variable_pay_positive_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "payroll_variable_pay_myr_check" CHECK ("currency" = 'MYR'),
  CONSTRAINT "payroll_variable_pay_period_check" CHECK (
    "earned_period_start" <= "earned_period_end"
    AND EXTRACT(DAY FROM "payroll_period_start") = 1
  ),
  CONSTRAINT "payroll_variable_pay_reason_check" CHECK (length(btrim("reason")) BETWEEN 5 AND 500),
  CONSTRAINT "payroll_variable_pay_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "payroll_variable_pay_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "payroll_variable_pay_id_business_membership_key"
  ON "payroll_variable_pay"("id", "business_id", "membership_id");
CREATE INDEX "payroll_variable_pay_period_status_idx"
  ON "payroll_variable_pay"("business_id", "membership_id", "payroll_period_start", "status");
CREATE INDEX "payroll_variable_pay_applied_entry_idx"
  ON "payroll_variable_pay"("applied_payroll_entry_id");
CREATE UNIQUE INDEX "payroll_variable_pay_source_reference_key"
  ON "payroll_variable_pay"("business_id", "membership_id", "type", "payroll_period_start", "source_reference")
  WHERE "source_reference" IS NOT NULL AND "status" <> 'CANCELLED';

ALTER TABLE "payroll_variable_pay"
  ADD CONSTRAINT "payroll_variable_pay_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_variable_pay_membership_business_fkey"
    FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_variable_pay_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_variable_pay_approved_by_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_variable_pay_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_variable_pay_applied_entry_scope_fkey"
    FOREIGN KEY ("applied_payroll_entry_id", "business_id", "membership_id")
    REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_corrections" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "original_payroll_entry_id" UUID NOT NULL,
  "applied_payroll_entry_id" UUID,
  "apply_to_period_start" DATE NOT NULL,
  "original_amount" DECIMAL(12,2) NOT NULL,
  "corrected_amount" DECIMAL(12,2) NOT NULL,
  "delta_type" "PayrollEntryComponentType" NOT NULL,
  "delta_amount" DECIMAL(12,2) NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "source_reference" VARCHAR(160),
  "reason" VARCHAR(500) NOT NULL,
  "status" "PayrollCorrectionStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "approved_at" TIMESTAMP(3),
  "cancelled_by_id" UUID,
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_corrections_amount_check" CHECK (
    "original_amount" >= 0 AND "corrected_amount" >= 0 AND "delta_amount" > 0
  ),
  CONSTRAINT "payroll_corrections_month_check" CHECK (EXTRACT(DAY FROM "apply_to_period_start") = 1),
  CONSTRAINT "payroll_corrections_reason_check" CHECK (length(btrim("reason")) BETWEEN 5 AND 500),
  CONSTRAINT "payroll_corrections_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT "payroll_corrections_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "payroll_corrections_delta_check" CHECK (
    ("corrected_amount" > "original_amount" AND "delta_type" = 'EARNING' AND "delta_amount" = "corrected_amount" - "original_amount")
    OR
    ("corrected_amount" < "original_amount" AND "delta_type" = 'DEDUCTION' AND "delta_amount" = "original_amount" - "corrected_amount")
  )
);

CREATE UNIQUE INDEX "payroll_corrections_id_business_membership_key"
  ON "payroll_corrections"("id", "business_id", "membership_id");
CREATE INDEX "payroll_corrections_period_status_idx"
  ON "payroll_corrections"("business_id", "membership_id", "apply_to_period_start", "status");
CREATE INDEX "payroll_corrections_original_entry_idx" ON "payroll_corrections"("original_payroll_entry_id");
CREATE INDEX "payroll_corrections_applied_entry_idx" ON "payroll_corrections"("applied_payroll_entry_id");
CREATE UNIQUE INDEX "payroll_corrections_source_reference_key"
  ON "payroll_corrections"("business_id", "source_reference")
  WHERE "source_reference" IS NOT NULL AND "status" <> 'CANCELLED';

ALTER TABLE "payroll_corrections"
  ADD CONSTRAINT "payroll_corrections_business_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_membership_business_fkey"
    FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_original_entry_scope_fkey"
    FOREIGN KEY ("original_payroll_entry_id", "business_id", "membership_id")
    REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_applied_entry_scope_fkey"
    FOREIGN KEY ("applied_payroll_entry_id", "business_id", "membership_id")
    REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_approved_by_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_corrections_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_variable_pay()
RETURNS trigger AS $$
DECLARE
  applied_status "PayrollRunStatus";
  applied_period DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Variable pay records are retained and cannot be deleted.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Variable pay ownership and creation provenance are immutable.';
    END IF;
    IF OLD."status" <> 'DRAFT' AND (
      NEW."type" IS DISTINCT FROM OLD."type" OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."name" IS DISTINCT FROM OLD."name" OR NEW."amount" IS DISTINCT FROM OLD."amount"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."earned_period_start" IS DISTINCT FROM OLD."earned_period_start"
      OR NEW."earned_period_end" IS DISTINCT FROM OLD."earned_period_end"
      OR NEW."payroll_period_start" IS DISTINCT FROM OLD."payroll_period_start"
      OR NEW."origin" IS DISTINCT FROM OLD."origin" OR NEW."source_reference" IS DISTINCT FROM OLD."source_reference"
      OR NEW."reason" IS DISTINCT FROM OLD."reason"
    ) THEN
      RAISE EXCEPTION 'Approved variable pay facts are immutable.';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 THEN
      RAISE EXCEPTION 'Variable pay revision must advance exactly once.';
    END IF;
    IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'APPROVED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid variable pay transition.';
    ELSIF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPLIED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid variable pay transition.';
    ELSIF OLD."status" IN ('APPLIED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Applied or cancelled variable pay is immutable.';
    END IF;
  END IF;
  IF NEW."status" = 'DRAFT' AND (
    NEW."approved_by_id" IS NOT NULL OR NEW."approved_at" IS NOT NULL
    OR NEW."cancelled_by_id" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL
    OR NEW."applied_payroll_entry_id" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Draft variable pay cannot contain decision or application facts.';
  ELSIF NEW."status" IN ('APPROVED', 'APPLIED') AND (
    NEW."approved_by_id" IS NULL OR NEW."approved_at" IS NULL
    OR NEW."approved_by_id" = NEW."created_by_id"
    OR NEW."cancelled_by_id" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Variable pay requires independent approval.';
  ELSIF NEW."status" = 'APPROVED' AND NEW."applied_payroll_entry_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Approved variable pay has not yet been applied.';
  ELSIF NEW."status" = 'APPLIED' AND NEW."applied_payroll_entry_id" IS NULL THEN
    RAISE EXCEPTION 'Applied variable pay must reference its payroll entry.';
  ELSIF NEW."status" = 'CANCELLED' AND (
    NEW."cancelled_by_id" IS NULL OR NEW."cancelled_at" IS NULL
    OR length(btrim(COALESCE(NEW."cancellation_reason", ''))) < 5
    OR NEW."applied_payroll_entry_id" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Cancelled variable pay requires a reason and cannot have been applied.';
  END IF;
  IF NEW."applied_payroll_entry_id" IS NOT NULL THEN
    SELECT run."status", run."period_start" INTO applied_status, applied_period
    FROM "payroll_entries" entry JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
    WHERE entry."id" = NEW."applied_payroll_entry_id";
    IF applied_status IS DISTINCT FROM 'DRAFT' OR applied_period IS DISTINCT FROM NEW."payroll_period_start" THEN
      RAISE EXCEPTION 'Variable pay may only be applied to its matching Draft payroll period.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_variable_pay_guard_insert" BEFORE INSERT ON "payroll_variable_pay"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_variable_pay();
CREATE TRIGGER "payroll_variable_pay_guard_update" BEFORE UPDATE ON "payroll_variable_pay"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_variable_pay();
CREATE TRIGGER "payroll_variable_pay_guard_delete" BEFORE DELETE ON "payroll_variable_pay"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_variable_pay();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_correction()
RETURNS trigger AS $$
DECLARE
  original_status "PayrollRunStatus";
  original_period DATE;
  applied_status "PayrollRunStatus";
  applied_period DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payroll correction records are retained and cannot be deleted.'; END IF;
  SELECT run."status", run."period_start" INTO original_status, original_period
  FROM "payroll_entries" entry JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
  WHERE entry."id" = NEW."original_payroll_entry_id";
  IF original_status IS DISTINCT FROM 'FINALIZED' THEN
    RAISE EXCEPTION 'A payroll correction must reference a finalized payroll entry.';
  END IF;
  IF NEW."apply_to_period_start" <= original_period THEN
    RAISE EXCEPTION 'A payroll correction must be applied in a future payroll period.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
      OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."original_payroll_entry_id" IS DISTINCT FROM OLD."original_payroll_entry_id"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
      OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Payroll correction ownership and original entry are immutable.';
    END IF;
    IF OLD."status" <> 'DRAFT' AND (
      NEW."apply_to_period_start" IS DISTINCT FROM OLD."apply_to_period_start"
      OR NEW."original_amount" IS DISTINCT FROM OLD."original_amount"
      OR NEW."corrected_amount" IS DISTINCT FROM OLD."corrected_amount"
      OR NEW."delta_type" IS DISTINCT FROM OLD."delta_type"
      OR NEW."delta_amount" IS DISTINCT FROM OLD."delta_amount"
      OR NEW."code" IS DISTINCT FROM OLD."code" OR NEW."name" IS DISTINCT FROM OLD."name"
      OR NEW."source_reference" IS DISTINCT FROM OLD."source_reference" OR NEW."reason" IS DISTINCT FROM OLD."reason"
    ) THEN RAISE EXCEPTION 'Approved payroll correction facts are immutable.';
    END IF;
    IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'Payroll correction revision must advance exactly once.'; END IF;
    IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'APPROVED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid payroll correction transition.';
    ELSIF OLD."status" = 'APPROVED' AND NEW."status" NOT IN ('APPLIED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid payroll correction transition.';
    ELSIF OLD."status" IN ('APPLIED', 'CANCELLED') THEN
      RAISE EXCEPTION 'Applied or cancelled payroll correction is immutable.';
    END IF;
  END IF;
  IF NEW."status" = 'DRAFT' AND (
    NEW."approved_by_id" IS NOT NULL OR NEW."approved_at" IS NOT NULL
    OR NEW."cancelled_by_id" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL
    OR NEW."applied_payroll_entry_id" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Draft payroll correction cannot contain decision or application facts.';
  ELSIF NEW."status" IN ('APPROVED', 'APPLIED') AND (
    NEW."approved_by_id" IS NULL OR NEW."approved_at" IS NULL
    OR NEW."approved_by_id" = NEW."created_by_id"
    OR NEW."cancelled_by_id" IS NOT NULL OR NEW."cancelled_at" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Payroll correction requires independent approval.';
  ELSIF NEW."status" = 'APPROVED' AND NEW."applied_payroll_entry_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Approved payroll correction has not yet been applied.';
  ELSIF NEW."status" = 'APPLIED' AND NEW."applied_payroll_entry_id" IS NULL THEN
    RAISE EXCEPTION 'Applied payroll correction must reference its future payroll entry.';
  ELSIF NEW."status" = 'CANCELLED' AND (
    NEW."cancelled_by_id" IS NULL OR NEW."cancelled_at" IS NULL
    OR length(btrim(COALESCE(NEW."cancellation_reason", ''))) < 5
    OR NEW."applied_payroll_entry_id" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Cancelled payroll correction requires a reason and cannot have been applied.';
  END IF;
  IF NEW."applied_payroll_entry_id" IS NOT NULL THEN
    SELECT run."status", run."period_start" INTO applied_status, applied_period
    FROM "payroll_entries" entry JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
    WHERE entry."id" = NEW."applied_payroll_entry_id";
    IF applied_status IS DISTINCT FROM 'DRAFT' OR applied_period IS DISTINCT FROM NEW."apply_to_period_start" THEN
      RAISE EXCEPTION 'Payroll correction may only be applied to its matching future Draft payroll period.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_corrections_guard_insert" BEFORE INSERT ON "payroll_corrections"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_correction();
CREATE TRIGGER "payroll_corrections_guard_update" BEFORE UPDATE ON "payroll_corrections"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_correction();
CREATE TRIGGER "payroll_corrections_guard_delete" BEFORE DELETE ON "payroll_corrections"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_correction();

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_entry_component()
RETURNS trigger AS $$
DECLARE
  run_status "PayrollRunStatus";
  run_period DATE;
  entry_run_id UUID;
  entry_compensation_version_id UUID;
BEGIN
  IF current_setting('tetamu.payroll_profile_command_maintenance', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT run."status", run."period_start", entry."payroll_run_id", entry."compensation_version_id"
    INTO run_status, run_period, entry_run_id, entry_compensation_version_id
    FROM "payroll_entries" entry JOIN "payroll_runs" run ON run."id" = entry."payroll_run_id"
    WHERE entry."id" = COALESCE(NEW."payroll_entry_id", OLD."payroll_entry_id");
  IF run_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Payroll component lines outside Draft are immutable.'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."origin" <> 'MANUAL' OR NEW."origin" <> 'MANUAL' THEN RAISE EXCEPTION 'System payroll component lines must be regenerated, not edited.'; END IF;
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id" OR NEW."payroll_run_id" IS DISTINCT FROM OLD."payroll_run_id"
      OR NEW."payroll_entry_id" IS DISTINCT FROM OLD."payroll_entry_id" OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
      OR NEW."line_key" IS DISTINCT FROM OLD."line_key" OR NEW."type" IS DISTINCT FROM OLD."type"
      OR NEW."code" IS DISTINCT FROM OLD."code" OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."source_type" IS DISTINCT FROM OLD."source_type" OR NEW."source_id" IS DISTINCT FROM OLD."source_id"
      OR NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id" OR NEW."source_revision" IS DISTINCT FROM OLD."source_revision"
      OR NEW."effective_from_month" IS DISTINCT FROM OLD."effective_from_month"
      OR NEW."calculation_basis" IS DISTINCT FROM OLD."calculation_basis" OR NEW."origin" IS DISTINCT FROM OLD."origin"
      OR NEW."adjustment_category" IS DISTINCT FROM OLD."adjustment_category"
      OR NEW."source_reason" IS DISTINCT FROM OLD."source_reason"
      OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
      RAISE EXCEPTION 'Manual payroll adjustment identity and provenance are immutable.';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'BASIC_SALARY' AND (
    NEW."source_id" IS NOT NULL OR NEW."source_version_id" IS NULL
    OR NEW."source_version_id" IS DISTINCT FROM entry_compensation_version_id
  ) THEN RAISE EXCEPTION 'Basic Salary line must reference the Payroll Entry compensation version.';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'RECURRING_PAY' AND NOT EXISTS (
    SELECT 1 FROM "payroll_entry_recurring_pay_snapshots" snapshot
    WHERE snapshot."payroll_entry_id" = NEW."payroll_entry_id" AND snapshot."business_id" = NEW."business_id"
      AND snapshot."membership_id" = NEW."membership_id" AND snapshot."source_component_id" = NEW."source_id"
      AND snapshot."source_version_id" = NEW."source_version_id" AND snapshot."source_revision" = NEW."source_revision"
  ) THEN RAISE EXCEPTION 'Recurring Pay line must reference its Payroll Entry snapshot.';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" IN ('PAYROLL_CALCULATION', 'MANUAL_ADJUSTMENT')
    AND (NEW."source_id" IS NOT NULL OR NEW."source_version_id" IS NOT NULL OR NEW."source_revision" IS NOT NULL) THEN
    RAISE EXCEPTION 'Calculated and manual lines cannot claim external source provenance.';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'MANUAL_ADJUSTMENT' AND NEW."adjustment_category" IS NULL THEN
    RAISE EXCEPTION 'Manual payroll adjustment category is required.';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'VARIABLE_PAY' AND NOT EXISTS (
    SELECT 1 FROM "payroll_variable_pay" source
    WHERE source."id" = NEW."source_id" AND source."business_id" = NEW."business_id"
      AND source."membership_id" = NEW."membership_id" AND source."status" IN ('APPROVED', 'APPLIED')
      AND source."payroll_period_start" = run_period
      AND (CASE WHEN source."status" = 'APPLIED' THEN source."revision" - 1 ELSE source."revision" END) = NEW."source_revision"
      AND source."code" = NEW."code" AND source."name" = NEW."name" AND source."amount" = NEW."amount"
      AND source."currency" = NEW."currency" AND source."reason" = NEW."source_reason"
      AND source."applied_payroll_entry_id" IS NOT DISTINCT FROM CASE WHEN source."status" = 'APPLIED' THEN NEW."payroll_entry_id" ELSE NULL END
      AND NEW."type" = CASE WHEN source."type" IN ('ONE_OFF_DEDUCTION', 'RECOVERY') THEN 'DEDUCTION'::"PayrollEntryComponentType" ELSE 'EARNING'::"PayrollEntryComponentType" END
  ) THEN RAISE EXCEPTION 'Variable Pay line must match its approved frozen source.';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW."source_type" = 'CORRECTION' AND NOT EXISTS (
    SELECT 1 FROM "payroll_corrections" source
    WHERE source."id" = NEW."source_id" AND source."business_id" = NEW."business_id"
      AND source."membership_id" = NEW."membership_id" AND source."status" IN ('APPROVED', 'APPLIED')
      AND source."apply_to_period_start" = run_period
      AND (CASE WHEN source."status" = 'APPLIED' THEN source."revision" - 1 ELSE source."revision" END) = NEW."source_revision"
      AND source."code" = NEW."code" AND source."name" = NEW."name" AND source."delta_amount" = NEW."amount"
      AND source."delta_type" = NEW."type" AND source."reason" = NEW."source_reason"
      AND source."applied_payroll_entry_id" IS NOT DISTINCT FROM CASE WHEN source."status" = 'APPLIED' THEN NEW."payroll_entry_id" ELSE NULL END
  ) THEN RAISE EXCEPTION 'Correction line must match its approved delta source.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_reject_p4c_financial_truncate()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'P4C financial records cannot be truncated.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_variable_pay_no_truncate" BEFORE TRUNCATE ON "payroll_variable_pay"
  FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_p4c_financial_truncate();
CREATE TRIGGER "payroll_corrections_no_truncate" BEFORE TRUNCATE ON "payroll_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_p4c_financial_truncate();
