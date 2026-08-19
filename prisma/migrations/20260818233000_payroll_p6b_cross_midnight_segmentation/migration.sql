-- P6B freezes local legal-day work segments in the locked Attendance Timesheet.
-- It deliberately contains minute facts only; monetary OT calculations remain P6C.
CREATE TABLE "attendance_timesheet_p2_segment_snapshots" (
  "id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "source_day_snapshot_id" UUID NOT NULL,
  "source_final_result_id" UUID NOT NULL,
  "source_attendance_id" UUID,
  "segment_index" INTEGER NOT NULL,
  "local_date" DATE NOT NULL,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "timezone_snapshot" VARCHAR(100) NOT NULL,
  "context" "AttendanceOvertimeContext" NOT NULL,
  "expected_day_kind_snapshot" "AttendanceExpectedDayKind",
  "expected_start_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "is_rest_day" BOOLEAN NOT NULL DEFAULT false,
  "is_public_holiday" BOOLEAN NOT NULL DEFAULT false,
  "is_unscheduled" BOOLEAN NOT NULL DEFAULT false,
  "holiday_context_snapshot" JSONB,
  "leave_request_id_snapshot" UUID,
  "leave_day_fraction_snapshot" DECIMAL(3,2),
  "gross_minutes" INTEGER NOT NULL,
  "break_minutes" INTEGER NOT NULL,
  "worked_minutes" INTEGER NOT NULL,
  "potential_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  "approved_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  "source_digest" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_timesheet_p2_segment_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_timesheet_p2_segment_snapshots_source_day_snapshot_id_segment_index_key"
  ON "attendance_timesheet_p2_segment_snapshots"("source_day_snapshot_id", "segment_index");
CREATE INDEX "attendance_timesheet_p2_segment_snapshots_revision_id_membership_id_local_date_idx"
  ON "attendance_timesheet_p2_segment_snapshots"("revision_id", "membership_id", "local_date");
CREATE INDEX "attendance_timesheet_p2_segment_snapshots_business_id_branch_id_local_date_idx"
  ON "attendance_timesheet_p2_segment_snapshots"("business_id", "branch_id", "local_date");
CREATE INDEX "attendance_timesheet_p2_segment_snapshots_source_final_result_id_idx"
  ON "attendance_timesheet_p2_segment_snapshots"("source_final_result_id");

ALTER TABLE "attendance_timesheet_p2_segment_snapshots"
  ADD CONSTRAINT "attendance_timesheet_p2_segment_snapshots_revision_id_business_id_fkey"
  FOREIGN KEY ("revision_id", "business_id") REFERENCES "attendance_timesheet_revisions"("id", "business_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_p2_segment_snapshots"
  ADD CONSTRAINT "attendance_timesheet_p2_segment_snapshots_source_day_snapshot_id_fkey"
  FOREIGN KEY ("source_day_snapshot_id") REFERENCES "attendance_timesheet_p2_day_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_attendance_input_snapshots"
  ADD COLUMN "regular_normal_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "normal_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rest_day_work_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rest_day_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "public_holiday_work_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "public_holiday_ot_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "segment_facts" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "attendance_timesheet_p2_segment_snapshots"
  ADD CONSTRAINT "attendance_timesheet_p2_segment_minutes_check"
  CHECK (
    "gross_minutes" >= 0 AND
    "break_minutes" >= 0 AND
    "worked_minutes" >= 0 AND
    "potential_ot_minutes" >= 0 AND
    "approved_ot_minutes" >= 0 AND
    "break_minutes" + "worked_minutes" = "gross_minutes" AND
    "approved_ot_minutes" <= "potential_ot_minutes" AND
    "potential_ot_minutes" <= "worked_minutes" AND
    "end_at" > "start_at"
  );
