BEGIN;

-- Phase 1C adds employee authentication and request-concurrency primitives.
-- Existing Attendance rows are not rewritten or deleted.
CREATE TYPE "EmployeeOtpPurpose" AS ENUM ('LOGIN', 'REGISTER_DEVICE');
CREATE TYPE "EmployeeDeviceStatus" AS ENUM ('ACTIVE', 'REVOKED', 'REPLACED');
CREATE TYPE "AttendanceRequestStatus" AS ENUM ('PROCESSING', 'COMPLETED');

CREATE TABLE "employee_otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_account_id" UUID,
    "phone_number_normalized" TEXT NOT NULL,
    "purpose" "EmployeeOtpPurpose" NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "resend_available_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "ip_address_hash" TEXT,
    "device_fingerprint_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT "employee_otp_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_otp_challenges_attempts_check"
        CHECK (
            "max_attempts" > 0
            AND "attempts" >= 0
            AND "attempts" <= "max_attempts"
        ),
    CONSTRAINT "employee_otp_challenges_phone_check"
        CHECK (
            "phone_number_normalized" ~ '^\+[1-9][0-9]{7,14}$'
        ),
    CONSTRAINT "employee_otp_challenges_hash_check"
        CHECK (char_length("otp_hash") >= 32),
    CONSTRAINT "employee_otp_challenges_time_check"
        CHECK (
            "expires_at" > "created_at"
            AND "resend_available_at" >= "created_at"
            AND (
                "verified_at" IS NULL
                OR (
                    "verified_at" >= "created_at"
                    AND "verified_at" <= "expires_at"
                )
            )
            AND (
                "invalidated_at" IS NULL
                OR "invalidated_at" >= COALESCE(
                    "verified_at",
                    "created_at"
                )
            )
        )
);

CREATE TABLE "employee_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_account_id" UUID NOT NULL,
    "device_identifier_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "platform" TEXT,
    "browser" TEXT,
    "first_verified_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "status" "EmployeeDeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "can_view" BOOLEAN NOT NULL DEFAULT true,
    "can_punch" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_devices_identifier_hash_check"
        CHECK (char_length("device_identifier_hash") >= 32),
    CONSTRAINT "employee_devices_activity_time_check"
        CHECK ("last_active_at" >= "first_verified_at"),
    CONSTRAINT "employee_devices_lifecycle_check"
        CHECK (
            (
                "status" = 'ACTIVE'
                AND "revoked_at" IS NULL
                AND "revoke_reason" IS NULL
            )
            OR (
                "status" IN ('REVOKED', 'REPLACED')
                AND "revoked_at" IS NOT NULL
                AND "can_view" = false
                AND "can_punch" = false
            )
        )
);

CREATE TABLE "employee_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employee_account_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "primary_branch_id" UUID NOT NULL,
    "employee_device_id" UUID,
    "refresh_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "ip_address_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),

    CONSTRAINT "employee_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_sessions_refresh_token_hash_check"
        CHECK (char_length("refresh_token_hash") >= 32),
    CONSTRAINT "employee_sessions_time_check"
        CHECK (
            "expires_at" > "created_at"
            AND "last_active_at" >= "created_at"
            AND (
                "revoked_at" IS NULL
                OR "revoked_at" >= "created_at"
            )
        )
);

CREATE TABLE "attendance_request_idempotency" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "membership_id" UUID NOT NULL,
    "employee_session_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_payload_hash" TEXT NOT NULL,
    "punch_type" "AttendancePunchType" NOT NULL,
    "status" "AttendanceRequestStatus" NOT NULL DEFAULT 'PROCESSING',
    "attendance_session_id" UUID,
    "attendance_punch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "attendance_request_idempotency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_request_idempotency_key_check"
        CHECK (
            char_length("idempotency_key") BETWEEN 1 AND 200
        ),
    CONSTRAINT "attendance_request_payload_hash_check"
        CHECK (char_length("request_payload_hash") >= 32),
    CONSTRAINT "attendance_request_idempotency_lifecycle_check"
        CHECK (
            (
                "status" = 'PROCESSING'
                AND "attendance_session_id" IS NULL
                AND "attendance_punch_id" IS NULL
                AND "completed_at" IS NULL
            )
            OR (
                "status" = 'COMPLETED'
                AND "attendance_session_id" IS NOT NULL
                AND "attendance_punch_id" IS NOT NULL
                AND "completed_at" IS NOT NULL
                AND "completed_at" >= "created_at"
            )
        )
);

CREATE INDEX "employee_otp_challenges_phone_purpose_created_idx"
    ON "employee_otp_challenges"(
        "phone_number_normalized",
        "purpose",
        "created_at"
    );
CREATE INDEX "employee_otp_challenges_account_created_idx"
    ON "employee_otp_challenges"("employee_account_id", "created_at");
CREATE INDEX "employee_otp_challenges_ip_created_idx"
    ON "employee_otp_challenges"("ip_address_hash", "created_at");
CREATE INDEX "employee_otp_challenges_device_created_idx"
    ON "employee_otp_challenges"("device_fingerprint_hash", "created_at");
CREATE INDEX "employee_otp_challenges_expires_at_idx"
    ON "employee_otp_challenges"("expires_at");

CREATE UNIQUE INDEX "employee_devices_account_identifier_key"
    ON "employee_devices"(
        "employee_account_id",
        "device_identifier_hash"
    );
CREATE INDEX "employee_devices_account_status_active_idx"
    ON "employee_devices"(
        "employee_account_id",
        "status",
        "last_active_at"
    );
CREATE UNIQUE INDEX "employee_devices_one_active_punch_device_key"
    ON "employee_devices"("employee_account_id")
    WHERE "status" = 'ACTIVE' AND "can_punch" = true;

CREATE UNIQUE INDEX "employee_sessions_refresh_token_hash_key"
    ON "employee_sessions"("refresh_token_hash");
CREATE INDEX "employee_sessions_account_active_idx"
    ON "employee_sessions"(
        "employee_account_id",
        "revoked_at",
        "expires_at"
    );
CREATE INDEX "employee_sessions_membership_active_idx"
    ON "employee_sessions"(
        "membership_id",
        "revoked_at",
        "expires_at"
    );
CREATE INDEX "employee_sessions_device_active_idx"
    ON "employee_sessions"("employee_device_id", "revoked_at");
CREATE INDEX "employee_sessions_business_branch_idx"
    ON "employee_sessions"("business_id", "primary_branch_id");

CREATE UNIQUE INDEX "attendance_request_idempotency_attendance_punch_id_key"
    ON "attendance_request_idempotency"("attendance_punch_id");
CREATE UNIQUE INDEX "attendance_idempotency_membership_key"
    ON "attendance_request_idempotency"(
        "membership_id",
        "idempotency_key"
    );
CREATE INDEX "attendance_idempotency_employee_session_created_idx"
    ON "attendance_request_idempotency"(
        "employee_session_id",
        "created_at"
    );
CREATE INDEX "attendance_idempotency_business_branch_created_idx"
    ON "attendance_request_idempotency"(
        "business_id",
        "branch_id",
        "created_at"
    );
CREATE INDEX "attendance_idempotency_attendance_session_created_idx"
    ON "attendance_request_idempotency"(
        "attendance_session_id",
        "created_at"
    );

ALTER TABLE "employee_otp_challenges"
    ADD CONSTRAINT "employee_otp_challenges_employee_account_id_fkey"
    FOREIGN KEY ("employee_account_id")
    REFERENCES "employee_accounts"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

ALTER TABLE "employee_devices"
    ADD CONSTRAINT "employee_devices_employee_account_id_fkey"
    FOREIGN KEY ("employee_account_id")
    REFERENCES "employee_accounts"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_employee_account_id_fkey"
    FOREIGN KEY ("employee_account_id")
    REFERENCES "employee_accounts"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_membership_id_fkey"
    FOREIGN KEY ("membership_id")
    REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_business_id_fkey"
    FOREIGN KEY ("business_id")
    REFERENCES "businesses"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_primary_branch_id_fkey"
    FOREIGN KEY ("primary_branch_id")
    REFERENCES "branches"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "employee_sessions"
    ADD CONSTRAINT "employee_sessions_employee_device_id_fkey"
    FOREIGN KEY ("employee_device_id")
    REFERENCES "employee_devices"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_membership_id_fkey"
    FOREIGN KEY ("membership_id")
    REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_employee_session_id_fkey"
    FOREIGN KEY ("employee_session_id")
    REFERENCES "employee_sessions"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_business_id_fkey"
    FOREIGN KEY ("business_id")
    REFERENCES "businesses"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_branch_id_fkey"
    FOREIGN KEY ("branch_id")
    REFERENCES "branches"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id")
    REFERENCES "employee_attendance"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
ALTER TABLE "attendance_request_idempotency"
    ADD CONSTRAINT "attendance_request_idempotency_attendance_punch_id_fkey"
    FOREIGN KEY ("attendance_punch_id")
    REFERENCES "attendance_punches"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

-- Phase 1A already refuses duplicate live sessions and owns this partial
-- unique index. Phase 1C treats that database invariant as a prerequisite
-- instead of creating a second equivalent index.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class AS index_class
        JOIN pg_index AS index_definition
          ON index_definition.indexrelid = index_class.oid
        JOIN pg_class AS table_class
          ON table_class.oid = index_definition.indrelid
        WHERE index_class.relname = 'employee_attendance_one_active_session_key'
          AND table_class.relname = 'employee_attendance'
          AND index_definition.indisunique
          AND pg_get_indexdef(index_definition.indexrelid) ILIKE '%membership_id%'
          AND pg_get_expr(
                index_definition.indpred,
                index_definition.indrelid
              ) ILIKE '%OPEN%'
          AND pg_get_expr(
                index_definition.indpred,
                index_definition.indrelid
              ) ILIKE '%ON_BREAK%'
    ) THEN
        RAISE EXCEPTION
            'Phase 1A live Attendance session uniqueness guard is missing';
    END IF;
END
$$;

-- The immutable Punch protections created by Phase 1A are prerequisites.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'attendance_punches_immutable_guard'
          AND NOT tgisinternal
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'attendance_punches_immutable_truncate_guard'
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION
            'Attendance Punch immutability guards are missing';
    END IF;
END
$$;

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

CREATE FUNCTION "enforce_attendance_terminal_punch_link"()
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

CREATE CONSTRAINT TRIGGER "attendance_terminal_punch_link_guard"
    AFTER INSERT OR UPDATE ON "attendance_punches"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_terminal_punch_link"();

CREATE FUNCTION "enforce_attendance_session_terminal_links"()
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

CREATE CONSTRAINT TRIGGER "attendance_session_terminal_link_guard"
    AFTER INSERT OR UPDATE ON "employee_attendance"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_session_terminal_links"();
CREATE FUNCTION "invalidate_previous_employee_otp_challenges"()
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

CREATE FUNCTION "enforce_employee_otp_challenge_lifecycle"()
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

CREATE TRIGGER "employee_otp_challenges_10_invalidate_previous"
    BEFORE INSERT ON "employee_otp_challenges"
    FOR EACH ROW
    EXECUTE FUNCTION "invalidate_previous_employee_otp_challenges"();
CREATE TRIGGER "employee_otp_challenges_20_lifecycle_guard"
    BEFORE INSERT OR UPDATE ON "employee_otp_challenges"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_employee_otp_challenge_lifecycle"();

CREATE FUNCTION "enforce_employee_device_lifecycle"()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."employee_account_id" IS DISTINCT FROM
           OLD."employee_account_id"
           OR NEW."device_identifier_hash" IS DISTINCT FROM
              OLD."device_identifier_hash"
           OR NEW."first_verified_at" IS DISTINCT FROM
              OLD."first_verified_at"
           OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
            RAISE EXCEPTION
                'Employee device identity is immutable';
        END IF;

        IF OLD."status" = 'REVOKED'
           AND NEW."status" <> 'REVOKED' THEN
            RAISE EXCEPTION
                'Revoked Employee device cannot be reactivated';
        END IF;

        IF NEW."last_active_at" < OLD."last_active_at" THEN
            RAISE EXCEPTION
                'Employee device last active time cannot decrease';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_devices_lifecycle_guard"
    BEFORE UPDATE ON "employee_devices"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_employee_device_lifecycle"();

CREATE FUNCTION "prevent_employee_account_auth_identity_mutation"()
RETURNS trigger AS $$
BEGIN
    IF (
        NEW."phone_number" IS DISTINCT FROM OLD."phone_number"
        OR NEW."phone_normalized" IS DISTINCT FROM OLD."phone_normalized"
    ) AND EXISTS (
        SELECT 1
        FROM "employee_otp_challenges"
        WHERE "employee_account_id" = OLD."id"
        UNION ALL
        SELECT 1
        FROM "employee_devices"
        WHERE "employee_account_id" = OLD."id"
        UNION ALL
        SELECT 1
        FROM "employee_sessions"
        WHERE "employee_account_id" = OLD."id"
    ) THEN
        RAISE EXCEPTION
            'Employee Account phone cannot change after authentication data exists';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_accounts_auth_identity_guard"
    BEFORE UPDATE OF "phone_number", "phone_normalized"
    ON "employee_accounts"
    FOR EACH ROW
    EXECUTE FUNCTION "prevent_employee_account_auth_identity_mutation"();

CREATE FUNCTION "enforce_employee_session_scope"()
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

CREATE TRIGGER "employee_sessions_scope_guard"
    BEFORE INSERT OR UPDATE ON "employee_sessions"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_employee_session_scope"();

CREATE FUNCTION "revoke_sessions_for_inactive_employee_device"()
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

CREATE TRIGGER "employee_devices_revoke_sessions"
    AFTER UPDATE OF "status" ON "employee_devices"
    FOR EACH ROW
    EXECUTE FUNCTION "revoke_sessions_for_inactive_employee_device"();

CREATE FUNCTION "enforce_attendance_idempotency_scope"()
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

CREATE TRIGGER "attendance_request_idempotency_scope_guard"
    BEFORE INSERT OR UPDATE ON "attendance_request_idempotency"
    FOR EACH ROW
    EXECUTE FUNCTION "enforce_attendance_idempotency_scope"();

-- Extend existing tenant-key immutability to the new auth/request children.
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
           UNION ALL
           SELECT 1
           FROM "employee_sessions"
           WHERE "membership_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_request_idempotency"
           WHERE "membership_id" = OLD."id"
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
           UNION ALL
           SELECT 1
           FROM "employee_sessions"
           WHERE "membership_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_request_idempotency"
           WHERE "membership_id" = OLD."id"
       ) THEN
        RAISE EXCEPTION
            'Employee membership tenant keys cannot change after attendance data exists';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION
    "prevent_attendance_branch_tenant_key_mutation"()
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
           UNION ALL
           SELECT 1
           FROM "employee_sessions"
           WHERE "primary_branch_id" = OLD."id"
           UNION ALL
           SELECT 1
           FROM "attendance_request_idempotency"
           WHERE "branch_id" = OLD."id"
       ) THEN
        RAISE EXCEPTION
            'Branch business cannot change after attendance data exists';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
