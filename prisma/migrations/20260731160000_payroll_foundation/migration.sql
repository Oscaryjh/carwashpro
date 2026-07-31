BEGIN;

CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "payroll_settings" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "working_days_per_month" INTEGER NOT NULL DEFAULT 26,
  "normal_work_minutes_per_day" INTEGER NOT NULL DEFAULT 480,
  "break_minutes_per_day" INTEGER NOT NULL DEFAULT 60,
  "overtime_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.50,
  "public_holiday_extra_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 2.00,
  "state_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_settings_business_id_key" UNIQUE ("business_id"),
  CONSTRAINT "payroll_settings_values_check" CHECK (
    "working_days_per_month" BETWEEN 1 AND 31 AND
    "normal_work_minutes_per_day" BETWEEN 1 AND 1440 AND
    "break_minutes_per_day" BETWEEN 0 AND 720 AND
    "overtime_multiplier" BETWEEN 1.00 AND 10.00 AND
    "public_holiday_extra_multiplier" BETWEEN 0.00 AND 10.00
  )
);

CREATE TABLE "payroll_holidays" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_holidays_branch_id_work_date_key" UNIQUE ("branch_id", "work_date")
);

CREATE TABLE "payroll_runs" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
  "working_days_per_month_snapshot" INTEGER NOT NULL,
  "normal_work_minutes_per_day_snapshot" INTEGER NOT NULL,
  "break_minutes_per_day_snapshot" INTEGER NOT NULL,
  "overtime_multiplier_snapshot" DECIMAL(5,2) NOT NULL,
  "public_holiday_extra_multiplier_snapshot" DECIMAL(5,2) NOT NULL,
  "created_by_id" UUID,
  "finalized_by_id" UUID,
  "finalized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_runs_business_id_period_start_period_end_key" UNIQUE ("business_id", "period_start", "period_end"),
  CONSTRAINT "payroll_runs_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "payroll_runs_finalize_check" CHECK (
    ("status" = 'DRAFT' AND "finalized_at" IS NULL AND "finalized_by_id" IS NULL) OR
    ("status" = 'FINALIZED' AND "finalized_at" IS NOT NULL)
  )
);

CREATE TABLE "payroll_entries" (
  "id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "employee_code_snapshot" TEXT NOT NULL,
  "full_name_snapshot" TEXT NOT NULL,
  "pay_basis_snapshot" "EmployeePayBasis" NOT NULL,
  "base_rate_snapshot" DECIMAL(12,2) NOT NULL,
  "working_days_snapshot" INTEGER NOT NULL,
  "normal_work_minutes_snapshot" INTEGER NOT NULL,
  "attendance_days" INTEGER NOT NULL DEFAULT 0,
  "regular_minutes" INTEGER NOT NULL DEFAULT 0,
  "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
  "public_holiday_minutes" INTEGER NOT NULL DEFAULT 0,
  "basic_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "overtime_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "public_holiday_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "epf_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "socso_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "eis_employee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pcb" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employer_epf" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employer_socso" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "employer_eis" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "gross_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "net_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "attendance_updated_at_snapshot" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_entries_payroll_run_id_membership_id_key" UNIQUE ("payroll_run_id", "membership_id"),
  CONSTRAINT "payroll_entries_nonnegative_check" CHECK (
    "base_rate_snapshot" >= 0 AND "attendance_days" >= 0 AND
    "regular_minutes" >= 0 AND "overtime_minutes" >= 0 AND
    "public_holiday_minutes" >= 0 AND "basic_pay" >= 0 AND
    "overtime_pay" >= 0 AND "public_holiday_pay" >= 0 AND
    "allowances" >= 0 AND "other_deductions" >= 0 AND
    "epf_employee" >= 0 AND "socso_employee" >= 0 AND
    "eis_employee" >= 0 AND "pcb" >= 0 AND
    "employer_epf" >= 0 AND "employer_socso" >= 0 AND
    "employer_eis" >= 0 AND "gross_pay" >= 0 AND "net_pay" >= 0
  )
);

CREATE INDEX "payroll_holidays_business_id_work_date_idx" ON "payroll_holidays"("business_id", "work_date");
CREATE INDEX "payroll_runs_business_id_status_period_start_idx" ON "payroll_runs"("business_id", "status", "period_start");
CREATE INDEX "payroll_entries_business_id_membership_id_idx" ON "payroll_entries"("business_id", "membership_id");

ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_holidays" ADD CONSTRAINT "payroll_holidays_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_holidays" ADD CONSTRAINT "payroll_holidays_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "employee_business_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "payroll_validate_scope"() RETURNS TRIGGER AS $$
DECLARE related_business_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'payroll_holidays' THEN
    SELECT "business_id" INTO related_business_id FROM "branches" WHERE "id" = NEW."branch_id";
    IF related_business_id IS DISTINCT FROM NEW."business_id" THEN
      RAISE EXCEPTION 'Payroll holiday branch must belong to the same business.';
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_entries' THEN
    SELECT "business_id" INTO related_business_id FROM "payroll_runs" WHERE "id" = NEW."payroll_run_id";
    IF related_business_id IS DISTINCT FROM NEW."business_id" THEN
      RAISE EXCEPTION 'Payroll entry run must belong to the same business.';
    END IF;
    SELECT "business_id" INTO related_business_id FROM "employee_business_memberships" WHERE "id" = NEW."membership_id";
    IF related_business_id IS DISTINCT FROM NEW."business_id" THEN
      RAISE EXCEPTION 'Payroll entry employee must belong to the same business.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payroll_holidays_scope_guard" AFTER INSERT OR UPDATE ON "payroll_holidays" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "payroll_validate_scope"();
CREATE CONSTRAINT TRIGGER "payroll_entries_scope_guard" AFTER INSERT OR UPDATE ON "payroll_entries" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "payroll_validate_scope"();

CREATE OR REPLACE FUNCTION "payroll_lock_finalized"() RETURNS TRIGGER AS $$
DECLARE run_status "PayrollRunStatus";
BEGIN
  IF TG_TABLE_NAME = 'payroll_runs' AND TG_OP IN ('UPDATE', 'DELETE') AND OLD."status" = 'FINALIZED' THEN
    RAISE EXCEPTION 'Finalized payroll runs are immutable.';
  END IF;
  IF TG_TABLE_NAME = 'payroll_entries' THEN
    SELECT "status" INTO run_status FROM "payroll_runs" WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."payroll_run_id" ELSE NEW."payroll_run_id" END;
    IF run_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'Entries in a finalized payroll run are immutable.';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_runs_finalized_lock" BEFORE UPDATE OR DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION "payroll_lock_finalized"();
CREATE TRIGGER "payroll_entries_finalized_lock" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_entries" FOR EACH ROW EXECUTE FUNCTION "payroll_lock_finalized"();

COMMIT;
