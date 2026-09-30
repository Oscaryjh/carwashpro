-- PostgreSQL truncated the historical FK name to the same prefix as an index.
-- Rename only: preserve columns, references, actions, indexes and row data.
BEGIN;

LOCK TABLE "attendance_timesheet_p2_segment_snapshots" IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
  original_definition text;
  original_oid oid;
BEGIN
  SELECT oid, pg_get_constraintdef(oid)
    INTO original_oid, original_definition
    FROM pg_constraint
    WHERE conrelid = '"attendance_timesheet_p2_segment_snapshots"'::regclass
      AND conname = 'attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i'
      AND contype = 'f';

  IF original_oid IS NULL OR original_definition IS DISTINCT FROM
    'FOREIGN KEY (source_day_snapshot_id) REFERENCES attendance_timesheet_p2_day_snapshots(id) ON UPDATE CASCADE ON DELETE RESTRICT'
  THEN
    RAISE EXCEPTION 'Attendance FK naming alignment: missing or unexpected historical FK';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"attendance_timesheet_p2_segment_snapshots"'::regclass
      AND conname = 'att_ts_p2_segment_source_day_snapshot_fkey_probe'
  ) OR EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = '"attendance_timesheet_p2_segment_snapshots"'::regclass)
      AND relname = 'att_ts_p2_segment_source_day_snapshot_fkey_probe'
  ) THEN
    RAISE EXCEPTION 'Attendance FK naming alignment: destination name conflict';
  END IF;

  ALTER TABLE "attendance_timesheet_p2_segment_snapshots"
    RENAME CONSTRAINT "attendance_timesheet_p2_segment_snapshots_source_day_snapshot_i"
    TO "att_ts_p2_segment_source_day_snapshot_fkey_probe";

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE oid = original_oid
      AND conname = 'att_ts_p2_segment_source_day_snapshot_fkey_probe'
      AND pg_get_constraintdef(oid) = original_definition
  ) THEN
    RAISE EXCEPTION 'Attendance FK naming alignment: definition changed';
  END IF;
END $$;

COMMIT;
