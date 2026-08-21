ALTER TABLE "payroll_settings"
ADD COLUMN "rest_day_work_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
ADD COLUMN "rest_day_overtime_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 2.00,
ADD COLUMN "public_holiday_overtime_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 3.00;

ALTER TABLE "payroll_runs"
ADD COLUMN "rest_day_work_multiplier_snapshot" DECIMAL(5,2) NOT NULL DEFAULT 1.00,
ADD COLUMN "rest_day_overtime_multiplier_snapshot" DECIMAL(5,2) NOT NULL DEFAULT 2.00,
ADD COLUMN "public_holiday_overtime_multiplier_snapshot" DECIMAL(5,2) NOT NULL DEFAULT 3.00;
