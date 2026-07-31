-- Additive Attendance work/break and compensation foundation.
-- Existing rows retain backward-compatible manual punch behaviour.
BEGIN;

CREATE TYPE "EmployeePayBasis" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');
CREATE TYPE "AttendanceBreakPolicy" AS ENUM ('MANUAL_PUNCH', 'FLEXIBLE_CONFIRMATION', 'PAID_BREAK');
CREATE TYPE "AttendanceBreakConfirmationMethod" AS ENUM ('PUNCHES', 'EMPLOYEE_CONFIRMATION', 'PAID', 'NOT_REQUIRED');

ALTER TYPE "AttendanceExceptionType" ADD VALUE IF NOT EXISTS 'MISSED_BREAK';

ALTER TABLE "employee_business_memberships"
  ADD COLUMN "pay_basis" "EmployeePayBasis" NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN "base_salary" DECIMAL(12,2),
  ADD COLUMN "normal_work_minutes_per_day" INTEGER,
  ADD COLUMN "target_break_minutes" INTEGER;

ALTER TABLE "branch_attendance_settings"
  ADD COLUMN "break_policy" "AttendanceBreakPolicy" NOT NULL DEFAULT 'MANUAL_PUNCH',
  ADD COLUMN "target_break_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "normal_work_minutes_per_day" INTEGER NOT NULL DEFAULT 480,
  ADD COLUMN "shift_span_minutes" INTEGER NOT NULL DEFAULT 540;

ALTER TABLE "employee_attendance"
  ADD COLUMN "break_policy_snapshot" "AttendanceBreakPolicy" NOT NULL DEFAULT 'MANUAL_PUNCH',
  ADD COLUMN "expected_break_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "confirmed_break_minutes" INTEGER,
  ADD COLUMN "break_confirmation_method" "AttendanceBreakConfirmationMethod" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "break_confirmed_at" TIMESTAMP(3);

ALTER TABLE "employee_business_memberships"
  ADD CONSTRAINT "employee_membership_base_salary_nonnegative" CHECK ("base_salary" IS NULL OR "base_salary" >= 0),
  ADD CONSTRAINT "employee_membership_work_minutes_positive" CHECK ("normal_work_minutes_per_day" IS NULL OR "normal_work_minutes_per_day" BETWEEN 60 AND 1440),
  ADD CONSTRAINT "employee_membership_break_minutes_valid" CHECK ("target_break_minutes" IS NULL OR "target_break_minutes" BETWEEN 0 AND 480);

ALTER TABLE "branch_attendance_settings"
  ADD CONSTRAINT "branch_attendance_target_break_valid" CHECK ("target_break_minutes" BETWEEN 0 AND 480),
  ADD CONSTRAINT "branch_attendance_normal_work_valid" CHECK ("normal_work_minutes_per_day" BETWEEN 60 AND 1440),
  ADD CONSTRAINT "branch_attendance_shift_span_valid" CHECK ("shift_span_minutes" BETWEEN 60 AND 1440),
  ADD CONSTRAINT "branch_attendance_shift_covers_work" CHECK ("shift_span_minutes" >= "normal_work_minutes_per_day");

ALTER TABLE "employee_attendance"
  ADD CONSTRAINT "employee_attendance_expected_break_valid" CHECK ("expected_break_minutes" BETWEEN 0 AND 480),
  ADD CONSTRAINT "employee_attendance_confirmed_break_valid" CHECK ("confirmed_break_minutes" IS NULL OR "confirmed_break_minutes" BETWEEN 0 AND 1440);

COMMIT;

