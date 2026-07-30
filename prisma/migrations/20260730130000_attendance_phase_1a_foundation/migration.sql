BEGIN;

-- Attendance Phase 1A extends the existing cross-industry employee identity.
-- It intentionally does not create employee authentication, OTP, or punch APIs.

CREATE TYPE "EmployeeEmploymentType" AS ENUM (
    'FULL_TIME',
    'PART_TIME',
    'CONTRACT',
    'DAILY',
    'HOURLY'
);

CREATE TYPE "EmployeeBranchAssignmentStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE'
);

CREATE TYPE "AttendanceApprovalStatus" AS ENUM (
    'NOT_REQUIRED',
    'PENDING',
    'APPROVED',
    'REJECTED'
);

CREATE TYPE "AttendancePunchType" AS ENUM (
    'CLOCK_IN',
    'BREAK_START',
    'BREAK_END',
    'CLOCK_OUT'
);

CREATE TYPE "AttendancePunchSource" AS ENUM (
    'STAFF_PWA',
    'ADMIN_MANUAL',
    'SYSTEM'
);

CREATE TYPE "AttendanceGeofenceStatus" AS ENUM (
    'INSIDE',
    'OUTSIDE',
    'GPS_INACCURATE',
    'GPS_UNAVAILABLE',
    'GEOFENCE_DISABLED'
);

CREATE TYPE "AttendanceExceptionType" AS ENUM (
    'OUTSIDE_GEOFENCE',
    'GPS_INACCURATE',
    'GPS_UNAVAILABLE',
    'FORGOT_CLOCK_IN',
    'FORGOT_CLOCK_OUT',
    'WRONG_BRANCH',
    'OTHER'
);

CREATE TYPE "AttendanceExceptionStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED'
);

-- Preserve legacy membership data while replacing INACTIVE with the
-- business-scoped employment states required by Attendance.
CREATE TYPE "EmployeeMembershipStatus_new" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'TERMINATED'
);
ALTER TABLE "employee_business_memberships"
    ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "employee_business_memberships"
    ALTER COLUMN "status" TYPE "EmployeeMembershipStatus_new"
    USING (
        CASE
            WHEN "status"::text = 'INACTIVE' THEN 'SUSPENDED'
            ELSE "status"::text
        END
    )::"EmployeeMembershipStatus_new";
ALTER TYPE "EmployeeMembershipStatus"
    RENAME TO "EmployeeMembershipStatus_old";
ALTER TYPE "EmployeeMembershipStatus_new"
    RENAME TO "EmployeeMembershipStatus";
DROP TYPE "EmployeeMembershipStatus_old";
ALTER TABLE "employee_business_memberships"
    ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- Preserve legacy CLOSED sessions as COMPLETED.
CREATE TYPE "EmployeeAttendanceStatus_new" AS ENUM (
    'OPEN',
    'ON_BREAK',
    'COMPLETED',
    'INCOMPLETE',
    'CANCELLED'
);
ALTER TABLE "employee_attendance"
    ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "employee_attendance"
    ALTER COLUMN "status" TYPE "EmployeeAttendanceStatus_new"
    USING (
        CASE
            WHEN "status"::text = 'CLOSED' THEN 'COMPLETED'
            ELSE "status"::text
        END
    )::"EmployeeAttendanceStatus_new";
ALTER TYPE "EmployeeAttendanceStatus"
    RENAME TO "EmployeeAttendanceStatus_old";
ALTER TYPE "EmployeeAttendanceStatus_new"
    RENAME TO "EmployeeAttendanceStatus";
DROP TYPE "EmployeeAttendanceStatus_old";
ALTER TABLE "employee_attendance"
    ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- Canonical E.164 identity. Existing Malaysia-format values are normalized
-- without changing the global EmployeeAccount identity decision.
ALTER TABLE "employee_accounts"
    ADD COLUMN "phone_number" TEXT;

DO $$
BEGIN
    IF EXISTS (
        WITH canonical_phones AS (
            SELECT
                CASE
                    WHEN digits LIKE '00%' THEN '+' || substring(digits FROM 3)
                    WHEN digits LIKE '0%' THEN '+6' || digits
                    WHEN digits LIKE '1%' THEN '+60' || digits
                    ELSE '+' || digits
                END AS canonical
            FROM (
                SELECT regexp_replace("phone_normalized", '[^0-9]', '', 'g') AS digits
                FROM "employee_accounts"
            ) source
        )
        SELECT 1
        FROM canonical_phones
        GROUP BY canonical
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Employee phone normalization would create duplicate identities';
    END IF;
END
$$;

WITH canonical_phones AS (
    SELECT
        "id",
        CASE
            WHEN digits LIKE '00%' THEN '+' || substring(digits FROM 3)
            WHEN digits LIKE '0%' THEN '+6' || digits
            WHEN digits LIKE '1%' THEN '+60' || digits
            ELSE '+' || digits
        END AS canonical
    FROM (
        SELECT
            "id",
            regexp_replace("phone_normalized", '[^0-9]', '', 'g') AS digits
        FROM "employee_accounts"
    ) source
)
UPDATE "employee_accounts" account
SET
    "phone_normalized" = canonical_phones.canonical,
    "phone_number" = canonical_phones.canonical
FROM canonical_phones
WHERE canonical_phones."id" = account."id";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "employee_accounts"
        WHERE "phone_normalized" !~ '^\+[1-9][0-9]{7,14}$'
    ) THEN
        RAISE EXCEPTION 'Employee phone backfill contains a non-E.164 value';
    END IF;
END
$$;

ALTER TABLE "employee_accounts"
    ALTER COLUMN "phone_number" SET NOT NULL,
    ADD CONSTRAINT "employee_accounts_phone_number_e164_check"
        CHECK ("phone_number" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "employee_accounts_phone_normalized_e164_check"
        CHECK ("phone_normalized" ~ '^\+[1-9][0-9]{7,14}$');

-- EmployeeBusinessMembership is the business-scoped Employee record.
ALTER TABLE "employee_business_memberships"
    ADD COLUMN "employee_code" TEXT,
    ADD COLUMN "full_name" TEXT,
    ADD COLUMN "phone_number" TEXT,
    ADD COLUMN "phone_number_normalized" TEXT,
    ADD COLUMN "employment_type" "EmployeeEmploymentType" NOT NULL DEFAULT 'FULL_TIME',
    ADD COLUMN "attendance_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "joined_at" TIMESTAMP(3),
    ADD COLUMN "terminated_at" TIMESTAMP(3);

UPDATE "employee_business_memberships" employee
SET
    "employee_code" = 'LEGACY-' || upper(replace(employee."id"::text, '-', '')),
    "full_name" = account."name",
    "phone_number" = account."phone_number",
    "phone_number_normalized" = account."phone_normalized",
    "joined_at" = employee."created_at"
FROM "employee_accounts" account
WHERE account."id" = employee."employee_account_id";

ALTER TABLE "employee_business_memberships"
    ALTER COLUMN "employee_code" SET NOT NULL,
    ALTER COLUMN "full_name" SET NOT NULL,
    ALTER COLUMN "phone_number" SET NOT NULL,
    ALTER COLUMN "phone_number_normalized" SET NOT NULL,
    ALTER COLUMN "joined_at" SET NOT NULL,
    ALTER COLUMN "joined_at" SET DEFAULT CURRENT_TIMESTAMP,
    ADD CONSTRAINT "employee_memberships_employee_code_nonempty_check"
        CHECK (length(btrim("employee_code")) > 0),
    ADD CONSTRAINT "employee_memberships_full_name_nonempty_check"
        CHECK (length(btrim("full_name")) > 0),
    ADD CONSTRAINT "employee_memberships_phone_number_e164_check"
        CHECK ("phone_number" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "employee_memberships_phone_normalized_e164_check"
        CHECK ("phone_number_normalized" ~ '^\+[1-9][0-9]{7,14}$'),
    ADD CONSTRAINT "employee_memberships_termination_after_join_check"
        CHECK ("terminated_at" IS NULL OR "terminated_at" >= "joined_at");

CREATE UNIQUE INDEX
    "employee_business_memberships_business_id_employee_code_key"
    ON "employee_business_memberships"("business_id", "employee_code");
CREATE UNIQUE INDEX
    "employee_business_memberships_business_id_phone_number_norm_key"
    ON "employee_business_memberships"("business_id", "phone_number_normalized");

-- Extend the existing assignment table and preserve its historical rows.
ALTER TABLE "employee_branch_assignments"
    ADD COLUMN "is_primary" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "can_clock_in" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "effective_from" TIMESTAMP(3),
    ADD COLUMN "effective_until" TIMESTAMP(3),
    ADD COLUMN "status" "EmployeeBranchAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "employee_branch_assignments"
SET
    "effective_from" = "created_at",
    "updated_at" = "created_at";

WITH ranked_assignments AS (
    SELECT
        "id",
        row_number() OVER (
            PARTITION BY "membership_id"
            ORDER BY "created_at", "id"
        ) AS assignment_rank
    FROM "employee_branch_assignments"
)
UPDATE "employee_branch_assignments" assignment
SET "is_primary" = ranked_assignments.assignment_rank = 1
FROM ranked_assignments
WHERE ranked_assignments."id" = assignment."id";

ALTER TABLE "employee_branch_assignments"
    ALTER COLUMN "effective_from" SET NOT NULL,
    ALTER COLUMN "effective_from" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updated_at" SET NOT NULL,
    ADD CONSTRAINT "employee_branch_assignments_effective_range_check"
        CHECK (
            "effective_until" IS NULL
            OR "effective_until" > "effective_from"
        );

CREATE UNIQUE INDEX "employee_branch_assignments_one_primary_key"
    ON "employee_branch_assignments"("membership_id")
    WHERE "is_primary" = true AND "status" = 'ACTIVE';
CREATE INDEX
    "employee_branch_assignments_membership_id_status_effective_idx"
    ON "employee_branch_assignments"(
        "membership_id",
        "status",
        "effective_from",
        "effective_until"
    );

-- Expand the existing EmployeeAttendance table into the canonical Attendance
-- Session foundation while retaining all legacy rows.
ALTER TABLE "employee_attendance"
    ADD COLUMN "work_date" DATE,
    ADD COLUMN "clock_in_punch_id" UUID,
    ADD COLUMN "clock_out_punch_id" UUID,
    ADD COLUMN "total_break_minutes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "total_worked_minutes" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "approval_status" "AttendanceApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

UPDATE "employee_attendance" attendance
SET
    "work_date" = (
        (
            attendance."clock_in_at" AT TIME ZONE 'UTC'
        ) AT TIME ZONE business."timezone"
    )::date,
    "total_worked_minutes" = CASE
        WHEN attendance."clock_out_at" IS NULL THEN 0
        ELSE greatest(
            0,
            floor(
                extract(
                    epoch FROM (
                        attendance."clock_out_at" - attendance."clock_in_at"
                    )
                ) / 60
            )::integer
        )
    END
FROM "businesses" business
WHERE business."id" = attendance."business_id";

ALTER TABLE "employee_attendance"
    ALTER COLUMN "work_date" SET NOT NULL,
    ADD CONSTRAINT "employee_attendance_break_minutes_check"
        CHECK ("total_break_minutes" >= 0),
    ADD CONSTRAINT "employee_attendance_worked_minutes_check"
        CHECK ("total_worked_minutes" >= 0),
    ADD CONSTRAINT "employee_attendance_clock_order_check"
        CHECK (
            "clock_out_at" IS NULL
            OR "clock_out_at" >= "clock_in_at"
        );

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "employee_attendance"
        WHERE "status" IN ('OPEN', 'ON_BREAK')
        GROUP BY "membership_id"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'An employee has more than one active attendance session';
    END IF;
END
$$;

CREATE UNIQUE INDEX "employee_attendance_one_active_session_key"
    ON "employee_attendance"("membership_id")
    WHERE "status" IN ('OPEN', 'ON_BREAK');
CREATE UNIQUE INDEX "employee_attendance_clock_in_punch_id_key"
    ON "employee_attendance"("clock_in_punch_id");
CREATE UNIQUE INDEX "employee_attendance_clock_out_punch_id_key"
    ON "employee_attendance"("clock_out_punch_id");
CREATE INDEX "employee_attendance_business_id_branch_id_work_date_idx"
    ON "employee_attendance"("business_id", "branch_id", "work_date");

CREATE TABLE "branch_attendance_settings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "latitude" DECIMAL(9, 6) NOT NULL,
    "longitude" DECIMAL(10, 6) NOT NULL,
    "geofence_radius_meters" INTEGER NOT NULL DEFAULT 100,
    "minimum_accuracy_meters" INTEGER NOT NULL DEFAULT 80,
    "require_geofence" BOOLEAN NOT NULL DEFAULT true,
    "allow_outside_geofence_request" BOOLEAN NOT NULL DEFAULT true,
    "require_photo" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kuching',
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_attendance_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_attendance_settings_latitude_check"
        CHECK ("latitude" BETWEEN -90 AND 90),
    CONSTRAINT "branch_attendance_settings_longitude_check"
        CHECK ("longitude" BETWEEN -180 AND 180),
    CONSTRAINT "branch_attendance_settings_radius_check"
        CHECK ("geofence_radius_meters" BETWEEN 20 AND 1000),
    CONSTRAINT "branch_attendance_settings_accuracy_check"
        CHECK ("minimum_accuracy_meters" BETWEEN 10 AND 500)
);

CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_session_id" UUID,
    "type" "AttendancePunchType" NOT NULL,
    "server_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_timestamp" TIMESTAMP(3),
    "latitude" DECIMAL(9, 6),
    "longitude" DECIMAL(10, 6),
    "accuracy_meters" DECIMAL(8, 2),
    "distance_from_branch_meters" DECIMAL(10, 2),
    "inside_geofence" BOOLEAN NOT NULL,
    "geofence_status" "AttendanceGeofenceStatus" NOT NULL,
    "source" "AttendancePunchSource" NOT NULL,
    "device_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_punches_latitude_check"
        CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
    CONSTRAINT "attendance_punches_longitude_check"
        CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
    CONSTRAINT "attendance_punches_coordinate_pair_check"
        CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
    CONSTRAINT "attendance_punches_accuracy_check"
        CHECK ("accuracy_meters" IS NULL OR "accuracy_meters" >= 0),
    CONSTRAINT "attendance_punches_distance_check"
        CHECK (
            "distance_from_branch_meters" IS NULL
            OR "distance_from_branch_meters" >= 0
        ),
    CONSTRAINT "attendance_punches_inside_status_check"
        CHECK (
            ("inside_geofence" = true AND "geofence_status" = 'INSIDE')
            OR ("inside_geofence" = false AND "geofence_status" <> 'INSIDE')
        )
);

CREATE TABLE "attendance_exceptions" (
    "id" UUID NOT NULL,
    "attendance_punch_id" UUID,
    "attendance_session_id" UUID,
    "employee_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "type" "AttendanceExceptionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AttendanceExceptionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_exceptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_exceptions_reason_nonempty_check"
        CHECK (length(btrim("reason")) > 0)
);

CREATE TABLE "attendance_adjustments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "attendance_session_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "original_clock_in_at" TIMESTAMP(3),
    "adjusted_clock_in_at" TIMESTAMP(3),
    "original_clock_out_at" TIMESTAMP(3),
    "adjusted_clock_out_at" TIMESTAMP(3),
    "original_break_minutes" INTEGER,
    "adjusted_break_minutes" INTEGER,
    "reason" TEXT NOT NULL,
    "adjusted_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_adjustments_reason_nonempty_check"
        CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "attendance_adjustments_original_break_check"
        CHECK (
            "original_break_minutes" IS NULL
            OR "original_break_minutes" >= 0
        ),
    CONSTRAINT "attendance_adjustments_adjusted_break_check"
        CHECK (
            "adjusted_break_minutes" IS NULL
            OR "adjusted_break_minutes" >= 0
        )
);

CREATE UNIQUE INDEX "branch_attendance_settings_branch_id_key"
    ON "branch_attendance_settings"("branch_id");
CREATE INDEX "branch_attendance_settings_business_id_is_enabled_idx"
    ON "branch_attendance_settings"("business_id", "is_enabled");
CREATE INDEX "attendance_punches_business_id_branch_id_server_timestamp_idx"
    ON "attendance_punches"("business_id", "branch_id", "server_timestamp");
CREATE INDEX "attendance_punches_employee_id_server_timestamp_idx"
    ON "attendance_punches"("employee_id", "server_timestamp");
CREATE INDEX "attendance_punches_attendance_session_id_server_timestamp_idx"
    ON "attendance_punches"("attendance_session_id", "server_timestamp");
CREATE INDEX "attendance_exceptions_business_id_branch_id_status_created_idx"
    ON "attendance_exceptions"("business_id", "branch_id", "status", "created_at");
CREATE INDEX "attendance_exceptions_employee_id_created_at_idx"
    ON "attendance_exceptions"("employee_id", "created_at");
CREATE INDEX "attendance_exceptions_attendance_session_id_idx"
    ON "attendance_exceptions"("attendance_session_id");
CREATE INDEX "attendance_adjustments_business_id_branch_id_created_at_idx"
    ON "attendance_adjustments"("business_id", "branch_id", "created_at");
CREATE INDEX "attendance_adjustments_attendance_session_id_created_at_idx"
    ON "attendance_adjustments"("attendance_session_id", "created_at");
CREATE INDEX "attendance_adjustments_employee_id_created_at_idx"
    ON "attendance_adjustments"("employee_id", "created_at");

ALTER TABLE "branch_attendance_settings"
    ADD CONSTRAINT "branch_attendance_settings_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "branch_attendance_settings_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_punches"
    ADD CONSTRAINT "attendance_punches_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_attendance"
    ADD CONSTRAINT "employee_attendance_clock_in_punch_id_fkey"
    FOREIGN KEY ("clock_in_punch_id") REFERENCES "attendance_punches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "employee_attendance_clock_out_punch_id_fkey"
    FOREIGN KEY ("clock_out_punch_id") REFERENCES "attendance_punches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_exceptions"
    ADD CONSTRAINT "attendance_exceptions_attendance_punch_id_fkey"
    FOREIGN KEY ("attendance_punch_id") REFERENCES "attendance_punches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_exceptions_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_exceptions_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_exceptions_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_exceptions_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_exceptions_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_adjustments"
    ADD CONSTRAINT "attendance_adjustments_attendance_session_id_fkey"
    FOREIGN KEY ("attendance_session_id") REFERENCES "employee_attendance"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_adjustments_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_adjustments_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_adjustments_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_adjustments_adjusted_by_fkey"
    FOREIGN KEY ("adjusted_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level tenant guards prevent mismatched business, branch, employee,
-- session, or punch identifiers even if a future caller forgets a filter.
CREATE FUNCTION "enforce_attendance_assignment_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "employee_business_memberships"
        WHERE "id" = NEW."membership_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee assignment business scope mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Employee assignment branch scope mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_branch_attendance_setting_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance setting branch scope mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_timezone_names WHERE name = NEW."timezone"
    ) THEN
        RAISE EXCEPTION 'Attendance setting timezone is invalid';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_attendance_session_scope"()
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
        SELECT 1 FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance session branch scope mismatch';
    END IF;
    IF NEW."clock_in_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "attendance_punches"
        WHERE "id" = NEW."clock_in_punch_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "employee_id" = NEW."membership_id"
    ) THEN
        RAISE EXCEPTION 'Attendance session clock-in punch scope mismatch';
    END IF;
    IF NEW."clock_out_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "attendance_punches"
        WHERE "id" = NEW."clock_out_punch_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "employee_id" = NEW."membership_id"
    ) THEN
        RAISE EXCEPTION 'Attendance session clock-out punch scope mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_attendance_punch_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "employee_business_memberships"
        WHERE "id" = NEW."employee_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance punch employee scope mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance punch branch scope mismatch';
    END IF;
    IF NEW."attendance_session_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "employee_attendance"
        WHERE "id" = NEW."attendance_session_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "membership_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance punch session scope mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_attendance_exception_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "employee_business_memberships"
        WHERE "id" = NEW."employee_id"
          AND "business_id" = NEW."business_id"
    ) OR NOT EXISTS (
        SELECT 1 FROM "branches"
        WHERE "id" = NEW."branch_id"
          AND "business_id" = NEW."business_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception tenant scope mismatch';
    END IF;
    IF NEW."attendance_session_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "employee_attendance"
        WHERE "id" = NEW."attendance_session_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "membership_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception session scope mismatch';
    END IF;
    IF NEW."attendance_punch_id" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "attendance_punches"
        WHERE "id" = NEW."attendance_punch_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "employee_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance exception punch scope mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_attendance_adjustment_scope"()
RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "employee_attendance"
        WHERE "id" = NEW."attendance_session_id"
          AND "business_id" = NEW."business_id"
          AND "branch_id" = NEW."branch_id"
          AND "membership_id" = NEW."employee_id"
    ) THEN
        RAISE EXCEPTION 'Attendance adjustment session scope mismatch';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "prevent_attendance_punch_mutation"()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Attendance punches are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_branch_assignments_scope_guard"
    BEFORE INSERT OR UPDATE ON "employee_branch_assignments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_attendance_assignment_scope"();
CREATE TRIGGER "branch_attendance_settings_scope_guard"
    BEFORE INSERT OR UPDATE ON "branch_attendance_settings"
    FOR EACH ROW EXECUTE FUNCTION "enforce_branch_attendance_setting_scope"();
CREATE TRIGGER "employee_attendance_scope_guard"
    BEFORE INSERT OR UPDATE ON "employee_attendance"
    FOR EACH ROW EXECUTE FUNCTION "enforce_attendance_session_scope"();
CREATE TRIGGER "attendance_punches_scope_guard"
    BEFORE INSERT ON "attendance_punches"
    FOR EACH ROW EXECUTE FUNCTION "enforce_attendance_punch_scope"();
CREATE TRIGGER "attendance_punches_immutable_guard"
    BEFORE UPDATE OR DELETE ON "attendance_punches"
    FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_punch_mutation"();
CREATE TRIGGER "attendance_exceptions_scope_guard"
    BEFORE INSERT OR UPDATE ON "attendance_exceptions"
    FOR EACH ROW EXECUTE FUNCTION "enforce_attendance_exception_scope"();
CREATE TRIGGER "attendance_adjustments_scope_guard"
    BEFORE INSERT OR UPDATE ON "attendance_adjustments"
    FOR EACH ROW EXECUTE FUNCTION "enforce_attendance_adjustment_scope"();

COMMIT;
