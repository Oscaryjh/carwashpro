BEGIN;

-- Attendance Phase 1C.5 keeps employment, service/POS access, and Attendance
-- as separate concerns while giving each business-scoped staff User an
-- explicit, optional one-to-one link to its canonical employment membership.
CREATE TYPE "TeamMemberLinkStatus" AS ENUM (
    'LINKED',
    'UNLINKED',
    'REVIEW_REQUIRED'
);

ALTER TABLE "users"
    ADD COLUMN "employee_business_membership_id" UUID,
    ADD COLUMN "team_member_link_status" "TeamMemberLinkStatus"
        NOT NULL DEFAULT 'UNLINKED',
    ADD COLUMN "team_member_link_reason" TEXT,
    ADD COLUMN "team_member_linked_at" TIMESTAMP(3);

-- First preference: the existing explicit EmployeeAccount relation plus the
-- same Business. A Membership can be claimed automatically only by one Staff
-- User; competing claims are retained for manual review.
WITH explicit_candidates AS (
    SELECT
        staff."id" AS "user_id",
        membership."id" AS "membership_id",
        count(*) OVER (
            PARTITION BY membership."id"
        ) AS "claimant_count"
    FROM "users" staff
    JOIN "employee_business_memberships" membership
      ON membership."employee_account_id" =
            staff."employee_account_id"
     AND membership."business_id" = staff."business_id"
    WHERE staff."role" = 'STAFF'
      AND staff."employee_account_id" IS NOT NULL
)
UPDATE "users" staff
SET
    "employee_business_membership_id" =
        CASE
            WHEN candidate."claimant_count" = 1
                THEN candidate."membership_id"
            ELSE NULL
        END,
    "team_member_link_status" =
        CASE
            WHEN candidate."claimant_count" = 1
                THEN 'LINKED'::"TeamMemberLinkStatus"
            ELSE 'REVIEW_REQUIRED'::"TeamMemberLinkStatus"
        END,
    "team_member_link_reason" =
        CASE
            WHEN candidate."claimant_count" = 1
                THEN 'EXPLICIT_ACCOUNT_BUSINESS'
            ELSE 'DUPLICATE_EXPLICIT_ACCOUNT_CLAIM'
        END,
    "team_member_linked_at" =
        CASE
            WHEN candidate."claimant_count" = 1
                THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            ELSE NULL
        END
FROM explicit_candidates candidate
WHERE staff."id" = candidate."user_id";

-- An explicit account link that has no Membership in the same Business must
-- never fall back to a different account through phone matching.
UPDATE "users"
SET
    "team_member_link_status" = 'REVIEW_REQUIRED',
    "team_member_link_reason" =
        CASE
            WHEN "business_id" IS NULL THEN 'MISSING_BUSINESS'
            ELSE 'EXPLICIT_ACCOUNT_NO_BUSINESS_MEMBERSHIP'
        END,
    "team_member_linked_at" = NULL
WHERE "role" = 'STAFF'
  AND "employee_account_id" IS NOT NULL
  AND "employee_business_membership_id" IS NULL
  AND "team_member_link_status" = 'UNLINKED';

-- Second preference: normalize the legacy Staff phone with the same semantics
-- as normalizeAttendancePhone(), then require an exact E.164 match inside the
-- same Business. The Staff and Membership sides must both be unambiguous.
WITH compacted_staff_phone AS (
    SELECT
        staff."id" AS "user_id",
        staff."business_id",
        CASE
            WHEN staff."whatsapp_phone" IS NOT NULL
             AND btrim(staff."whatsapp_phone") ~
                    '^[-+0-9[:space:]()]+$'
                THEN regexp_replace(
                    btrim(staff."whatsapp_phone"),
                    '[[:space:]()-]',
                    '',
                    'g'
                )
            ELSE NULL
        END AS "compact_phone"
    FROM "users" staff
    WHERE staff."role" = 'STAFF'
      AND staff."employee_account_id" IS NULL
      AND staff."employee_business_membership_id" IS NULL
),
canonical_staff_phone AS (
    SELECT
        phone."user_id",
        phone."business_id",
        CASE
            WHEN phone."compact_phone" ~ '^\+[0-9]+$'
                THEN phone."compact_phone"
            WHEN phone."compact_phone" LIKE '00%'
                THEN NULL
            WHEN phone."compact_phone" ~ '^0[0-9]+$'
                THEN '+60' || substring(
                    phone."compact_phone"
                    FROM 2
                )
            WHEN phone."compact_phone" ~ '^[1-9][0-9]+$'
                THEN '+' || phone."compact_phone"
            ELSE NULL
        END AS "canonical_phone"
    FROM compacted_staff_phone phone
),
normalized_staff_phone AS (
    SELECT
        phone."user_id",
        phone."business_id",
        CASE
            WHEN phone."canonical_phone" ~
                    '^\+[1-9][0-9]{7,14}$'
                THEN phone."canonical_phone"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical_staff_phone phone
),
raw_phone_candidates AS (
    SELECT
        phone."user_id",
        membership."id" AS "membership_id",
        membership."employee_account_id",
        count(*) OVER (
            PARTITION BY phone."user_id"
        ) AS "membership_count",
        count(*) OVER (
            PARTITION BY membership."id"
        ) AS "claimant_count"
    FROM normalized_staff_phone phone
    JOIN "employee_business_memberships" membership
      ON membership."business_id" = phone."business_id"
     AND membership."phone_number_normalized" =
            phone."phone_normalized"
    WHERE phone."phone_normalized" IS NOT NULL
),
phone_candidates AS (
    SELECT
        candidate.*,
        EXISTS (
            SELECT 1
            FROM "users" linked_staff
            WHERE linked_staff."employee_business_membership_id" =
                    candidate."membership_id"
        ) AS "membership_already_linked"
    FROM raw_phone_candidates candidate
)
UPDATE "users" staff
SET
    "employee_business_membership_id" =
        CASE
            WHEN candidate."membership_count" = 1
             AND candidate."claimant_count" = 1
             AND NOT candidate."membership_already_linked"
                THEN candidate."membership_id"
            ELSE NULL
        END,
    "employee_account_id" =
        CASE
            WHEN candidate."membership_count" = 1
             AND candidate."claimant_count" = 1
             AND NOT candidate."membership_already_linked"
                THEN candidate."employee_account_id"
            ELSE staff."employee_account_id"
        END,
    "team_member_link_status" =
        CASE
            WHEN candidate."membership_count" = 1
             AND candidate."claimant_count" = 1
             AND NOT candidate."membership_already_linked"
                THEN 'LINKED'::"TeamMemberLinkStatus"
            ELSE 'REVIEW_REQUIRED'::"TeamMemberLinkStatus"
        END,
    "team_member_link_reason" =
        CASE
            WHEN candidate."membership_count" > 1
                THEN 'DUPLICATE_PHONE_MEMBERSHIP'
            WHEN candidate."membership_already_linked"
                THEN 'MEMBERSHIP_ALREADY_LINKED'
            WHEN candidate."claimant_count" > 1
                THEN 'DUPLICATE_PHONE_CLAIM'
            ELSE 'EXACT_BUSINESS_PHONE'
        END,
    "team_member_linked_at" =
        CASE
            WHEN candidate."membership_count" = 1
             AND candidate."claimant_count" = 1
             AND NOT candidate."membership_already_linked"
                THEN (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
            ELSE NULL
        END
FROM phone_candidates candidate
WHERE staff."id" = candidate."user_id";

-- Classify every remaining legacy Staff without inventing a Membership.
-- Missing/invalid phones and no-match records remain safely UNLINKED. A phone
-- that exists only in another Business is flagged for human review, but is
-- never linked across tenant boundaries.
WITH compacted_staff_phone AS (
    SELECT
        staff."id" AS "user_id",
        CASE
            WHEN staff."whatsapp_phone" IS NOT NULL
             AND btrim(staff."whatsapp_phone") ~
                    '^[-+0-9[:space:]()]+$'
                THEN regexp_replace(
                    btrim(staff."whatsapp_phone"),
                    '[[:space:]()-]',
                    '',
                    'g'
                )
            ELSE NULL
        END AS "compact_phone"
    FROM "users" staff
    WHERE staff."role" = 'STAFF'
      AND staff."employee_account_id" IS NULL
      AND staff."employee_business_membership_id" IS NULL
      AND staff."team_member_link_status" = 'UNLINKED'
),
canonical_staff_phone AS (
    SELECT
        phone."user_id",
        CASE
            WHEN phone."compact_phone" ~ '^\+[0-9]+$'
                THEN phone."compact_phone"
            WHEN phone."compact_phone" LIKE '00%'
                THEN NULL
            WHEN phone."compact_phone" ~ '^0[0-9]+$'
                THEN '+60' || substring(
                    phone."compact_phone"
                    FROM 2
                )
            WHEN phone."compact_phone" ~ '^[1-9][0-9]+$'
                THEN '+' || phone."compact_phone"
            ELSE NULL
        END AS "canonical_phone"
    FROM compacted_staff_phone phone
),
normalized_staff_phone AS (
    SELECT
        phone."user_id",
        CASE
            WHEN phone."canonical_phone" ~
                    '^\+[1-9][0-9]{7,14}$'
                THEN phone."canonical_phone"
            ELSE NULL
        END AS "phone_normalized"
    FROM canonical_staff_phone phone
)
UPDATE "users" staff
SET
    "team_member_link_status" =
        CASE
            WHEN staff."business_id" IS NULL
                THEN 'REVIEW_REQUIRED'::"TeamMemberLinkStatus"
            WHEN phone."phone_normalized" IS NOT NULL
             AND EXISTS (
                SELECT 1
                FROM "employee_business_memberships"
                    other_membership
                WHERE
                    other_membership."phone_number_normalized" =
                        phone."phone_normalized"
                  AND other_membership."business_id" IS DISTINCT FROM
                        staff."business_id"
             )
                THEN 'REVIEW_REQUIRED'::"TeamMemberLinkStatus"
            ELSE 'UNLINKED'::"TeamMemberLinkStatus"
        END,
    "team_member_link_reason" =
        CASE
            WHEN staff."business_id" IS NULL THEN 'MISSING_BUSINESS'
            WHEN staff."whatsapp_phone" IS NULL
              OR btrim(staff."whatsapp_phone") = ''
                THEN 'MISSING_PHONE'
            WHEN phone."phone_normalized" IS NULL THEN 'INVALID_PHONE'
            WHEN EXISTS (
                SELECT 1
                FROM "employee_business_memberships"
                    other_membership
                WHERE
                    other_membership."phone_number_normalized" =
                        phone."phone_normalized"
                  AND other_membership."business_id" IS DISTINCT FROM
                        staff."business_id"
            )
                THEN 'CROSS_BUSINESS_PHONE_MATCH'
            ELSE 'NO_MATCH'
        END,
    "team_member_linked_at" = NULL
FROM normalized_staff_phone phone
WHERE staff."id" = phone."user_id";

-- One employment membership can have at most one linked User/Staff profile.
CREATE UNIQUE INDEX
    "users_employee_business_membership_id_key"
    ON "users"("employee_business_membership_id");

ALTER TABLE "users"
    ADD CONSTRAINT
        "users_employee_business_membership_id_fkey"
    FOREIGN KEY ("employee_business_membership_id")
    REFERENCES "employee_business_memberships"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
    ADD CONSTRAINT "users_team_member_link_state_check"
    CHECK (
        (
            "team_member_link_status" = 'LINKED'
            AND "employee_business_membership_id" IS NOT NULL
            AND "team_member_linked_at" IS NOT NULL
        )
        OR
        (
            "team_member_link_status" IN (
                'UNLINKED',
                'REVIEW_REQUIRED'
            )
            AND "employee_business_membership_id" IS NULL
            AND "team_member_linked_at" IS NULL
        )
    );

-- Deferred guards read the final row state at transaction commit. This keeps a
-- legitimate account relink possible before Attendance/Auth history exists,
-- while rejecting every final cross-Business or cross-account relationship.
CREATE FUNCTION "enforce_team_member_user_membership_scope"()
RETURNS trigger AS $$
DECLARE
    current_membership_id UUID;
    current_business_id UUID;
    current_employee_account_id UUID;
    membership_business_id UUID;
    membership_employee_account_id UUID;
BEGIN
    SELECT
        staff."employee_business_membership_id",
        staff."business_id",
        staff."employee_account_id"
    INTO
        current_membership_id,
        current_business_id,
        current_employee_account_id
    FROM "users" staff
    WHERE staff."id" = NEW."id";

    IF NOT FOUND OR current_membership_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT
        membership."business_id",
        membership."employee_account_id"
    INTO
        membership_business_id,
        membership_employee_account_id
    FROM "employee_business_memberships" membership
    WHERE membership."id" = current_membership_id;

    IF NOT FOUND
       OR current_business_id IS DISTINCT FROM
            membership_business_id
       OR current_employee_account_id IS DISTINCT FROM
            membership_employee_account_id THEN
        RAISE EXCEPTION
            'Team member User and Employee Membership scope mismatch';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "enforce_team_member_membership_user_scope"()
RETURNS trigger AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "employee_business_memberships" membership
        JOIN "users" staff
          ON staff."employee_business_membership_id" =
                membership."id"
        WHERE membership."id" = NEW."id"
          AND (
              staff."business_id" IS DISTINCT FROM
                    membership."business_id"
              OR staff."employee_account_id" IS DISTINCT FROM
                    membership."employee_account_id"
          )
    ) THEN
        RAISE EXCEPTION
            'Employee Membership and team member User scope mismatch';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER
    "users_team_member_membership_scope_guard"
    AFTER INSERT OR UPDATE ON "users"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION
        "enforce_team_member_user_membership_scope"();

CREATE CONSTRAINT TRIGGER
    "employee_memberships_team_member_user_scope_guard"
    AFTER INSERT OR UPDATE ON "employee_business_memberships"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION
        "enforce_team_member_membership_user_scope"();

COMMIT;
