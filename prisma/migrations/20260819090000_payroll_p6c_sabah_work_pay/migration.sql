ALTER TYPE "StatutoryScheme" ADD VALUE IF NOT EXISTS 'WORK_PAY';

CREATE TYPE "PayrollWorkPayCoverageStatus" AS ENUM ('ELIGIBLE', 'NOT_ELIGIBLE', 'REVIEW_REQUIRED');
CREATE TYPE "PayrollWorkPayClassification" AS ENUM ('NORMAL_OT', 'REST_DAY_WORK', 'REST_DAY_OT', 'PUBLIC_HOLIDAY_WORK', 'PUBLIC_HOLIDAY_OT');

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "jurisdiction_code" VARCHAR(32);

CREATE INDEX "statutory_rule_sets_scheme_jurisdiction_code_status_effecti_idx"
  ON "statutory_rule_sets"("scheme", "jurisdiction_code", "status", "effective_from", "effective_to");

CREATE TABLE "payroll_work_pay_calculation_snapshots" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "compensation_version_id" UUID NOT NULL,
  "attendance_input_snapshot_id" UUID NOT NULL,
  "rule_set_id" UUID NOT NULL,
  "jurisdiction_code" VARCHAR(32) NOT NULL,
  "rule_version" VARCHAR(100) NOT NULL,
  "rule_status_snapshot" "StatutoryRuleSetStatus" NOT NULL,
  "source_reference" VARCHAR(500) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "pay_basis" "EmployeePayBasis" NOT NULL,
  "base_rate" DECIMAL(12,2) NOT NULL,
  "ordinary_daily_rate" DECIMAL(18,8),
  "hourly_rate" DECIMAL(18,8),
  "coverage_status" "PayrollWorkPayCoverageStatus" NOT NULL,
  "coverage_reason" VARCHAR(1000) NOT NULL,
  "normal_work_minutes" INTEGER NOT NULL,
  "input_digest" CHAR(64) NOT NULL,
  "calculation_digest" CHAR(64) NOT NULL,
  "input_facts" JSONB NOT NULL,
  "blocker_codes" JSONB NOT NULL DEFAULT '[]',
  "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_work_pay_calculation_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_work_pay_calculation_snapshots_payroll_entry_id_key" ON "payroll_work_pay_calculation_snapshots"("payroll_entry_id");
CREATE UNIQUE INDEX "payroll_work_pay_calculation_snapshots_attendance_input_sna_key" ON "payroll_work_pay_calculation_snapshots"("attendance_input_snapshot_id");
CREATE UNIQUE INDEX "payroll_work_pay_calculation_snapshots_id_business_id_key" ON "payroll_work_pay_calculation_snapshots"("id", "business_id");
CREATE UNIQUE INDEX "payroll_work_pay_calculation_snapshots_payroll_entry_id_b_key" ON "payroll_work_pay_calculation_snapshots"("payroll_entry_id", "business_id", "membership_id");
CREATE INDEX "payroll_work_pay_calculation_snapshots_business_id_payroll_idx" ON "payroll_work_pay_calculation_snapshots"("business_id", "payroll_run_id");
CREATE INDEX "payroll_work_pay_calculation_snapshots_business_id_members_idx" ON "payroll_work_pay_calculation_snapshots"("business_id", "membership_id", "generated_at");
CREATE INDEX "payroll_work_pay_calculation_snapshots_rule_set_id_idx" ON "payroll_work_pay_calculation_snapshots"("rule_set_id");

CREATE TABLE "payroll_work_pay_calculation_lines" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "snapshot_id" UUID NOT NULL,
  "payroll_component_id" UUID,
  "local_date" DATE NOT NULL,
  "classification" "PayrollWorkPayClassification" NOT NULL,
  "minutes" INTEGER NOT NULL,
  "multiplier" DECIMAL(8,4) NOT NULL,
  "rate" DECIMAL(18,8) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "rule_section" VARCHAR(80) NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "line_digest" CHAR(64) NOT NULL,
  "trace" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_work_pay_calculation_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_work_pay_calculation_lines_snapshot_id_local_date_key" ON "payroll_work_pay_calculation_lines"("snapshot_id", "local_date", "classification");
CREATE INDEX "payroll_work_pay_calculation_lines_business_id_payroll_run_i_idx" ON "payroll_work_pay_calculation_lines"("business_id", "payroll_run_id", "payroll_entry_id");
CREATE INDEX "payroll_work_pay_calculation_lines_payroll_component_id_idx" ON "payroll_work_pay_calculation_lines"("payroll_component_id");

ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_run_fkey" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_entry_fkey" FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_compensation_fkey" FOREIGN KEY ("compensation_version_id", "business_id") REFERENCES "employee_compensation_versions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_attendance_fkey" FOREIGN KEY ("attendance_input_snapshot_id") REFERENCES "payroll_attendance_input_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_snapshots" ADD CONSTRAINT "payroll_work_pay_snapshots_rule_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "statutory_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_run_fkey" FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_entry_fkey" FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_membership_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_snapshot_fkey" FOREIGN KEY ("snapshot_id", "business_id") REFERENCES "payroll_work_pay_calculation_snapshots"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_work_pay_calculation_lines" ADD CONSTRAINT "payroll_work_pay_lines_component_fkey" FOREIGN KEY ("payroll_component_id") REFERENCES "payroll_entry_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;
