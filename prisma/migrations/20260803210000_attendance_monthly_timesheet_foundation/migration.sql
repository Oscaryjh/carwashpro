CREATE TYPE "AttendanceTimesheetStatus" AS ENUM ('DRAFT', 'LOCKED');
CREATE TYPE "AttendanceTimesheetBranchStatus" AS ENUM ('NOT_READY', 'READY');

CREATE TABLE "attendance_monthly_timesheets" (
  "id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "period_start" DATE NOT NULL,
  "status" "AttendanceTimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  "current_revision_id" UUID,
  "revision_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_monthly_timesheets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_monthly_timesheets_period_first_day" CHECK (EXTRACT(DAY FROM "period_start") = 1),
  CONSTRAINT "attendance_monthly_timesheets_locked_revision" CHECK (
    ("status" = 'DRAFT' AND "current_revision_id" IS NULL)
    OR ("status" = 'LOCKED' AND "current_revision_id" IS NOT NULL)
  )
);

CREATE TABLE "attendance_timesheet_branch_readiness" (
  "id" UUID NOT NULL,
  "timesheet_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "status" "AttendanceTimesheetBranchStatus" NOT NULL DEFAULT 'NOT_READY',
  "source_digest" VARCHAR(64),
  "ready_at" TIMESTAMP(3),
  "ready_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_timesheet_branch_readiness_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_timesheet_branch_readiness_ready_evidence" CHECK (
    ("status" = 'NOT_READY' AND "source_digest" IS NULL AND "ready_at" IS NULL AND "ready_by_id" IS NULL)
    OR ("status" = 'READY' AND "source_digest" IS NOT NULL AND "ready_at" IS NOT NULL AND "ready_by_id" IS NOT NULL)
  )
);

CREATE TABLE "attendance_timesheet_revisions" (
  "id" UUID NOT NULL,
  "timesheet_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "period_start" DATE NOT NULL,
  "source_digest" VARCHAR(64) NOT NULL,
  "reason" TEXT NOT NULL,
  "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_timesheet_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_timesheet_revisions_positive_revision" CHECK ("revision" > 0),
  CONSTRAINT "attendance_timesheet_revisions_period_first_day" CHECK (EXTRACT(DAY FROM "period_start") = 1),
  CONSTRAINT "attendance_timesheet_revisions_reason" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 500)
);

CREATE TABLE "attendance_timesheet_revision_entries" (
  "id" UUID NOT NULL,
  "revision_id" UUID NOT NULL,
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "attendance_session_id" UUID NOT NULL,
  "final_result_id" UUID NOT NULL,
  "final_result_version" INTEGER NOT NULL,
  "disposition" "AttendanceFinalResultDisposition" NOT NULL,
  "work_date" DATE NOT NULL,
  "clock_in_at" TIMESTAMP(3),
  "clock_out_at" TIMESTAMP(3),
  "total_break_minutes" INTEGER NOT NULL,
  "total_worked_minutes" INTEGER NOT NULL,
  "final_result_checksum" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_timesheet_revision_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_timesheet_revision_entries_nonnegative" CHECK (
    "final_result_version" > 0 AND "total_break_minutes" >= 0 AND "total_worked_minutes" >= 0
  )
);

CREATE UNIQUE INDEX "attendance_monthly_timesheets_business_id_period_start_key" ON "attendance_monthly_timesheets"("business_id", "period_start");
CREATE UNIQUE INDEX "attendance_monthly_timesheets_id_business_id_key" ON "attendance_monthly_timesheets"("id", "business_id");
CREATE UNIQUE INDEX "attendance_monthly_timesheets_current_revision_id_key" ON "attendance_monthly_timesheets"("current_revision_id");
CREATE INDEX "attendance_monthly_timesheets_business_id_status_period_start_idx" ON "attendance_monthly_timesheets"("business_id", "status", "period_start");

CREATE UNIQUE INDEX "attendance_timesheet_branch_readiness_timesheet_id_branch_id_key" ON "attendance_timesheet_branch_readiness"("timesheet_id", "branch_id");
CREATE INDEX "attendance_timesheet_branch_readiness_business_id_branch_id_status_idx" ON "attendance_timesheet_branch_readiness"("business_id", "branch_id", "status");

CREATE UNIQUE INDEX "attendance_timesheet_revisions_timesheet_id_revision_key" ON "attendance_timesheet_revisions"("timesheet_id", "revision");
CREATE UNIQUE INDEX "attendance_timesheet_revisions_id_business_id_key" ON "attendance_timesheet_revisions"("id", "business_id");
CREATE INDEX "attendance_timesheet_revisions_business_id_period_start_revision_idx" ON "attendance_timesheet_revisions"("business_id", "period_start", "revision");

CREATE UNIQUE INDEX "attendance_timesheet_revision_entries_revision_id_attendance_session_id_key" ON "attendance_timesheet_revision_entries"("revision_id", "attendance_session_id");
CREATE INDEX "attendance_timesheet_revision_entries_business_id_branch_id_work_date_idx" ON "attendance_timesheet_revision_entries"("business_id", "branch_id", "work_date");
CREATE INDEX "attendance_timesheet_revision_entries_employee_id_work_date_idx" ON "attendance_timesheet_revision_entries"("employee_id", "work_date");
CREATE INDEX "attendance_timesheet_revision_entries_final_result_id_idx" ON "attendance_timesheet_revision_entries"("final_result_id");

ALTER TABLE "attendance_monthly_timesheets" ADD CONSTRAINT "attendance_monthly_timesheets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_branch_readiness" ADD CONSTRAINT "attendance_timesheet_branch_readiness_timesheet_scope_fkey" FOREIGN KEY ("timesheet_id", "business_id") REFERENCES "attendance_monthly_timesheets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_branch_readiness" ADD CONSTRAINT "attendance_timesheet_branch_readiness_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_branch_readiness" ADD CONSTRAINT "attendance_timesheet_branch_readiness_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_branch_readiness" ADD CONSTRAINT "attendance_timesheet_branch_readiness_ready_by_id_fkey" FOREIGN KEY ("ready_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revisions" ADD CONSTRAINT "attendance_timesheet_revisions_timesheet_scope_fkey" FOREIGN KEY ("timesheet_id", "business_id") REFERENCES "attendance_monthly_timesheets"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revisions" ADD CONSTRAINT "attendance_timesheet_revisions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revisions" ADD CONSTRAINT "attendance_timesheet_revisions_locked_by_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_revision_scope_fkey" FOREIGN KEY ("revision_id", "business_id") REFERENCES "attendance_timesheet_revisions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_employee_scope_fkey" FOREIGN KEY ("employee_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_attendance_session_id_fkey" FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_timesheet_revision_entries" ADD CONSTRAINT "attendance_timesheet_revision_entries_final_result_scope_fkey" FOREIGN KEY ("final_result_id", "business_id") REFERENCES "attendance_final_results"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_monthly_timesheets" ADD CONSTRAINT "attendance_monthly_timesheets_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "attendance_timesheet_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION enforce_attendance_timesheet_scope()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'attendance_timesheet_branch_readiness' THEN
    IF NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."business_id" = NEW."business_id") THEN
      RAISE EXCEPTION 'Attendance Timesheet branch scope mismatch.';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_timesheet_revisions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "attendance_monthly_timesheets" t
      WHERE t."id" = NEW."timesheet_id" AND t."business_id" = NEW."business_id" AND t."period_start" = NEW."period_start"
    ) THEN
      RAISE EXCEPTION 'Attendance Timesheet revision scope mismatch.';
    END IF;
  ELSIF TG_TABLE_NAME = 'attendance_timesheet_revision_entries' THEN
    IF NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."business_id" = NEW."business_id")
      OR NOT EXISTS (SELECT 1 FROM "employee_attendance" a WHERE a."id" = NEW."attendance_session_id" AND a."business_id" = NEW."business_id" AND a."branch_id" = NEW."branch_id" AND a."membership_id" = NEW."employee_id")
      OR NOT EXISTS (SELECT 1 FROM "attendance_final_results" r WHERE r."id" = NEW."final_result_id" AND r."business_id" = NEW."business_id" AND r."branch_id" = NEW."branch_id" AND r."attendance_session_id" = NEW."attendance_session_id" AND r."employee_id" = NEW."employee_id" AND r."version" = NEW."final_result_version" AND r."evidence_checksum" = NEW."final_result_checksum")
      OR NOT EXISTS (SELECT 1 FROM "attendance_timesheet_revisions" revision WHERE revision."id" = NEW."revision_id" AND NEW."work_date" >= revision."period_start" AND NEW."work_date" < (revision."period_start" + INTERVAL '1 month')) THEN
      RAISE EXCEPTION 'Attendance Timesheet entry evidence scope mismatch.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_timesheet_branch_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_timesheet_branch_readiness" FOR EACH ROW EXECUTE FUNCTION enforce_attendance_timesheet_scope();
CREATE TRIGGER "attendance_timesheet_revision_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_timesheet_revisions" FOR EACH ROW EXECUTE FUNCTION enforce_attendance_timesheet_scope();
CREATE TRIGGER "attendance_timesheet_entry_scope_guard" BEFORE INSERT OR UPDATE ON "attendance_timesheet_revision_entries" FOR EACH ROW EXECUTE FUNCTION enforce_attendance_timesheet_scope();

CREATE OR REPLACE FUNCTION enforce_attendance_monthly_timesheet_integrity()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."business_id" <> OLD."business_id" OR NEW."period_start" <> OLD."period_start")
    AND EXISTS (SELECT 1 FROM "attendance_timesheet_revisions" revision WHERE revision."timesheet_id" = OLD."id") THEN
    RAISE EXCEPTION 'Attendance Timesheet identity cannot change after a locked revision exists.';
  END IF;
  IF NEW."current_revision_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "attendance_timesheet_revisions" revision
    WHERE revision."id" = NEW."current_revision_id"
      AND revision."timesheet_id" = NEW."id"
      AND revision."business_id" = NEW."business_id"
      AND revision."period_start" = NEW."period_start"
  ) THEN
    RAISE EXCEPTION 'Current Attendance Timesheet revision scope mismatch.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_monthly_timesheet_integrity_guard" BEFORE INSERT OR UPDATE ON "attendance_monthly_timesheets" FOR EACH ROW EXECUTE FUNCTION enforce_attendance_monthly_timesheet_integrity();

CREATE OR REPLACE FUNCTION reject_attendance_timesheet_immutable_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Locked Attendance Timesheet revisions and entries are immutable.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_timesheet_revision_immutable" BEFORE UPDATE OR DELETE ON "attendance_timesheet_revisions" FOR EACH ROW EXECUTE FUNCTION reject_attendance_timesheet_immutable_change();
CREATE TRIGGER "attendance_timesheet_entry_immutable" BEFORE UPDATE OR DELETE ON "attendance_timesheet_revision_entries" FOR EACH ROW EXECUTE FUNCTION reject_attendance_timesheet_immutable_change();
CREATE TRIGGER "attendance_timesheet_revision_no_truncate" BEFORE TRUNCATE ON "attendance_timesheet_revisions" FOR EACH STATEMENT EXECUTE FUNCTION reject_attendance_timesheet_immutable_change();
CREATE TRIGGER "attendance_timesheet_entry_no_truncate" BEFORE TRUNCATE ON "attendance_timesheet_revision_entries" FOR EACH STATEMENT EXECUTE FUNCTION reject_attendance_timesheet_immutable_change();
