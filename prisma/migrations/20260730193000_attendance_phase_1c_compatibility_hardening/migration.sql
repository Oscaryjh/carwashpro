BEGIN;

-- Compatibility hardening for databases that applied an earlier Phase 1C
-- draft. This migration is also safe after the final Phase 1C migration.
ALTER TABLE "employee_otp_challenges"
    ALTER COLUMN "created_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "employee_devices"
    ALTER COLUMN "first_verified_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "last_active_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "created_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "employee_sessions"
    ALTER COLUMN "last_active_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    ALTER COLUMN "created_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "attendance_request_idempotency"
    ALTER COLUMN "created_at"
    SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

-- Phase 1C promotes terminal Punch linkage to a commit-time database
-- invariant. The deferred checks preserve the legitimate write order used by
-- Clock In/Out transactions: create Session/Punch first, then attach the
-- terminal Punch to the Session before commit.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "attendance_punches" punch
        LEFT JOIN "employee_attendance" session
          ON session."id" = punch."attendance_session_id"
         AND session."business_id" = punch."business_id"
         AND session."branch_id" = punch."branch_id"
         AND session."membership_id" = punch."employee_id"
        WHERE punch."type" IN ('CLOCK_IN', 'CLOCK_OUT')
          AND (
              punch."attendance_session_id" IS NULL
              OR session."id" IS NULL
              OR (
                  punch."type" = 'CLOCK_IN'
                  AND session."clock_in_punch_id" IS DISTINCT FROM punch."id"
              )
              OR (
                  punch."type" = 'CLOCK_OUT'
                  AND session."clock_out_punch_id" IS DISTINCT FROM punch."id"
              )
          )
    ) THEN
        RAISE EXCEPTION
            'Existing terminal Attendance Punch linkage is invalid';
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION "enforce_attendance_terminal_punch_link"()
RETURNS trigger AS $$
BEGIN
    IF NEW."type" NOT IN ('CLOCK_IN', 'CLOCK_OUT') THEN
        RETURN NEW;
    END IF;

    IF NEW."attendance_session_id" IS NULL THEN
        RAISE EXCEPTION
            'Terminal Attendance Punch requires an Attendance Session';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "employee_attendance" session
        WHERE session."id" = NEW."attendance_session_id"
          AND session."business_id" = NEW."business_id"
          AND session."branch_id" = NEW."branch_id"
          AND session."membership_id" = NEW."employee_id"
          AND (
              (
                  NEW."type" = 'CLOCK_IN'
                  AND session."clock_in_punch_id" = NEW."id"
              )
              OR (
                  NEW."type" = 'CLOCK_OUT'
                  AND session."clock_out_punch_id" = NEW."id"
              )
          )
    ) THEN
        RAISE EXCEPTION
            'Terminal Attendance Punch is not linked by its Attendance Session';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "attendance_terminal_punch_link_guard"
    ON "attendance_punches";
CREATE CONSTRAINT TRIGGER "attendance_terminal_punch_link_guard"
    AFTER INSERT OR UPDATE ON "attendance_punches"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_terminal_punch_link"();

CREATE OR REPLACE FUNCTION "enforce_attendance_session_terminal_links"()
RETURNS trigger AS $$
DECLARE
    current_session "employee_attendance"%ROWTYPE;
BEGIN
    SELECT *
      INTO current_session
      FROM "employee_attendance"
     WHERE "id" = NEW."id";

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF current_session."clock_in_punch_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "attendance_punches" punch
           WHERE punch."id" = current_session."clock_in_punch_id"
             AND punch."attendance_session_id" = current_session."id"
             AND punch."business_id" = current_session."business_id"
             AND punch."branch_id" = current_session."branch_id"
             AND punch."employee_id" = current_session."membership_id"
             AND punch."type" = 'CLOCK_IN'
       ) THEN
        RAISE EXCEPTION
            'Attendance Session clock-in Punch linkage is invalid';
    END IF;

    IF current_session."clock_out_punch_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "attendance_punches" punch
           WHERE punch."id" = current_session."clock_out_punch_id"
             AND punch."attendance_session_id" = current_session."id"
             AND punch."business_id" = current_session."business_id"
             AND punch."branch_id" = current_session."branch_id"
             AND punch."employee_id" = current_session."membership_id"
             AND punch."type" = 'CLOCK_OUT'
       ) THEN
        RAISE EXCEPTION
            'Attendance Session clock-out Punch linkage is invalid';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "attendance_punches" punch
        WHERE punch."attendance_session_id" = current_session."id"
          AND punch."type" = 'CLOCK_IN'
          AND current_session."clock_in_punch_id" IS DISTINCT FROM punch."id"
    ) THEN
        RAISE EXCEPTION
            'Attendance Session must retain its linked clock-in Punch';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "attendance_punches" punch
        WHERE punch."attendance_session_id" = current_session."id"
          AND punch."type" = 'CLOCK_OUT'
          AND current_session."clock_out_punch_id" IS DISTINCT FROM punch."id"
    ) THEN
        RAISE EXCEPTION
            'Attendance Session must retain its linked clock-out Punch';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "attendance_session_terminal_link_guard"
    ON "employee_attendance";
CREATE CONSTRAINT TRIGGER "attendance_session_terminal_link_guard"
    AFTER INSERT OR UPDATE ON "employee_attendance"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_session_terminal_links"();

-- Replacing these functions updates the already-installed triggers in place.
-- All Prisma DateTime columns are TIMESTAMP WITHOUT TIME ZONE, so database
-- runtime clocks must use a UTC wall-clock value regardless of connection TZ.
CREATE OR REPLACE FUNCTION "invalidate_previous_employee_otp_challenges"()
RETURNS trigger AS $$
BEGIN
    -- Serialize every replacement challenge for the same phone. LOGIN and
    -- REGISTER_DEVICE challenges must never remain usable at the same time.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            NEW."phone_number_normalized",
            0
        )
    );

    UPDATE "employee_otp_challenges"
       SET "invalidated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     WHERE "phone_number_normalized" = NEW."phone_number_normalized"
       AND "invalidated_at" IS NULL;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_employee_otp_challenge_lifecycle"()
RETURNS trigger AS $$
BEGIN
    IF NEW."employee_account_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_accounts"
           WHERE "id" = NEW."employee_account_id"
             AND "phone_normalized" = NEW."phone_number_normalized"
       ) THEN
        RAISE EXCEPTION
            'Employee OTP challenge account scope mismatch';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."attempts" <> 0
           OR NEW."verified_at" IS NOT NULL
           OR NEW."invalidated_at" IS NOT NULL THEN
            RAISE EXCEPTION
                'New Employee OTP challenge must be unused';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."employee_account_id" IS DISTINCT FROM OLD."employee_account_id"
       OR NEW."phone_number_normalized" IS DISTINCT FROM
          OLD."phone_number_normalized"
       OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
       OR NEW."otp_hash" IS DISTINCT FROM OLD."otp_hash"
       OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
       OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
       OR NEW."resend_available_at" IS DISTINCT FROM
          OLD."resend_available_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION
            'Employee OTP challenge identity is immutable';
    END IF;

    IF NEW."attempts" < OLD."attempts" THEN
        RAISE EXCEPTION
            'Employee OTP challenge attempts cannot decrease';
    END IF;

    IF OLD."verified_at" IS NOT NULL
       AND (
           NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
           OR NEW."attempts" IS DISTINCT FROM OLD."attempts"
       ) THEN
        RAISE EXCEPTION
            'Employee OTP challenge was already used';
    END IF;

    IF OLD."invalidated_at" IS NOT NULL
       AND (
           NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
           OR NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at"
           OR NEW."attempts" IS DISTINCT FROM OLD."attempts"
       ) THEN
        RAISE EXCEPTION
            'Employee OTP challenge was invalidated';
    END IF;

    IF NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
       AND (
           OLD."verified_at" IS NOT NULL
           OR OLD."invalidated_at" IS NOT NULL
           OR OLD."expires_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           OR OLD."attempts" >= OLD."max_attempts"
       ) THEN
        RAISE EXCEPTION
            'Employee OTP challenge cannot be verified';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_employee_session_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."membership_id"
          AND "employee_account_id" = NEW."employee_account_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee Session membership scope mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."primary_branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee Session branch scope mismatch';
    END IF;

    IF NEW."employee_device_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_devices"
           WHERE "id" = NEW."employee_device_id"
             AND "employee_account_id" = NEW."employee_account_id"
       ) THEN
        RAISE EXCEPTION 'Employee Session device scope mismatch';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
            SELECT 1
            FROM "employee_branch_assignments"
            WHERE "membership_id" = NEW."membership_id"
              AND "business_id" = NEW."business_id"
              AND "branch_id" = NEW."primary_branch_id"
              AND "status" = 'ACTIVE'
              AND "is_primary" = true
              AND "can_clock_in" = true
              AND "effective_from" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              AND (
                  "effective_until" IS NULL
                  OR "effective_until" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              )
        ) THEN
            RAISE EXCEPTION
                'Employee Session primary assignment is not active';
        END IF;

        IF NEW."employee_device_id" IS NOT NULL
           AND NOT EXISTS (
               SELECT 1
               FROM "employee_devices"
               WHERE "id" = NEW."employee_device_id"
                 AND "employee_account_id" = NEW."employee_account_id"
                 AND "status" = 'ACTIVE'
                 AND "can_view" = true
           ) THEN
            RAISE EXCEPTION
                'Employee Session device is not active';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW."employee_account_id" IS DISTINCT FROM
       OLD."employee_account_id"
       OR NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
       OR NEW."business_id" IS DISTINCT FROM OLD."business_id"
       OR NEW."primary_branch_id" IS DISTINCT FROM OLD."primary_branch_id"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'Employee Session tenant scope is immutable';
    END IF;

    IF OLD."employee_device_id" IS NOT NULL
       AND NEW."employee_device_id" IS DISTINCT FROM
           OLD."employee_device_id" THEN
        RAISE EXCEPTION 'Employee Session device is immutable once bound';
    END IF;

    IF OLD."employee_device_id" IS NULL
       AND NEW."employee_device_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_devices"
           WHERE "id" = NEW."employee_device_id"
             AND "employee_account_id" = NEW."employee_account_id"
             AND "status" = 'ACTIVE'
             AND "can_view" = true
       ) THEN
        RAISE EXCEPTION 'Employee Session device is not active';
    END IF;

    IF NEW."last_active_at" < OLD."last_active_at" THEN
        RAISE EXCEPTION 'Employee Session last active time cannot decrease';
    END IF;

    IF OLD."revoked_at" IS NOT NULL
       AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" THEN
        RAISE EXCEPTION 'Employee Session cannot be unrevoked';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "revoke_sessions_for_inactive_employee_device"()
RETURNS trigger AS $$
BEGIN
    IF OLD."status" = 'ACTIVE' AND NEW."status" <> 'ACTIVE' THEN
        UPDATE "employee_sessions"
           SET "revoked_at" = COALESCE("revoked_at", (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')),
               "revoke_reason" = COALESCE(
                   "revoke_reason",
                   'EMPLOYEE_DEVICE_' || NEW."status"::text
               )
         WHERE "employee_device_id" = NEW."id"
           AND "revoked_at" IS NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "enforce_attendance_idempotency_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."membership_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION
            'Attendance idempotency membership scope mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "employee_sessions"
        WHERE "id" = NEW."employee_session_id"
          AND "membership_id" = NEW."membership_id"
          AND "business_id" = NEW."business_id"
          AND "revoked_at" IS NULL
          AND "expires_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ) THEN
        RAISE EXCEPTION
            'Attendance idempotency Employee Session scope mismatch';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION
            'Attendance idempotency branch scope mismatch';
    END IF;

    IF NEW."attendance_session_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "employee_attendance"
           WHERE "id" = NEW."attendance_session_id"
             AND "membership_id" = NEW."membership_id"
             AND "business_id" = NEW."business_id"
             AND "branch_id" = NEW."branch_id"
       ) THEN
        RAISE EXCEPTION
            'Attendance idempotency result Session scope mismatch';
    END IF;

    IF NEW."attendance_punch_id" IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM "attendance_punches"
           WHERE "id" = NEW."attendance_punch_id"
             AND "employee_id" = NEW."membership_id"
             AND "business_id" = NEW."business_id"
             AND "branch_id" = NEW."branch_id"
             AND "attendance_session_id" = NEW."attendance_session_id"
             AND "type" = NEW."punch_type"
       ) THEN
        RAISE EXCEPTION
            'Attendance idempotency result Punch scope mismatch';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW."membership_id" IS DISTINCT FROM OLD."membership_id"
           OR NEW."employee_session_id" IS DISTINCT FROM
              OLD."employee_session_id"
           OR NEW."business_id" IS DISTINCT FROM OLD."business_id"
           OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
           OR NEW."idempotency_key" IS DISTINCT FROM
              OLD."idempotency_key"
           OR NEW."request_payload_hash" IS DISTINCT FROM
              OLD."request_payload_hash"
           OR NEW."punch_type" IS DISTINCT FROM OLD."punch_type"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION
                'Attendance idempotency request identity is immutable';
        END IF;

        IF OLD."status" = 'COMPLETED'
           AND (
               NEW."status" IS DISTINCT FROM OLD."status"
               OR NEW."attendance_session_id" IS DISTINCT FROM
                  OLD."attendance_session_id"
               OR NEW."attendance_punch_id" IS DISTINCT FROM
                  OLD."attendance_punch_id"
               OR NEW."completed_at" IS DISTINCT FROM OLD."completed_at"
           ) THEN
            RAISE EXCEPTION
                'Completed Attendance idempotency result is immutable';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
