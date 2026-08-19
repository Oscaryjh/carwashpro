-- Freeze branch-local time context at the locked Timesheet boundary so Payroll
-- can fail closed instead of assigning a cross-midnight shift to one legal day.
ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD COLUMN "timezone_snapshot" VARCHAR(100),
  ADD COLUMN "cross_midnight_snapshot" BOOLEAN NOT NULL DEFAULT false;
