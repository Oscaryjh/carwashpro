BEGIN;

CREATE TYPE "AttendanceResolutionEventType" AS ENUM (
  'EMPLOYEE_SUBMITTED',
  'MANAGER_ACCEPTED_AS_RECORDED',
  'MANAGER_APPLIED_CORRECTION',
  'MANAGER_RETURNED',
  'MANAGER_EXCLUDED'
);

CREATE TYPE "AttendanceResolutionActorType" AS ENUM (
  'EMPLOYEE',
  'MANAGER'
);

CREATE TABLE "attendance_resolution_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "resolution_case_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "AttendanceResolutionEventType" NOT NULL,
  "actor_type" "AttendanceResolutionActorType" NOT NULL,
  "actor_user_id" UUID,
  "actor_employee_session_id" UUID,
  "reason" TEXT NOT NULL,
  "proposed_clock_in_at" TIMESTAMP(3),
  "proposed_clock_out_at" TIMESTAMP(3),
  "proposed_break_minutes" INTEGER,
  "final_result_id" UUID,
  "evidence_checksum" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attendance_resolution_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_resolution_events_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "attendance_resolution_events_break_check" CHECK (
    "proposed_break_minutes" IS NULL OR "proposed_break_minutes" >= 0
  ),
  CONSTRAINT "attendance_resolution_events_checksum_check" CHECK (
    "evidence_checksum" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "attendance_resolution_events_actor_check" CHECK (
    (
      "actor_type" = 'EMPLOYEE'
      AND "actor_user_id" IS NULL
      AND "actor_employee_session_id" IS NOT NULL
      AND "type" = 'EMPLOYEE_SUBMITTED'
    )
    OR (
      "actor_type" = 'MANAGER'
      AND "actor_user_id" IS NOT NULL
      AND "actor_employee_session_id" IS NULL
      AND "type" <> 'EMPLOYEE_SUBMITTED'
    )
  )
);

CREATE UNIQUE INDEX "attendance_resolution_events_final_result_id_key"
  ON "attendance_resolution_events"("final_result_id");
CREATE UNIQUE INDEX "attendance_resolution_events_case_sequence_key"
  ON "attendance_resolution_events"("resolution_case_id", "sequence");
CREATE INDEX "attendance_resolution_events_business_branch_created_idx"
  ON "attendance_resolution_events"("business_id", "branch_id", "created_at");
CREATE INDEX "attendance_resolution_events_employee_created_idx"
  ON "attendance_resolution_events"("employee_id", "created_at");

ALTER TABLE "attendance_resolution_events"
  ADD CONSTRAINT "attendance_resolution_events_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_resolution_case_id_fkey"
    FOREIGN KEY ("resolution_case_id") REFERENCES "attendance_resolution_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_employee_id_business_id_fkey"
    FOREIGN KEY ("employee_id", "business_id") REFERENCES "employee_business_memberships"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_actor_employee_session_id_fkey"
    FOREIGN KEY ("actor_employee_session_id") REFERENCES "employee_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "attendance_resolution_events_final_result_id_fkey"
    FOREIGN KEY ("final_result_id") REFERENCES "attendance_final_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_attendance_resolution_event_insert"()
RETURNS TRIGGER AS $$
DECLARE
  case_row RECORD;
  result_case_id UUID;
  employee_session_row RECORD;
  expected_sequence INTEGER;
BEGIN
  SELECT "business_id", "branch_id", "employee_id"
  INTO case_row
  FROM "attendance_resolution_cases"
  WHERE "id" = NEW."resolution_case_id"
  FOR UPDATE;

  IF case_row IS NULL
    OR case_row."business_id" <> NEW."business_id"
    OR case_row."branch_id" <> NEW."branch_id"
    OR case_row."employee_id" <> NEW."employee_id"
  THEN
    RAISE EXCEPTION 'Attendance Resolution Event scope does not match its Case';
  END IF;

  SELECT COALESCE(MAX("sequence"), 0) + 1
  INTO expected_sequence
  FROM "attendance_resolution_events"
  WHERE "resolution_case_id" = NEW."resolution_case_id";

  IF NEW."sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'Attendance Resolution Event sequence must be the next sequence';
  END IF;

  IF NEW."actor_employee_session_id" IS NOT NULL THEN
    SELECT "business_id", "membership_id"
    INTO employee_session_row
    FROM "employee_sessions"
    WHERE "id" = NEW."actor_employee_session_id";

    IF employee_session_row IS NULL
      OR employee_session_row."business_id" <> NEW."business_id"
      OR employee_session_row."membership_id" <> NEW."employee_id"
    THEN
      RAISE EXCEPTION 'Employee Resolution Event actor does not own this Case';
    END IF;
  END IF;

  IF NEW."final_result_id" IS NOT NULL THEN
    SELECT "resolution_case_id"
    INTO result_case_id
    FROM "attendance_final_results"
    WHERE "id" = NEW."final_result_id";

    IF result_case_id IS NULL OR result_case_id <> NEW."resolution_case_id" THEN
      RAISE EXCEPTION 'Attendance Resolution Event result does not belong to this Case';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_resolution_event_insert_guard"
BEFORE INSERT ON "attendance_resolution_events"
FOR EACH ROW EXECUTE FUNCTION "guard_attendance_resolution_event_insert"();

CREATE OR REPLACE FUNCTION "prevent_attendance_resolution_event_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance Resolution Events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_resolution_event_update_guard"
BEFORE UPDATE OR DELETE ON "attendance_resolution_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_resolution_event_mutation"();

CREATE TRIGGER "attendance_resolution_event_truncate_guard"
BEFORE TRUNCATE ON "attendance_resolution_events"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_attendance_resolution_event_mutation"();

COMMENT ON TABLE "attendance_resolution_events" IS
  'Append-only employee submissions and manager decisions for Attendance Resolution Cases.';

-- Existing pending exception requests already contain an employee explanation,
-- so they enter manager review. Rejected legacy exceptions require a new response.
UPDATE "attendance_resolution_cases" resolution_case
SET "status" = 'UNDER_REVIEW', "updated_at" = CURRENT_TIMESTAMP
FROM "employee_attendance" attendance
WHERE resolution_case."attendance_session_id" = attendance."id"
  AND resolution_case."status" = 'OPEN'
  AND attendance."approval_status" = 'PENDING'
  AND EXISTS (
    SELECT 1
    FROM "attendance_exceptions" exception
    WHERE exception."attendance_session_id" = attendance."id"
      AND exception."status" = 'PENDING'
  );

UPDATE "attendance_resolution_cases" resolution_case
SET "status" = 'RETURNED_FOR_CORRECTION', "updated_at" = CURRENT_TIMESTAMP
FROM "employee_attendance" attendance
WHERE resolution_case."attendance_session_id" = attendance."id"
  AND resolution_case."status" IN ('OPEN', 'UNDER_REVIEW')
  AND attendance."approval_status" = 'REJECTED';

COMMIT;
