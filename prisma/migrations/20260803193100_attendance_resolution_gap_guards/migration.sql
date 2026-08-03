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

ALTER TABLE "attendance_resolution_events"
  DROP CONSTRAINT "attendance_resolution_events_actor_check";

ALTER TABLE "attendance_resolution_events"
  ADD CONSTRAINT "attendance_resolution_events_actor_check" CHECK (
    (
      "actor_type" = 'EMPLOYEE'
      AND "actor_user_id" IS NULL
      AND "actor_employee_session_id" IS NOT NULL
      AND "type" IN ('EMPLOYEE_SUBMITTED', 'EMPLOYEE_CANCELLED')
    )
    OR (
      "actor_type" = 'MANAGER'
      AND "actor_user_id" IS NOT NULL
      AND "actor_employee_session_id" IS NULL
      AND "type" NOT IN ('EMPLOYEE_SUBMITTED', 'EMPLOYEE_CANCELLED')
    )
  );

CREATE OR REPLACE FUNCTION "prevent_attendance_adjustment_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Attendance Adjustments are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "attendance_adjustment_update_guard"
BEFORE UPDATE OR DELETE ON "attendance_adjustments"
FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_adjustment_mutation"();

CREATE TRIGGER "attendance_adjustment_truncate_guard"
BEFORE TRUNCATE ON "attendance_adjustments"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_attendance_adjustment_mutation"();

COMMENT ON TABLE "attendance_adjustments" IS
  'Append-only manager corrections. Historical adjustments cannot be updated, deleted, or truncated.';
