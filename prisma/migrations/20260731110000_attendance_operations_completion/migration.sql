BEGIN;

-- Retain structured employee-requested times without changing immutable punches.
ALTER TABLE "attendance_exceptions"
    ADD COLUMN "requested_clock_in_at" TIMESTAMP(3),
    ADD COLUMN "requested_clock_out_at" TIMESTAMP(3);

COMMENT ON COLUMN "attendance_exceptions"."requested_clock_in_at" IS 'Employee-requested clock-in time for manager review.';
COMMENT ON COLUMN "attendance_exceptions"."requested_clock_out_at" IS 'Employee-requested clock-out time for manager review.';

-- Keep the immutable primary branch as identity scope while allowing a verified
-- employee session to choose another currently authorized Attendance branch.
ALTER TABLE "employee_sessions"
    ADD COLUMN "attendance_branch_id" UUID;

UPDATE "employee_sessions"
SET "attendance_branch_id" = "primary_branch_id"
WHERE "attendance_branch_id" IS NULL;

ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_attendance_branch_id_fkey"
      FOREIGN KEY ("attendance_branch_id")
      REFERENCES "branches"("id")
      ON DELETE RESTRICT
      ON UPDATE CASCADE;

CREATE INDEX "employee_sessions_business_attendance_branch_idx"
    ON "employee_sessions"("business_id", "attendance_branch_id");

CREATE FUNCTION "validate_employee_session_attendance_branch_scope"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."attendance_branch_id" IS NULL THEN
        NEW."attendance_branch_id" := NEW."primary_branch_id";
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches" b
        WHERE b."id" = NEW."attendance_branch_id"
          AND b."business_id" = NEW."business_id"
          AND b."status" = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Employee Session Attendance branch is outside tenant scope';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "employee_branch_assignments" a
        WHERE a."membership_id" = NEW."membership_id"
          AND a."business_id" = NEW."business_id"
          AND a."branch_id" = NEW."attendance_branch_id"
          AND a."status" = 'ACTIVE'
          AND a."can_clock_in" = TRUE
          AND a."effective_from" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          AND (
              a."effective_until" IS NULL
              OR a."effective_until" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          )
    ) THEN
        RAISE EXCEPTION 'Employee Session Attendance branch assignment is not active';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_sessions_attendance_branch_insert_guard"
BEFORE INSERT ON "employee_sessions"
FOR EACH ROW
EXECUTE FUNCTION "validate_employee_session_attendance_branch_scope"();

CREATE TRIGGER "employee_sessions_attendance_branch_update_guard"
BEFORE UPDATE OF "attendance_branch_id", "membership_id", "business_id"
ON "employee_sessions"
FOR EACH ROW
EXECUTE FUNCTION "validate_employee_session_attendance_branch_scope"();

COMMIT;