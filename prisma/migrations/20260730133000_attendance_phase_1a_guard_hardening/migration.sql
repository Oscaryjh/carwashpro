BEGIN;

-- Refuse to harden a database that already contains cross-tenant legacy
-- assignments or sessions. This migration never guesses how to repair them.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "employee_branch_assignments" assignment
        WHERE NOT EXISTS (
            SELECT 1
            FROM "employee_business_memberships" membership
            WHERE membership."id" = assignment."membership_id"
              AND membership."business_id" = assignment."business_id"
        )
        OR NOT EXISTS (
            SELECT 1
            FROM "branches" branch
            WHERE branch."id" = assignment."branch_id"
              AND branch."business_id" = assignment."business_id"
        )
    ) THEN
        RAISE EXCEPTION
            'Legacy employee branch assignment tenant scope mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "employee_attendance" session
        WHERE NOT EXISTS (
            SELECT 1
            FROM "employee_business_memberships" membership
            WHERE membership."id" = session."membership_id"
              AND membership."employee_account_id" =
                  session."employee_account_id"
              AND membership."business_id" = session."business_id"
        )
        OR NOT EXISTS (
            SELECT 1
            FROM "branches" branch
            WHERE branch."id" = session."branch_id"
              AND branch."business_id" = session."business_id"
        )
    ) THEN
        RAISE EXCEPTION 'Legacy attendance session tenant scope mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "employee_attendance"
        WHERE "clock_in_punch_id" IS NOT NULL
          AND "clock_in_punch_id" = "clock_out_punch_id"
    ) THEN
        RAISE EXCEPTION
            'Attendance session uses the same clock-in and clock-out punch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "employee_attendance" session
        WHERE session."clock_in_punch_id" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "attendance_punches" punch
              WHERE punch."id" = session."clock_in_punch_id"
                AND punch."business_id" = session."business_id"
                AND punch."branch_id" = session."branch_id"
                AND punch."employee_id" = session."membership_id"
                AND punch."type" = 'CLOCK_IN'
                AND (
                    punch."attendance_session_id" IS NULL
                    OR punch."attendance_session_id" = session."id"
                )
          )
    ) THEN
        RAISE EXCEPTION
            'Legacy attendance clock-in punch ownership or type mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "employee_attendance" session
        WHERE session."clock_out_punch_id" IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM "attendance_punches" punch
              WHERE punch."id" = session."clock_out_punch_id"
                AND punch."business_id" = session."business_id"
                AND punch."branch_id" = session."branch_id"
                AND punch."employee_id" = session."membership_id"
                AND punch."type" = 'CLOCK_OUT'
                AND punch."attendance_session_id" = session."id"
          )
    ) THEN
        RAISE EXCEPTION
            'Legacy attendance clock-out punch ownership or type mismatch';
    END IF;
END
$$;

ALTER TABLE "employee_attendance"
    ADD CONSTRAINT "employee_attendance_distinct_terminal_punches_check"
    CHECK (
        "clock_in_punch_id" IS NULL
        OR "clock_out_punch_id" IS NULL
        OR "clock_in_punch_id" <> "clock_out_punch_id"
    );

-- Admin actors must be active and either platform-wide, authorized for the
-- same business and branch, or covered by an active group grant.
CREATE FUNCTION "has_attendance_actor_scope"(
    actor_id UUID,
    target_business_id UUID,
    target_branch_id UUID
)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM "users" actor
        WHERE actor."id" = actor_id
          AND actor."status" = 'active'
          AND actor."login_enabled" = true
          AND (
              actor."role" = 'PLATFORM_ADMIN'
              OR (
                  actor."business_id" = target_business_id
                  AND (
                      actor."branch_id" IS NULL
                      OR actor."branch_id" = target_branch_id
                      OR 'ALL_BRANCHES' = ANY(actor."permissions")
                  )
              )
              OR EXISTS (
                  SELECT 1
                  FROM "business_group_users" group_user
                  JOIN "business_groups" business_group
                    ON business_group."id" = group_user."group_id"
                   AND business_group."status" = 'ACTIVE'
                  JOIN "business_group_members" group_member
                    ON group_member."group_id" = group_user."group_id"
                   AND group_member."business_id" = target_business_id
                   AND group_member."status" = 'ACTIVE'
                  WHERE group_user."user_id" = actor."id"
                    AND group_user."status" = 'ACTIVE'
                    AND (
                        group_user."role" = 'GROUP_OWNER'
                        OR (
                            group_user."role" = 'GROUP_MANAGER'
                            AND group_user."access_scope" =
                                'SELECTED_BUSINESSES'
                            AND EXISTS (
                                SELECT 1
                                FROM
                                    "business_group_user_business_access"
                                    group_business_access
                                WHERE
                                    group_business_access."group_user_id" =
                                        group_user."id"
                                    AND
                                    group_business_access."business_id" =
                                        target_business_id
                            )
                        )
                    )
              )
          )
    );
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "attendance_exceptions" exception
        WHERE exception."status" IN ('APPROVED', 'REJECTED')
          AND exception."reviewed_by" IS NULL
    ) THEN
        RAISE EXCEPTION
            'Reviewed attendance exception is missing its reviewer';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "attendance_exceptions" exception
        WHERE exception."reviewed_by" IS NOT NULL
          AND NOT "has_attendance_actor_scope"(
              exception."reviewed_by",
              exception."business_id",
              exception."branch_id"
          )
    ) THEN
        RAISE EXCEPTION
            'Legacy attendance exception reviewer scope mismatch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "attendance_adjustments" adjustment
        WHERE NOT "has_attendance_actor_scope"(
            adjustment."adjusted_by",
            adjustment."business_id",
            adjustment."branch_id"
        )
    ) THEN
        RAISE EXCEPTION
            'Legacy attendance adjustment actor scope mismatch';
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION "enforce_attendance_session_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."membership_id"
          AND "employee_account_id" = NEW."employee_account_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance session employee scope mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance session branch scope mismatch';
    END IF;

    IF NEW."clock_in_punch_id" IS NOT NULL
       AND NEW."clock_in_punch_id" = NEW."clock_out_punch_id" THEN
        RAISE EXCEPTION
            'Attendance session terminal punches must be different';
    END IF;

    IF NEW."clock_in_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "attendance_punches" punch
        WHERE punch."id" = NEW."clock_in_punch_id"
          AND punch."business_id" = NEW."business_id"
          AND punch."branch_id" = NEW."branch_id"
          AND punch."employee_id" = NEW."membership_id"
          AND punch."type" = 'CLOCK_IN'
          AND (
              punch."attendance_session_id" IS NULL
              OR punch."attendance_session_id" = NEW."id"
          )
    ) THEN
        RAISE EXCEPTION
            'Attendance session clock-in punch ownership or type mismatch';
    END IF;

    IF NEW."clock_out_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "attendance_punches" punch
        WHERE punch."id" = NEW."clock_out_punch_id"
          AND punch."business_id" = NEW."business_id"
          AND punch."branch_id" = NEW."branch_id"
          AND punch."employee_id" = NEW."membership_id"
          AND punch."type" = 'CLOCK_OUT'
          AND punch."attendance_session_id" = NEW."id"
    ) THEN
        RAISE EXCEPTION
            'Attendance session clock-out punch ownership or type mismatch';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_attendance_exception_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."employee_id"
          AND "business_id" = NEW."business_id"
    ) OR NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception tenant scope mismatch';
    END IF;

    IF NEW."attendance_session_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "employee_attendance"
        WHERE "id" = NEW."attendance_session_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "membership_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception session scope mismatch';
    END IF;

    IF NEW."attendance_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM "attendance_punches"
        WHERE "id" = NEW."attendance_punch_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "employee_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception punch scope mismatch';
    END IF;

    IF NEW."attendance_session_id" IS NOT NULL
       AND NEW."attendance_punch_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_attendance" session
           JOIN "attendance_punches" punch
             ON punch."id" = NEW."attendance_punch_id"
           WHERE session."id" = NEW."attendance_session_id"
             AND (
                 punch."attendance_session_id" = session."id"
                 OR session."clock_in_punch_id" = punch."id"
                 OR session."clock_out_punch_id" = punch."id"
             )
       ) THEN
        RAISE EXCEPTION
            'Attendance exception punch does not belong to its session';
    END IF;

    IF NEW."status" IN ('APPROVED', 'REJECTED')
       AND NEW."reviewed_by" IS NULL THEN
        RAISE EXCEPTION
            'Reviewed attendance exception requires a reviewer';
    END IF;

    IF NEW."reviewed_by" IS NOT NULL
       AND NOT "has_attendance_actor_scope"(
           NEW."reviewed_by",
           NEW."business_id",
           NEW."branch_id"
       ) THEN
        RAISE EXCEPTION
            'Attendance exception reviewer scope mismatch';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_attendance_adjustment_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_attendance"
        WHERE "id" = NEW."attendance_session_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "membership_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance adjustment session scope mismatch';
    END IF;

    IF NOT "has_attendance_actor_scope"(
        NEW."adjusted_by",
        NEW."business_id",
        NEW."branch_id"
    ) THEN
        RAISE EXCEPTION 'Attendance adjustment actor scope mismatch';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tenant ownership keys become immutable once attendance children exist.
CREATE FUNCTION "prevent_attendance_branch_tenant_key_mutation"()
RETURNS trigger AS $$
BEGIN
    IF NEW."business_id" IS DISTINCT FROM OLD."business_id"
       AND EXISTS (
           SELECT 1
           FROM "employee_branch_assignments"
           WHERE "branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "employee_attendance"
           WHERE "branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "branch_attendance_settings"
           WHERE "branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_punches"
           WHERE "branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_exceptions"
           WHERE "branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_adjustments"
           WHERE "branch_id" = OLD."id"
       ) THEN
        RAISE EXCEPTION
            'Branch business cannot change after attendance data exists';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "prevent_attendance_membership_tenant_key_mutation"()
RETURNS trigger AS $$
BEGIN
    IF (
        NEW."business_id" IS DISTINCT FROM OLD."business_id"
        OR NEW."employee_account_id" IS DISTINCT FROM
            OLD."employee_account_id"
    ) AND EXISTS (
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

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branches_attendance_tenant_key_guard"
    BEFORE UPDATE OF "business_id" ON "branches"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_attendance_branch_tenant_key_mutation"();

CREATE TRIGGER "employee_memberships_attendance_tenant_key_guard"
    BEFORE UPDATE OF "business_id", "employee_account_id"
    ON "employee_business_memberships"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_attendance_membership_tenant_key_mutation"();

-- Row-level DELETE triggers do not fire for TRUNCATE.
CREATE TRIGGER "attendance_punches_immutable_truncate_guard"
    BEFORE TRUNCATE ON "attendance_punches"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "prevent_attendance_punch_mutation"();

-- TRUNCATE bypasses row-level constraint triggers. Reject it whenever the
-- deferred primary-assignment invariant is active for at least one employee.
CREATE FUNCTION "prevent_attendance_assignment_truncate"()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "attendance_enabled" = true
    ) THEN
        RAISE EXCEPTION
            'Employee assignments cannot be truncated while Attendance is enabled';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_branch_assignments_truncate_guard"
    BEFORE TRUNCATE ON "employee_branch_assignments"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "prevent_attendance_assignment_truncate"();

-- Phase 1A backfilled attendance_enabled=false, so legacy memberships without
-- assignments remain compatible. Once Attendance is enabled, exactly one
-- ACTIVE primary assignment is mandatory at transaction commit.
DO $$
BEGIN
    IF EXISTS (
        SELECT membership."id"
        FROM "employee_business_memberships" membership
        LEFT JOIN "employee_branch_assignments" assignment
          ON assignment."membership_id" = membership."id"
         AND assignment."status" = 'ACTIVE'
         AND assignment."is_primary" = true
        WHERE membership."attendance_enabled" = true
        GROUP BY membership."id"
        HAVING count(assignment."id") <> 1
    ) THEN
        RAISE EXCEPTION
            'Attendance-enabled employee lacks exactly one active primary assignment';
    END IF;
END
$$;

CREATE FUNCTION "assert_attendance_primary_assignment"(
    target_membership_id UUID
)
RETURNS void AS $$
DECLARE
    active_primary_count INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = target_membership_id
          AND "attendance_enabled" = true
    ) THEN
        RETURN;
    END IF;

    SELECT count(*)::INTEGER
    INTO active_primary_count
    FROM "employee_branch_assignments"
    WHERE "membership_id" = target_membership_id
      AND "status" = 'ACTIVE'
      AND "is_primary" = true;

    IF active_primary_count <> 1 THEN
        RAISE EXCEPTION
            'Attendance-enabled employee must have exactly one active primary assignment';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_attendance_primary_assignment"()
RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'employee_business_memberships' THEN
        PERFORM "assert_attendance_primary_assignment"(NEW."id");
        RETURN NULL;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM "assert_attendance_primary_assignment"(
            OLD."membership_id"
        );
    END IF;

    IF TG_OP = 'INSERT' THEN
        PERFORM "assert_attendance_primary_assignment"(
            NEW."membership_id"
        );
    ELSIF TG_OP = 'UPDATE'
       AND NEW."membership_id" IS DISTINCT FROM OLD."membership_id" THEN
        PERFORM "assert_attendance_primary_assignment"(
            NEW."membership_id"
        );
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
    "employee_memberships_active_primary_assignment_guard"
    AFTER INSERT OR UPDATE ON "employee_business_memberships"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_primary_assignment"();

CREATE CONSTRAINT TRIGGER
    "employee_branch_assignments_active_primary_guard"
    AFTER INSERT OR UPDATE OR DELETE ON "employee_branch_assignments"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_primary_assignment"();

COMMIT;
