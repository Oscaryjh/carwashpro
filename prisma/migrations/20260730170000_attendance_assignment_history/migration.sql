BEGIN;

-- Phase 1A allowed only one lifetime assignment per employee and branch.
-- Phase 1B keeps each completed assignment period and permits a later
-- re-assignment without deleting or overwriting that history.
DROP INDEX IF EXISTS
    "employee_branch_assignments_membership_id_branch_id_key";

CREATE INDEX
    "employee_branch_assignments_membership_id_branch_id_idx"
    ON "employee_branch_assignments"("membership_id", "branch_id");

-- Multiple historical periods are allowed, but only one current assignment
-- for a given employee and branch can be active at a time.
CREATE UNIQUE INDEX
    "employee_branch_assignments_one_active_branch_key"
    ON "employee_branch_assignments"("membership_id", "branch_id")
    WHERE "status" = 'ACTIVE';

-- Keep the Business tenant key immutable as soon as Assignment history
-- exists. A phone edit may relink employee_account_id only before actual
-- Attendance records exist; Session/Punch history must always keep its
-- original identity relation.
CREATE OR REPLACE FUNCTION
    "prevent_attendance_membership_tenant_key_mutation"()
RETURNS trigger AS $$
BEGIN
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
       AND EXISTS (
           SELECT 1
           FROM "employee_branch_assignments"
           WHERE "membership_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "employee_attendance"
           WHERE "membership_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_punches"
           WHERE "employee_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_exceptions"
           WHERE "employee_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_adjustments"
           WHERE "employee_id" = OLD."id"
       ) THEN
        RAISE EXCEPTION
            'Employee membership tenant keys cannot change after attendance data exists';
    END IF;

    IF NEW."employee_account_id" IS DISTINCT FROM
           OLD."employee_account_id"
       AND EXISTS (
           SELECT 1
           FROM "employee_attendance"
           WHERE "membership_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_punches"
           WHERE "employee_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_exceptions"
           WHERE "employee_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_adjustments"
           WHERE "employee_id" = OLD."id"
       ) THEN
        RAISE EXCEPTION
            'Employee membership tenant keys cannot change after attendance data exists';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
