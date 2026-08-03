BEGIN;

CREATE TYPE "AttendanceResolutionCaseStatus" AS ENUM (
  'OPEN',
  'UNDER_REVIEW',
  'RETURNED_FOR_CORRECTION',
  'RESOLVED',
  'SUPERSEDED'
);

CREATE TYPE "AttendanceResolutionReason" AS ENUM (
  'APPROVAL_PENDING',
  'APPROVAL_REJECTED',
  'INCOMPLETE_SESSION',
  'CANCELLED_SESSION',
  'MANAGER_ADJUSTMENT',
  'LEGACY_COMPLETED',
  'OTHER'
);

CREATE TYPE "AttendanceFinalResultDisposition" AS ENUM (
  'INCLUDED',
  'EXCLUDED'
);

CREATE TYPE "AttendanceFinalResultSource" AS ENUM (
  'RAW_SESSION',
  'APPROVED_EXCEPTION',
  'MANAGER_ADJUSTMENT',
  'LEGACY_BACKFILL',
  'CORRECTION'
);

CREATE TABLE "attendance_resolution_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "attendance_session_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "status" "AttendanceResolutionCaseStatus" NOT NULL DEFAULT 'OPEN',
  "opened_reason" "AttendanceResolutionReason" NOT NULL,
  "current_final_result_id" UUID,
  "created_by_id" UUID,
  "resolved_by_id" UUID,
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_resolution_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_resolution_cases_resolution_state_check" CHECK (
    ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
    OR ("status" <> 'RESOLVED')
  )
);

CREATE TABLE "attendance_final_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "attendance_session_id" UUID NOT NULL,
  "resolution_case_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "disposition" "AttendanceFinalResultDisposition" NOT NULL,
  "source" "AttendanceFinalResultSource" NOT NULL,
  "work_date" DATE NOT NULL,
  "clock_in_at" TIMESTAMP(3),
  "clock_out_at" TIMESTAMP(3),
  "total_break_minutes" INTEGER NOT NULL,
  "total_worked_minutes" INTEGER NOT NULL,
  "break_policy_snapshot" "AttendanceBreakPolicy" NOT NULL,
  "expected_break_minutes" INTEGER NOT NULL,
  "confirmed_break_minutes" INTEGER,
  "approval_status_snapshot" "AttendanceApprovalStatus" NOT NULL,
  "session_updated_at_snapshot" TIMESTAMP(3) NOT NULL,
  "evidence_checksum" VARCHAR(64) NOT NULL,
  "supersedes_result_id" UUID,
  "created_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_final_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_final_results_version_check" CHECK ("version" > 0),
  CONSTRAINT "attendance_final_results_minutes_check" CHECK (
    "total_break_minutes" >= 0
    AND "total_worked_minutes" >= 0
    AND "expected_break_minutes" >= 0
    AND ("confirmed_break_minutes" IS NULL OR "confirmed_break_minutes" >= 0)
  ),
  CONSTRAINT "attendance_final_results_included_time_check" CHECK (
    "disposition" <> 'INCLUDED'
    OR (
      "clock_in_at" IS NOT NULL
      AND "clock_out_at" IS NOT NULL
      AND "clock_out_at" > "clock_in_at"
    )
  ),
  CONSTRAINT "attendance_final_results_checksum_check" CHECK (
    "evidence_checksum" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "attendance_resolution_cases_attendance_session_id_key"
  ON "attendance_resolution_cases"("attendance_session_id");
CREATE UNIQUE INDEX "attendance_resolution_cases_current_final_result_id_key"
  ON "attendance_resolution_cases"("current_final_result_id");
CREATE UNIQUE INDEX "attendance_resolution_cases_id_business_id_key"
  ON "attendance_resolution_cases"("id", "business_id");
CREATE INDEX "attendance_resolution_cases_business_branch_status_opened_idx"
  ON "attendance_resolution_cases"("business_id", "branch_id", "status", "opened_at");
CREATE INDEX "attendance_resolution_cases_employee_status_opened_idx"
  ON "attendance_resolution_cases"("employee_id", "status", "opened_at");

CREATE UNIQUE INDEX "attendance_final_results_id_business_id_key"
  ON "attendance_final_results"("id", "business_id");
CREATE UNIQUE INDEX "attendance_final_results_case_version_key"
  ON "attendance_final_results"("resolution_case_id", "version");
CREATE INDEX "attendance_final_results_business_branch_work_date_idx"
  ON "attendance_final_results"("business_id", "branch_id", "work_date");
CREATE INDEX "attendance_final_results_employee_work_date_idx"
  ON "attendance_final_results"("employee_id", "work_date");
CREATE INDEX "attendance_final_results_session_version_idx"
  ON "attendance_final_results"("attendance_session_id", "version");
CREATE INDEX "attendance_final_results_supersedes_result_id_idx"
  ON "attendance_final_results"("supersedes_result_id");

ALTER TABLE "attendance_resolution_cases"
  ADD CONSTRAINT "attendance_resolution_cases_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_cases_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_cases_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_cases_employee_id_business_id_fkey"
    FOREIGN KEY ("employee_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_cases_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_cases_resolved_by_id_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_final_results"
  ADD CONSTRAINT "attendance_final_results_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_resolution_case_id_fkey"
    FOREIGN KEY ("resolution_case_id") REFERENCES "attendance_resolution_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_employee_id_business_id_fkey"
    FOREIGN KEY ("employee_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_supersedes_result_id_fkey"
    FOREIGN KEY ("supersedes_result_id") REFERENCES "attendance_final_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_final_results_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_resolution_cases"
  ADD CONSTRAINT "attendance_resolution_cases_current_final_result_id_fkey"
    FOREIGN KEY ("current_final_result_id") REFERENCES "attendance_final_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_attendance_resolution_case_scope"()
RETURNS TRIGGER AS $$
DECLARE
  session_row RECORD;
  result_case_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."business_id" IS DISTINCT FROM OLD."business_id"
    OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
    OR NEW."attendance_session_id" IS DISTINCT FROM OLD."attendance_session_id"
    OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
    OR NEW."opened_at" IS DISTINCT FROM OLD."opened_at"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
  ) THEN
    RAISE EXCEPTION 'Attendance Resolution Case identity and scope are immutable';
  END IF;

  SELECT "business_id", "branch_id", "membership_id"
  INTO session_row
  FROM "employee_attendance"
  WHERE "id" = NEW."attendance_session_id";

  IF session_row IS NULL
    OR session_row."business_id" <> NEW."business_id"
    OR session_row."branch_id" <> NEW."branch_id"
    OR session_row."membership_id" <> NEW."employee_id"
  THEN
    RAISE EXCEPTION 'Attendance Resolution Case scope does not match its Session';
  END IF;

  IF NEW."current_final_result_id" IS NOT NULL THEN
    SELECT "resolution_case_id"
    INTO result_case_id
    FROM "attendance_final_results"
    WHERE "id" = NEW."current_final_result_id";

    IF result_case_id IS NULL OR result_case_id <> NEW."id" THEN
      RAISE EXCEPTION 'Current Final Attendance Result does not belong to this Case';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_resolution_case_scope_guard"
BEFORE INSERT OR UPDATE ON "attendance_resolution_cases"
FOR EACH ROW EXECUTE FUNCTION "guard_attendance_resolution_case_scope"();

CREATE OR REPLACE FUNCTION "guard_attendance_final_result_insert"()
RETURNS TRIGGER AS $$
DECLARE
  case_row RECORD;
  session_row RECORD;
  expected_version INTEGER;
BEGIN
  SELECT "business_id", "branch_id", "attendance_session_id", "employee_id", "current_final_result_id"
  INTO case_row
  FROM "attendance_resolution_cases"
  WHERE "id" = NEW."resolution_case_id"
  FOR UPDATE;

  IF case_row IS NULL
    OR case_row."business_id" <> NEW."business_id"
    OR case_row."branch_id" <> NEW."branch_id"
    OR case_row."attendance_session_id" <> NEW."attendance_session_id"
    OR case_row."employee_id" <> NEW."employee_id"
  THEN
    RAISE EXCEPTION 'Final Attendance Result scope does not match its Resolution Case';
  END IF;

  SELECT "business_id", "branch_id", "membership_id"
  INTO session_row
  FROM "employee_attendance"
  WHERE "id" = NEW."attendance_session_id";

  IF session_row IS NULL
    OR session_row."business_id" <> NEW."business_id"
    OR session_row."branch_id" <> NEW."branch_id"
    OR session_row."membership_id" <> NEW."employee_id"
  THEN
    RAISE EXCEPTION 'Final Attendance Result scope does not match its Session';
  END IF;

  SELECT COALESCE(MAX("version"), 0) + 1
  INTO expected_version
  FROM "attendance_final_results"
  WHERE "resolution_case_id" = NEW."resolution_case_id";

  IF NEW."version" <> expected_version THEN
    RAISE EXCEPTION 'Final Attendance Result version must be the next version';
  END IF;

  IF NEW."version" = 1 AND NEW."supersedes_result_id" IS NOT NULL THEN
    RAISE EXCEPTION 'The first Final Attendance Result cannot supersede another result';
  END IF;

  IF NEW."version" > 1 AND (
    NEW."supersedes_result_id" IS NULL
    OR NEW."supersedes_result_id" IS DISTINCT FROM case_row."current_final_result_id"
  ) THEN
    RAISE EXCEPTION 'A Final Attendance Result revision must supersede the current result';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_final_result_insert_guard"
BEFORE INSERT ON "attendance_final_results"
FOR EACH ROW EXECUTE FUNCTION "guard_attendance_final_result_insert"();

CREATE OR REPLACE FUNCTION "prevent_attendance_final_result_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Final Attendance Results are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_final_result_update_guard"
BEFORE UPDATE OR DELETE ON "attendance_final_results"
FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_final_result_mutation"();

CREATE TRIGGER "attendance_final_result_truncate_guard"
BEFORE TRUNCATE ON "attendance_final_results"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_attendance_final_result_mutation"();

CREATE OR REPLACE FUNCTION "prevent_attendance_resolution_case_deletion"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance Resolution Cases cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_resolution_case_delete_guard"
BEFORE DELETE ON "attendance_resolution_cases"
FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_resolution_case_deletion"();

CREATE TRIGGER "attendance_resolution_case_truncate_guard"
BEFORE TRUNCATE ON "attendance_resolution_cases"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_attendance_resolution_case_deletion"();

-- Legacy backfill is additive. It does not mutate Attendance evidence, Payroll
-- Runs, Payroll Entries, finalized calculations, Leave, or statutory artifacts.
INSERT INTO "attendance_resolution_cases" (
  "id",
  "business_id",
  "branch_id",
  "attendance_session_id",
  "employee_id",
  "status",
  "opened_reason",
  "opened_at",
  "resolved_at",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  attendance."business_id",
  attendance."branch_id",
  attendance."id",
  attendance."membership_id",
  CASE
    WHEN attendance."status" = 'CANCELLED' THEN 'RESOLVED'::"AttendanceResolutionCaseStatus"
    WHEN attendance."status" = 'COMPLETED'
      AND attendance."approval_status" IN ('NOT_REQUIRED', 'APPROVED')
      AND attendance."clock_out_at" IS NOT NULL
      AND attendance."clock_out_at" > attendance."clock_in_at"
      THEN 'RESOLVED'::"AttendanceResolutionCaseStatus"
    ELSE 'OPEN'::"AttendanceResolutionCaseStatus"
  END,
  CASE
    WHEN attendance."status" = 'INCOMPLETE' THEN 'INCOMPLETE_SESSION'::"AttendanceResolutionReason"
    WHEN attendance."status" = 'COMPLETED'
      AND (
        attendance."clock_out_at" IS NULL
        OR attendance."clock_out_at" <= attendance."clock_in_at"
      )
      THEN 'INCOMPLETE_SESSION'::"AttendanceResolutionReason"
    WHEN attendance."status" = 'CANCELLED' THEN 'CANCELLED_SESSION'::"AttendanceResolutionReason"
    WHEN attendance."approval_status" = 'PENDING' THEN 'APPROVAL_PENDING'::"AttendanceResolutionReason"
    WHEN attendance."approval_status" = 'REJECTED' THEN 'APPROVAL_REJECTED'::"AttendanceResolutionReason"
    ELSE 'LEGACY_COMPLETED'::"AttendanceResolutionReason"
  END,
  attendance."created_at",
  CASE
    WHEN attendance."status" = 'CANCELLED' THEN attendance."updated_at"
    WHEN attendance."status" = 'COMPLETED'
      AND attendance."approval_status" IN ('NOT_REQUIRED', 'APPROVED')
      AND attendance."clock_out_at" IS NOT NULL
      AND attendance."clock_out_at" > attendance."clock_in_at"
      THEN attendance."updated_at"
    ELSE NULL
  END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "employee_attendance" attendance
WHERE attendance."status" IN ('COMPLETED', 'INCOMPLETE', 'CANCELLED')
ON CONFLICT ("attendance_session_id") DO NOTHING;

INSERT INTO "attendance_final_results" (
  "id",
  "business_id",
  "branch_id",
  "attendance_session_id",
  "resolution_case_id",
  "employee_id",
  "version",
  "disposition",
  "source",
  "work_date",
  "clock_in_at",
  "clock_out_at",
  "total_break_minutes",
  "total_worked_minutes",
  "break_policy_snapshot",
  "expected_break_minutes",
  "confirmed_break_minutes",
  "approval_status_snapshot",
  "session_updated_at_snapshot",
  "evidence_checksum",
  "created_at"
)
SELECT
  gen_random_uuid(),
  attendance."business_id",
  attendance."branch_id",
  attendance."id",
  resolution_case."id",
  attendance."membership_id",
  1,
  CASE
    WHEN attendance."status" = 'CANCELLED' THEN 'EXCLUDED'::"AttendanceFinalResultDisposition"
    ELSE 'INCLUDED'::"AttendanceFinalResultDisposition"
  END,
  'LEGACY_BACKFILL'::"AttendanceFinalResultSource",
  attendance."work_date",
  attendance."clock_in_at",
  attendance."clock_out_at",
  GREATEST(attendance."total_break_minutes", 0),
  GREATEST(attendance."total_worked_minutes", 0),
  attendance."break_policy_snapshot",
  GREATEST(attendance."expected_break_minutes", 0),
  attendance."confirmed_break_minutes",
  attendance."approval_status",
  attendance."updated_at",
  encode(
    public.digest(
      concat_ws(
        '|',
        attendance."id"::text,
        attendance."business_id"::text,
        attendance."branch_id"::text,
        attendance."membership_id"::text,
        attendance."work_date"::text,
        attendance."clock_in_at"::text,
        COALESCE(attendance."clock_out_at"::text, ''),
        attendance."total_break_minutes"::text,
        attendance."total_worked_minutes"::text,
        attendance."break_policy_snapshot"::text,
        attendance."expected_break_minutes"::text,
        COALESCE(attendance."confirmed_break_minutes"::text, ''),
        attendance."approval_status"::text,
        attendance."updated_at"::text,
        CASE WHEN attendance."status" = 'CANCELLED' THEN 'EXCLUDED' ELSE 'INCLUDED' END,
        'LEGACY_BACKFILL'
      ),
      'sha256'
    ),
    'hex'
  ),
  attendance."updated_at"
FROM "employee_attendance" attendance
INNER JOIN "attendance_resolution_cases" resolution_case
  ON resolution_case."attendance_session_id" = attendance."id"
LEFT JOIN "attendance_final_results" existing_result
  ON existing_result."resolution_case_id" = resolution_case."id"
WHERE existing_result."id" IS NULL
  AND (
    attendance."status" = 'CANCELLED'
    OR (
      attendance."status" = 'COMPLETED'
      AND attendance."approval_status" IN ('NOT_REQUIRED', 'APPROVED')
      AND attendance."clock_out_at" IS NOT NULL
      AND attendance."clock_out_at" > attendance."clock_in_at"
    )
  );

UPDATE "attendance_resolution_cases" resolution_case
SET
  "current_final_result_id" = final_result."id",
  "status" = 'RESOLVED',
  "resolved_at" = COALESCE(resolution_case."resolved_at", final_result."created_at"),
  "updated_at" = CURRENT_TIMESTAMP
FROM "attendance_final_results" final_result
WHERE final_result."resolution_case_id" = resolution_case."id"
  AND final_result."version" = 1
  AND resolution_case."current_final_result_id" IS NULL;

COMMENT ON TABLE "attendance_resolution_cases" IS
  'Operational resolution state for one Attendance Session. Cases are retained and cannot be deleted.';
COMMENT ON TABLE "attendance_final_results" IS
  'Immutable versioned Final Attendance Results. Payroll is not connected during Attendance Phase A1.';

COMMIT;
