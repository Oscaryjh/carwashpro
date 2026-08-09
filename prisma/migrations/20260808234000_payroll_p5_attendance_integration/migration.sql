-- Payroll P5: immutable locked-Timesheet inputs and explainable Attendance components.
-- This migration is additive and performs no historical Payroll backfill.

ALTER TYPE "PayrollEntryComponentSourceType" ADD VALUE 'ATTENDANCE';

ALTER TABLE "attendance_p2_final_results"
  ADD COLUMN "expected_day_kind_snapshot" "AttendanceExpectedDayKind",
  ADD COLUMN "leave_day_fraction_snapshot" DECIMAL(3,2);

ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD COLUMN "expected_day_kind_snapshot" "AttendanceExpectedDayKind",
  ADD COLUMN "leave_day_fraction_snapshot" DECIMAL(3,2);

ALTER TABLE "attendance_p2_final_results"
  ADD CONSTRAINT "attendance_p2_final_results_leave_fraction_check" CHECK (
    "leave_day_fraction_snapshot" IS NULL
    OR ("leave_day_fraction_snapshot" > 0 AND "leave_day_fraction_snapshot" <= 1)
  );

ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD CONSTRAINT "attendance_timesheet_p2_days_leave_fraction_check" CHECK (
    "leave_day_fraction_snapshot" IS NULL
    OR ("leave_day_fraction_snapshot" > 0 AND "leave_day_fraction_snapshot" <= 1)
  );

CREATE TABLE "payroll_attendance_input_snapshots" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "payroll_run_id" UUID NOT NULL,
  "payroll_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "timesheet_id" UUID NOT NULL,
  "timesheet_revision_id" UUID NOT NULL,
  "timesheet_revision" INTEGER NOT NULL,
  "timesheet_source_digest" VARCHAR(64) NOT NULL,
  "timesheet_locked_at" TIMESTAMP(3) NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "regular_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "regular_minutes" INTEGER NOT NULL DEFAULT 0,
  "paid_leave_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "unpaid_leave_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "unauthorized_absence_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "authorized_absence_days" DECIMAL(6,2) NOT NULL DEFAULT 0,
  "rest_day_worked_minutes" INTEGER NOT NULL DEFAULT 0,
  "public_holiday_worked_minutes" INTEGER NOT NULL DEFAULT 0,
  "approved_overtime_minutes" INTEGER NOT NULL DEFAULT 0,
  "source_day_count" INTEGER NOT NULL DEFAULT 0,
  "legacy_compatibility" BOOLEAN NOT NULL DEFAULT false,
  "policy_blockers" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "source_digest" VARCHAR(64) NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_attendance_input_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payroll_attendance_input_snapshots_revision_check" CHECK ("timesheet_revision" > 0),
  CONSTRAINT "payroll_attendance_input_snapshots_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "payroll_attendance_input_snapshots_units_check" CHECK (
    "regular_days" >= 0
    AND "regular_minutes" >= 0
    AND "paid_leave_days" >= 0
    AND "unpaid_leave_days" >= 0
    AND "unauthorized_absence_days" >= 0
    AND "authorized_absence_days" >= 0
    AND "rest_day_worked_minutes" >= 0
    AND "public_holiday_worked_minutes" >= 0
    AND "approved_overtime_minutes" >= 0
    AND "source_day_count" >= 0
  ),
  CONSTRAINT "payroll_attendance_input_snapshots_policy_json_check" CHECK (
    jsonb_typeof("policy_blockers") = 'array'
  )
);

CREATE UNIQUE INDEX "payroll_attendance_input_snapshots_payroll_entry_id_key"
  ON "payroll_attendance_input_snapshots"("payroll_entry_id");
CREATE UNIQUE INDEX "payroll_attendance_input_snapshots_id_business_key"
  ON "payroll_attendance_input_snapshots"("id", "business_id");
CREATE UNIQUE INDEX "payroll_attendance_input_snapshots_entry_scope_key"
  ON "payroll_attendance_input_snapshots"("payroll_entry_id", "business_id", "membership_id");
CREATE INDEX "payroll_attendance_input_snapshots_business_run_idx"
  ON "payroll_attendance_input_snapshots"("business_id", "payroll_run_id");
CREATE INDEX "payroll_attendance_input_snapshots_business_member_period_idx"
  ON "payroll_attendance_input_snapshots"("business_id", "membership_id", "period_start");
CREATE INDEX "payroll_attendance_input_snapshots_revision_idx"
  ON "payroll_attendance_input_snapshots"("timesheet_revision_id");

ALTER TABLE "payroll_attendance_input_snapshots"
  ADD CONSTRAINT "payroll_attendance_input_snapshots_run_scope_fkey"
    FOREIGN KEY ("payroll_run_id", "business_id") REFERENCES "payroll_runs"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_attendance_input_snapshots_entry_scope_fkey"
    FOREIGN KEY ("payroll_entry_id", "business_id", "membership_id") REFERENCES "payroll_entries"("id", "business_id", "membership_id") ON DELETE CASCADE,
  ADD CONSTRAINT "payroll_attendance_input_snapshots_membership_scope_fkey"
    FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_attendance_input_snapshots_timesheet_scope_fkey"
    FOREIGN KEY ("timesheet_id", "business_id") REFERENCES "attendance_monthly_timesheets"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "payroll_attendance_input_snapshots_revision_scope_fkey"
    FOREIGN KEY ("timesheet_revision_id", "business_id") REFERENCES "attendance_timesheet_revisions"("id", "business_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION tetamu_guard_payroll_attendance_snapshot()
RETURNS trigger AS $$
DECLARE
  run_row "payroll_runs"%ROWTYPE;
  revision_row "attendance_timesheet_revisions"%ROWTYPE;
BEGIN
  SELECT * INTO run_row
  FROM "payroll_runs"
  WHERE "id" = COALESCE(NEW."payroll_run_id", OLD."payroll_run_id")
    AND "business_id" = COALESCE(NEW."business_id", OLD."business_id");

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll Attendance snapshot run scope mismatch.';
  END IF;
  IF run_row."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Payroll Attendance snapshots outside Draft are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT * INTO revision_row
  FROM "attendance_timesheet_revisions"
  WHERE "id" = NEW."timesheet_revision_id"
    AND "business_id" = NEW."business_id"
    AND "timesheet_id" = NEW."timesheet_id";

  IF NOT FOUND
    OR NEW."payroll_run_id" <> run_row."id"
    OR NEW."period_start" <> run_row."period_start"
    OR NEW."period_end" <> run_row."period_end"
    OR NEW."timesheet_revision_id" IS DISTINCT FROM run_row."attendance_timesheet_revision_id"
    OR NEW."timesheet_revision" IS DISTINCT FROM run_row."attendance_timesheet_revision_snapshot"
    OR NEW."timesheet_source_digest" IS DISTINCT FROM run_row."attendance_timesheet_digest_snapshot"
    OR NEW."timesheet_locked_at" IS DISTINCT FROM run_row."attendance_timesheet_locked_at_snapshot"
    OR revision_row."period_start" <> NEW."period_start"
    OR revision_row."revision" <> NEW."timesheet_revision"
    OR revision_row."source_digest" <> NEW."timesheet_source_digest"
    OR revision_row."locked_at" <> NEW."timesheet_locked_at" THEN
    RAISE EXCEPTION 'Payroll Attendance snapshot provenance mismatch.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_attendance_snapshots_guard_insert"
  BEFORE INSERT ON "payroll_attendance_input_snapshots"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_attendance_snapshot();
CREATE TRIGGER "payroll_attendance_snapshots_guard_update"
  BEFORE UPDATE ON "payroll_attendance_input_snapshots"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_attendance_snapshot();
CREATE TRIGGER "payroll_attendance_snapshots_guard_delete"
  BEFORE DELETE ON "payroll_attendance_input_snapshots"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_payroll_attendance_snapshot();

CREATE OR REPLACE FUNCTION tetamu_guard_attendance_component_source()
RETURNS trigger AS $$
BEGIN
  IF NEW."source_type" = 'ATTENDANCE' AND NOT EXISTS (
    SELECT 1
    FROM "payroll_attendance_input_snapshots" snapshot
    WHERE snapshot."id" = NEW."source_id"
      AND snapshot."id" = NEW."source_version_id"
      AND snapshot."business_id" = NEW."business_id"
      AND snapshot."payroll_run_id" = NEW."payroll_run_id"
      AND snapshot."payroll_entry_id" = NEW."payroll_entry_id"
      AND snapshot."membership_id" = NEW."membership_id"
      AND snapshot."timesheet_revision" = NEW."source_revision"
  ) THEN
    RAISE EXCEPTION 'Attendance Payroll component must reference its exact employee snapshot.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_attendance_component_source_guard"
  BEFORE INSERT OR UPDATE ON "payroll_entry_components"
  FOR EACH ROW EXECUTE FUNCTION tetamu_guard_attendance_component_source();

CREATE OR REPLACE FUNCTION tetamu_reject_payroll_attendance_snapshot_truncate()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payroll Attendance snapshot history cannot be truncated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_attendance_snapshots_no_truncate"
  BEFORE TRUNCATE ON "payroll_attendance_input_snapshots"
  FOR EACH STATEMENT EXECUTE FUNCTION tetamu_reject_payroll_attendance_snapshot_truncate();
