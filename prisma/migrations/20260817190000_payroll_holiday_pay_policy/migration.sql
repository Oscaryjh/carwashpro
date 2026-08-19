CREATE TYPE "PayrollHolidayPayDecisionStatus" AS ENUM (
  'NOT_APPLICABLE',
  'POLICY_DISABLED',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'EXCLUDED'
);

ALTER TABLE "payroll_settings"
  ADD COLUMN "public_holiday_pay_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "public_holiday_pay_policy_revision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "payroll_runs"
  ADD COLUMN "public_holiday_pay_enabled_snapshot" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "public_holiday_pay_policy_revision_snapshot" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "payroll_entries"
  ADD COLUMN "public_holiday_pay_preview" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "public_holiday_pay_decision_status" "PayrollHolidayPayDecisionStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
  ADD COLUMN "public_holiday_pay_decision_reason" VARCHAR(500),
  ADD COLUMN "public_holiday_pay_decided_by_id" UUID,
  ADD COLUMN "public_holiday_pay_decided_at" TIMESTAMP(3);
