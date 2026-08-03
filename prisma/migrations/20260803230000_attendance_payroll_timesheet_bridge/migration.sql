CREATE TYPE "PayrollAttendanceSource" AS ENUM (
  'LEGACY_OPERATIONAL_SESSION',
  'LOCKED_TIMESHEET_REVISION'
);

ALTER TABLE "payroll_runs"
  ADD COLUMN "attendance_source" "PayrollAttendanceSource" NOT NULL DEFAULT 'LEGACY_OPERATIONAL_SESSION',
  ADD COLUMN "attendance_timesheet_revision_id" UUID,
  ADD COLUMN "attendance_timesheet_revision_snapshot" INTEGER,
  ADD COLUMN "attendance_timesheet_digest_snapshot" VARCHAR(64),
  ADD COLUMN "attendance_timesheet_locked_at_snapshot" TIMESTAMP(3);

ALTER TABLE "payroll_runs"
  ALTER COLUMN "attendance_source" DROP DEFAULT;

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_attendance_source_evidence" CHECK (
    (
      "attendance_source" = 'LEGACY_OPERATIONAL_SESSION'
      AND "attendance_timesheet_revision_id" IS NULL
      AND "attendance_timesheet_revision_snapshot" IS NULL
      AND "attendance_timesheet_digest_snapshot" IS NULL
      AND "attendance_timesheet_locked_at_snapshot" IS NULL
    )
    OR
    (
      "attendance_source" = 'LOCKED_TIMESHEET_REVISION'
      AND "attendance_timesheet_revision_id" IS NOT NULL
      AND "attendance_timesheet_revision_snapshot" > 0
      AND "attendance_timesheet_digest_snapshot" IS NOT NULL
      AND "attendance_timesheet_locked_at_snapshot" IS NOT NULL
    )
  );

CREATE INDEX "payroll_runs_attendance_timesheet_revision_id_idx"
  ON "payroll_runs"("attendance_timesheet_revision_id");

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_attendance_timesheet_revision_scope_fkey"
  FOREIGN KEY ("attendance_timesheet_revision_id", "business_id")
  REFERENCES "attendance_timesheet_revisions"("id", "business_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_payroll_timesheet_bridge_integrity()
RETURNS trigger AS $$
DECLARE
  source_revision "attendance_timesheet_revisions"%ROWTYPE;
BEGIN
  IF NEW."attendance_source" = 'LOCKED_TIMESHEET_REVISION' THEN
    SELECT * INTO source_revision
    FROM "attendance_timesheet_revisions"
    WHERE "id" = NEW."attendance_timesheet_revision_id"
      AND "business_id" = NEW."business_id";

    IF NOT FOUND
      OR source_revision."period_start" <> NEW."period_start"
      OR source_revision."revision" <> NEW."attendance_timesheet_revision_snapshot"
      OR source_revision."source_digest" <> NEW."attendance_timesheet_digest_snapshot"
      OR source_revision."locked_at" <> NEW."attendance_timesheet_locked_at_snapshot" THEN
      RAISE EXCEPTION 'Payroll Attendance Timesheet provenance mismatch.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('REVIEW', 'FINALIZED')
    AND (
      NEW."attendance_source" IS DISTINCT FROM OLD."attendance_source"
      OR NEW."attendance_timesheet_revision_id" IS DISTINCT FROM OLD."attendance_timesheet_revision_id"
      OR NEW."attendance_timesheet_revision_snapshot" IS DISTINCT FROM OLD."attendance_timesheet_revision_snapshot"
      OR NEW."attendance_timesheet_digest_snapshot" IS DISTINCT FROM OLD."attendance_timesheet_digest_snapshot"
      OR NEW."attendance_timesheet_locked_at_snapshot" IS DISTINCT FROM OLD."attendance_timesheet_locked_at_snapshot"
    ) THEN
    RAISE EXCEPTION 'Reviewed or finalized Payroll Attendance provenance is immutable.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payroll_timesheet_bridge_integrity_guard"
BEFORE INSERT OR UPDATE ON "payroll_runs"
FOR EACH ROW EXECUTE FUNCTION enforce_payroll_timesheet_bridge_integrity();

-- Local integration teardown uses an explicit transaction-local maintenance flag.
-- Product runtime never sets this flag; immutable behavior remains fail-closed.
CREATE OR REPLACE FUNCTION reject_attendance_timesheet_immutable_change()
RETURNS trigger AS $$
BEGIN
  IF current_setting('tetamu.attendance_timesheet_test_maintenance', TRUE) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Locked Attendance Timesheet revisions and entries are immutable.';
END;
$$ LANGUAGE plpgsql;
