-- Attendance P2: expected-attendance evidence, deterministic daily exceptions,
-- audited resolutions, final daily outcomes and immutable Timesheet day snapshots.
-- This migration is forward-compatible and does not rewrite legacy Attendance.

CREATE UNIQUE INDEX IF NOT EXISTS "branches_id_business_id_key" ON "branches"("id", "business_id");

CREATE TYPE "AttendanceExpectedDayKind" AS ENUM ('WORKDAY', 'NOT_SCHEDULED', 'REST_DAY', 'PUBLIC_HOLIDAY');
CREATE TYPE "AttendanceExpectedDaySource" AS ENUM ('ROSTER', 'FIXED_SCHEDULE', 'BRANCH_PATTERN', 'MANUAL_EVIDENCE');
CREATE TYPE "AttendanceExpectedDayStatus" AS ENUM ('CURRENT', 'SUPERSEDED');
CREATE TYPE "AttendanceP2ExceptionType" AS ENUM (
  'MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT', 'LATE_ARRIVAL', 'EARLY_DEPARTURE',
  'NO_ATTENDANCE_RECORDED', 'SUSPECTED_NO_SHOW', 'LEAVE_ATTENDANCE_CONFLICT'
);
CREATE TYPE "AttendanceP2ExceptionStatus" AS ENUM ('OPEN', 'PENDING_EMPLOYEE', 'PENDING_MANAGER', 'RESOLVED', 'CLOSED');
CREATE TYPE "AttendanceP2ResolutionType" AS ENUM ('AUTHORIZED', 'UNAUTHORIZED', 'CORRECTED', 'SCHEDULE_ERROR', 'NOT_SCHEDULED', 'APPROVED_LEAVE', 'EXCLUDED');
CREATE TYPE "AttendanceP2Outcome" AS ENUM (
  'PRESENT', 'PRESENT_LATE_AUTHORIZED', 'PRESENT_LATE_UNAUTHORIZED',
  'PRESENT_EARLY_AUTHORIZED', 'PRESENT_EARLY_UNAUTHORIZED',
  'AUTHORIZED_ABSENCE', 'UNAUTHORIZED_ABSENCE', 'APPROVED_PAID_LEAVE',
  'APPROVED_UNPAID_LEAVE', 'AUTHORIZED_EMERGENCY_LEAVE', 'NOT_SCHEDULED',
  'REST_DAY', 'PUBLIC_HOLIDAY', 'EXCLUDED'
);
CREATE TYPE "AttendanceCorrectionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "attendance_monthly_timesheets"
  ADD COLUMN "approval_revision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "approval_source_digest" VARCHAR(64),
  ADD COLUMN "approval_reason" VARCHAR(500),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "approved_by_id" UUID;

ALTER TABLE "attendance_monthly_timesheets" DROP CONSTRAINT "attendance_monthly_timesheets_locked_revision";
ALTER TABLE "attendance_monthly_timesheets"
  ADD CONSTRAINT "attendance_monthly_timesheets_state_evidence" CHECK (
    ("status" = 'DRAFT' AND "current_revision_id" IS NULL AND "approved_at" IS NULL AND "approved_by_id" IS NULL AND "approval_source_digest" IS NULL)
    OR
    ("status" = 'APPROVED' AND "current_revision_id" IS NULL AND "approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL AND "approval_source_digest" IS NOT NULL)
    OR
    ("status" = 'LOCKED' AND "current_revision_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "attendance_monthly_timesheets_approval_revision" CHECK ("approval_revision" >= 0),
  ADD CONSTRAINT "attendance_monthly_timesheets_approval_reason" CHECK (
    "approval_reason" IS NULL OR char_length(btrim("approval_reason")) BETWEEN 3 AND 500
  ),
  ADD CONSTRAINT "attendance_monthly_timesheets_approved_by_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "attendance_expected_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "kind" "AttendanceExpectedDayKind" NOT NULL,
  "source" "AttendanceExpectedDaySource" NOT NULL,
  "expected_start_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "grace_minutes" INTEGER NOT NULL DEFAULT 0,
  "timezone_snapshot" VARCHAR(100) NOT NULL,
  "policy_snapshot" JSONB,
  "evidence_reference" VARCHAR(160),
  "status" "AttendanceExpectedDayStatus" NOT NULL DEFAULT 'CURRENT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "supersedes_expected_day_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_expected_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_expected_days_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "attendance_expected_days_grace_check" CHECK ("grace_minutes" BETWEEN 0 AND 240),
  CONSTRAINT "attendance_expected_days_workday_times" CHECK (
    ("kind" = 'WORKDAY' AND "expected_start_at" IS NOT NULL AND "expected_end_at" IS NOT NULL AND "expected_end_at" > "expected_start_at")
    OR ("kind" <> 'WORKDAY' AND "expected_start_at" IS NULL AND "expected_end_at" IS NULL)
  )
);
CREATE UNIQUE INDEX "attendance_expected_days_business_member_date_revision_key" ON "attendance_expected_days"("business_id", "membership_id", "work_date", "revision");
CREATE UNIQUE INDEX "attendance_expected_days_id_business_key" ON "attendance_expected_days"("id", "business_id");
CREATE UNIQUE INDEX "attendance_expected_days_one_current_key" ON "attendance_expected_days"("business_id", "membership_id", "work_date") WHERE "status" = 'CURRENT';
CREATE INDEX "attendance_expected_days_business_branch_date_status_idx" ON "attendance_expected_days"("business_id", "branch_id", "work_date", "status");

CREATE TABLE "attendance_p2_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "type" "AttendanceP2ExceptionType" NOT NULL,
  "status" "AttendanceP2ExceptionStatus" NOT NULL DEFAULT 'OPEN',
  "stable_key" VARCHAR(200) NOT NULL,
  "expected_day_id" UUID,
  "attendance_session_id" UUID,
  "expected_start_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "actual_clock_in_at" TIMESTAMP(3),
  "actual_clock_out_at" TIMESTAMP(3),
  "grace_minutes_snapshot" INTEGER NOT NULL DEFAULT 0,
  "exception_minutes" INTEGER NOT NULL DEFAULT 0,
  "reason_code" VARCHAR(80) NOT NULL,
  "source_digest" VARCHAR(64) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "current_resolution_id" UUID,
  "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_p2_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_p2_exceptions_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "attendance_p2_exceptions_minutes_check" CHECK ("grace_minutes_snapshot" >= 0 AND "exception_minutes" >= 0),
  CONSTRAINT "attendance_p2_exceptions_resolution_state" CHECK (
    ("status" = 'RESOLVED' AND "current_resolution_id" IS NOT NULL AND "resolved_at" IS NOT NULL)
    OR ("status" <> 'RESOLVED')
  )
);
CREATE UNIQUE INDEX "attendance_p2_exceptions_stable_key_key" ON "attendance_p2_exceptions"("stable_key");
CREATE UNIQUE INDEX "attendance_p2_exceptions_id_business_key" ON "attendance_p2_exceptions"("id", "business_id");
CREATE UNIQUE INDEX "attendance_p2_exceptions_current_resolution_key" ON "attendance_p2_exceptions"("current_resolution_id");
CREATE INDEX "attendance_p2_exceptions_business_branch_status_date_idx" ON "attendance_p2_exceptions"("business_id", "branch_id", "status", "work_date");
CREATE INDEX "attendance_p2_exceptions_member_date_status_idx" ON "attendance_p2_exceptions"("membership_id", "work_date", "status");

CREATE TABLE "attendance_p2_resolutions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "exception_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "type" "AttendanceP2ResolutionType" NOT NULL,
  "outcome" "AttendanceP2Outcome" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "corrected_clock_in_at" TIMESTAMP(3),
  "corrected_clock_out_at" TIMESTAMP(3),
  "corrected_break_minutes" INTEGER,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_p2_resolutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_p2_resolutions_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "attendance_p2_resolutions_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "attendance_p2_resolutions_break_check" CHECK ("corrected_break_minutes" IS NULL OR "corrected_break_minutes" >= 0)
);
CREATE UNIQUE INDEX "attendance_p2_resolutions_exception_revision_key" ON "attendance_p2_resolutions"("exception_id", "revision");
CREATE UNIQUE INDEX "attendance_p2_resolutions_id_business_key" ON "attendance_p2_resolutions"("id", "business_id");
CREATE INDEX "attendance_p2_resolutions_business_member_created_idx" ON "attendance_p2_resolutions"("business_id", "membership_id", "created_at");

CREATE TABLE "attendance_correction_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "exception_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "employee_session_id" UUID NOT NULL,
  "request_key" VARCHAR(160) NOT NULL,
  "requested_clock_in_at" TIMESTAMP(3),
  "requested_clock_out_at" TIMESTAMP(3),
  "reason" VARCHAR(500) NOT NULL,
  "status" "AttendanceCorrectionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_reason" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_correction_requests_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500),
  CONSTRAINT "attendance_correction_requests_review_state" CHECK (
    ("status" = 'PENDING' AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" <> 'PENDING' AND "reviewed_at" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "attendance_correction_requests_request_key_key" ON "attendance_correction_requests"("request_key");
CREATE UNIQUE INDEX "attendance_correction_requests_id_business_key" ON "attendance_correction_requests"("id", "business_id");
CREATE UNIQUE INDEX "attendance_correction_requests_one_pending_key" ON "attendance_correction_requests"("exception_id") WHERE "status" = 'PENDING';
CREATE INDEX "attendance_correction_requests_business_member_status_created_idx" ON "attendance_correction_requests"("business_id", "membership_id", "status", "created_at");

CREATE TABLE "attendance_p2_final_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "version" INTEGER NOT NULL,
  "outcome" "AttendanceP2Outcome" NOT NULL,
  "expected_day_id" UUID,
  "leave_request_id" UUID,
  "expected_start_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "grace_minutes_snapshot" INTEGER NOT NULL DEFAULT 0,
  "actual_clock_in_at" TIMESTAMP(3),
  "actual_clock_out_at" TIMESTAMP(3),
  "total_break_minutes" INTEGER NOT NULL DEFAULT 0,
  "total_worked_minutes" INTEGER NOT NULL DEFAULT 0,
  "source_digest" VARCHAR(64) NOT NULL,
  "resolution_digest" VARCHAR(64) NOT NULL,
  "supersedes_result_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_p2_final_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_p2_final_results_version_check" CHECK ("version" > 0),
  CONSTRAINT "attendance_p2_final_results_minutes_check" CHECK ("grace_minutes_snapshot" >= 0 AND "total_break_minutes" >= 0 AND "total_worked_minutes" >= 0)
);
CREATE UNIQUE INDEX "attendance_p2_final_results_business_member_date_version_key" ON "attendance_p2_final_results"("business_id", "membership_id", "work_date", "version");
CREATE UNIQUE INDEX "attendance_p2_final_results_id_business_key" ON "attendance_p2_final_results"("id", "business_id");
CREATE INDEX "attendance_p2_final_results_business_branch_date_idx" ON "attendance_p2_final_results"("business_id", "branch_id", "work_date");

CREATE TABLE "attendance_timesheet_p2_day_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "work_date" DATE NOT NULL,
  "final_result_id" UUID NOT NULL,
  "final_result_version" INTEGER NOT NULL,
  "outcome" "AttendanceP2Outcome" NOT NULL,
  "expected_start_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "actual_clock_in_at" TIMESTAMP(3),
  "actual_clock_out_at" TIMESTAMP(3),
  "total_break_minutes" INTEGER NOT NULL,
  "total_worked_minutes" INTEGER NOT NULL,
  "source_digest" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_timesheet_p2_day_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_timesheet_p2_day_snapshots_minutes_check" CHECK ("total_break_minutes" >= 0 AND "total_worked_minutes" >= 0)
);
CREATE UNIQUE INDEX "attendance_timesheet_p2_day_revision_member_date_key" ON "attendance_timesheet_p2_day_snapshots"("revision_id", "membership_id", "work_date");
CREATE INDEX "attendance_timesheet_p2_day_business_branch_date_idx" ON "attendance_timesheet_p2_day_snapshots"("business_id", "branch_id", "work_date");
CREATE INDEX "attendance_timesheet_p2_day_final_result_idx" ON "attendance_timesheet_p2_day_snapshots"("final_result_id");

ALTER TABLE "attendance_expected_days"
  ADD CONSTRAINT "attendance_expected_days_business_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_expected_days_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_expected_days_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_expected_days_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_expected_days_supersedes_fkey" FOREIGN KEY ("supersedes_expected_day_id") REFERENCES "attendance_expected_days"("id") ON DELETE RESTRICT;
ALTER TABLE "attendance_p2_exceptions"
  ADD CONSTRAINT "attendance_p2_exceptions_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_exceptions_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_exceptions_expected_scope_fkey" FOREIGN KEY ("expected_day_id", "business_id") REFERENCES "attendance_expected_days"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_exceptions_session_fkey" FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id") ON DELETE RESTRICT;
ALTER TABLE "attendance_p2_resolutions"
  ADD CONSTRAINT "attendance_p2_resolutions_exception_scope_fkey" FOREIGN KEY ("exception_id", "business_id") REFERENCES "attendance_p2_exceptions"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_resolutions_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_resolutions_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "attendance_p2_exceptions"
  ADD CONSTRAINT "attendance_p2_exceptions_current_resolution_fkey" FOREIGN KEY ("current_resolution_id", "business_id") REFERENCES "attendance_p2_resolutions"("id", "business_id") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "attendance_correction_requests"
  ADD CONSTRAINT "attendance_correction_requests_exception_scope_fkey" FOREIGN KEY ("exception_id", "business_id") REFERENCES "attendance_p2_exceptions"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_correction_requests_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_correction_requests_employee_session_fkey" FOREIGN KEY ("employee_session_id") REFERENCES "employee_sessions"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_correction_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "attendance_p2_final_results"
  ADD CONSTRAINT "attendance_p2_final_results_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_final_results_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_final_results_expected_scope_fkey" FOREIGN KEY ("expected_day_id", "business_id") REFERENCES "attendance_expected_days"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_final_results_leave_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_final_results_supersedes_fkey" FOREIGN KEY ("supersedes_result_id") REFERENCES "attendance_p2_final_results"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_p2_final_results_created_by_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "attendance_timesheet_p2_day_snapshots"
  ADD CONSTRAINT "attendance_timesheet_p2_day_revision_scope_fkey" FOREIGN KEY ("revision_id", "business_id") REFERENCES "attendance_timesheet_revisions"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_timesheet_p2_day_membership_scope_fkey" FOREIGN KEY ("membership_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_timesheet_p2_day_branch_scope_fkey" FOREIGN KEY ("branch_id", "business_id") REFERENCES "branches"("id", "business_id") ON DELETE RESTRICT,
  ADD CONSTRAINT "attendance_timesheet_p2_day_final_scope_fkey" FOREIGN KEY ("final_result_id", "business_id") REFERENCES "attendance_p2_final_results"("id", "business_id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_expected_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Expected Attendance evidence is append-only.'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."branch_id" <> OLD."branch_id"
    OR NEW."membership_id" <> OLD."membership_id" OR NEW."work_date" <> OLD."work_date"
    OR NEW."kind" <> OLD."kind" OR NEW."source" <> OLD."source"
    OR NEW."expected_start_at" IS DISTINCT FROM OLD."expected_start_at"
    OR NEW."expected_end_at" IS DISTINCT FROM OLD."expected_end_at"
    OR NEW."grace_minutes" <> OLD."grace_minutes" OR NEW."revision" <> OLD."revision"
    OR NEW."supersedes_expected_day_id" IS DISTINCT FROM OLD."supersedes_expected_day_id"
    OR NEW."timezone_snapshot" <> OLD."timezone_snapshot"
    OR NEW."policy_snapshot" IS DISTINCT FROM OLD."policy_snapshot"
    OR NEW."evidence_reference" IS DISTINCT FROM OLD."evidence_reference"
    OR NEW."created_by_id" <> OLD."created_by_id" OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Expected Attendance facts are immutable; create a superseding version.';
  END IF;
  IF NOT (OLD."status" = 'CURRENT' AND NEW."status" = 'SUPERSEDED') THEN
    RAISE EXCEPTION 'Expected Attendance status transition is invalid.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_expected_days_guard" BEFORE UPDATE OR DELETE ON "attendance_expected_days" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_expected_guard();

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_exception_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance P2 exceptions cannot be deleted.'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."branch_id" <> OLD."branch_id"
    OR NEW."membership_id" <> OLD."membership_id" OR NEW."work_date" <> OLD."work_date"
    OR NEW."type" <> OLD."type" OR NEW."stable_key" <> OLD."stable_key"
    OR NEW."expected_day_id" IS DISTINCT FROM OLD."expected_day_id"
    OR NEW."attendance_session_id" IS DISTINCT FROM OLD."attendance_session_id"
    OR NEW."expected_start_at" IS DISTINCT FROM OLD."expected_start_at"
    OR NEW."expected_end_at" IS DISTINCT FROM OLD."expected_end_at"
    OR NEW."actual_clock_in_at" IS DISTINCT FROM OLD."actual_clock_in_at"
    OR NEW."actual_clock_out_at" IS DISTINCT FROM OLD."actual_clock_out_at"
    OR NEW."grace_minutes_snapshot" <> OLD."grace_minutes_snapshot"
    OR NEW."exception_minutes" <> OLD."exception_minutes"
    OR NEW."reason_code" <> OLD."reason_code"
    OR NEW."source_digest" <> OLD."source_digest" OR NEW."detected_at" <> OLD."detected_at" THEN
    RAISE EXCEPTION 'Attendance P2 exception evidence is immutable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_p2_exceptions_guard" BEFORE UPDATE OR DELETE ON "attendance_p2_exceptions" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_exception_guard();

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_append_only_guard()
RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Attendance P2 resolved history is append-only.'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_p2_resolutions_immutable" BEFORE UPDATE OR DELETE ON "attendance_p2_resolutions" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_p2_final_results_immutable" BEFORE UPDATE OR DELETE ON "attendance_p2_final_results" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_timesheet_p2_days_immutable" BEFORE UPDATE OR DELETE ON "attendance_timesheet_p2_day_snapshots" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();

CREATE OR REPLACE FUNCTION tetamu_attendance_correction_request_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Attendance correction requests cannot be deleted.'; END IF;
  IF NEW."business_id" <> OLD."business_id" OR NEW."exception_id" <> OLD."exception_id"
    OR NEW."membership_id" <> OLD."membership_id" OR NEW."employee_session_id" <> OLD."employee_session_id"
    OR NEW."request_key" <> OLD."request_key" OR NEW."requested_clock_in_at" IS DISTINCT FROM OLD."requested_clock_in_at"
    OR NEW."requested_clock_out_at" IS DISTINCT FROM OLD."requested_clock_out_at" OR NEW."reason" <> OLD."reason"
    OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'Attendance correction request facts are immutable.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_correction_requests_guard" BEFORE UPDATE OR DELETE ON "attendance_correction_requests" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_correction_request_guard();

CREATE OR REPLACE FUNCTION tetamu_attendance_expected_day_scope_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW."supersedes_expected_day_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "attendance_expected_days" prior
      WHERE prior."id" = NEW."supersedes_expected_day_id" AND prior."business_id" = NEW."business_id"
        AND prior."membership_id" = NEW."membership_id" AND prior."work_date" = NEW."work_date"
    ) THEN RAISE EXCEPTION 'Expected Attendance supersession scope mismatch.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_exception_scope_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW."attendance_session_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "employee_attendance" session
      WHERE session."id" = NEW."attendance_session_id" AND session."business_id" = NEW."business_id"
        AND session."branch_id" = NEW."branch_id" AND session."membership_id" = NEW."membership_id"
        AND session."work_date" = NEW."work_date"
    ) THEN RAISE EXCEPTION 'Attendance P2 session scope mismatch.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_resolution_scope_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM "attendance_p2_exceptions" issue
      WHERE issue."id" = NEW."exception_id" AND issue."business_id" = NEW."business_id"
        AND issue."membership_id" = NEW."membership_id"
    ) THEN RAISE EXCEPTION 'Attendance P2 resolution scope mismatch.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_attendance_correction_scope_guard()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM "employee_sessions" session
      WHERE session."id" = NEW."employee_session_id" AND session."business_id" = NEW."business_id"
        AND session."membership_id" = NEW."membership_id"
    ) THEN RAISE EXCEPTION 'Attendance correction employee session scope mismatch.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION tetamu_attendance_p2_final_scope_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW."leave_request_id" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "leave_requests" leave_record
      WHERE leave_record."id" = NEW."leave_request_id" AND leave_record."business_id" = NEW."business_id"
        AND leave_record."membership_id" = NEW."membership_id" AND leave_record."status" = 'APPROVED'
        AND NEW."work_date" BETWEEN leave_record."starts_on" AND leave_record."ends_on"
    ) THEN RAISE EXCEPTION 'Attendance P2 approved Leave scope mismatch.'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "attendance_expected_days_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_expected_days" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_expected_day_scope_guard();
CREATE TRIGGER "attendance_p2_exceptions_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_p2_exceptions" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_exception_scope_guard();
CREATE TRIGGER "attendance_p2_resolutions_scope_guard" BEFORE INSERT ON "attendance_p2_resolutions" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_resolution_scope_guard();
CREATE TRIGGER "attendance_correction_requests_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_correction_requests" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_correction_scope_guard();
CREATE TRIGGER "attendance_p2_final_results_scope_guard" BEFORE INSERT ON "attendance_p2_final_results" FOR EACH ROW EXECUTE FUNCTION tetamu_attendance_p2_final_scope_guard();

CREATE TRIGGER "attendance_expected_days_no_truncate" BEFORE TRUNCATE ON "attendance_expected_days" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_p2_exceptions_no_truncate" BEFORE TRUNCATE ON "attendance_p2_exceptions" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_p2_resolutions_no_truncate" BEFORE TRUNCATE ON "attendance_p2_resolutions" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_correction_requests_no_truncate" BEFORE TRUNCATE ON "attendance_correction_requests" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_p2_final_results_no_truncate" BEFORE TRUNCATE ON "attendance_p2_final_results" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();
CREATE TRIGGER "attendance_timesheet_p2_days_no_truncate" BEFORE TRUNCATE ON "attendance_timesheet_p2_day_snapshots" FOR EACH STATEMENT EXECUTE FUNCTION tetamu_attendance_p2_append_only_guard();

-- LEGACY ATTENDANCE MIGRATION DEFERRED: existing session-resolution and locked
-- Timesheet revisions remain untouched. P2 daily records are forward-only.
