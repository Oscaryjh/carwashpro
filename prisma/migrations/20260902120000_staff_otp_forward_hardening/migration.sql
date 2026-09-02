BEGIN;

-- Forward-only reconciliation from the canonical Railway Testing schema.
-- Historical challenges legitimately have no provider message code, so the
-- column remains nullable and no synthetic backfill is performed.
ALTER TABLE "employee_otp_challenges"
    ADD COLUMN IF NOT EXISTS "provider_message_code" TEXT;

ALTER TABLE "employee_otp_challenges"
    DROP CONSTRAINT IF EXISTS "employee_otp_challenges_provider_message_code_check",
    ADD CONSTRAINT "employee_otp_challenges_provider_message_code_check"
        CHECK (
            "provider_message_code" IS NULL
            OR (
                "provider_reference" IS NOT NULL
                AND "delivery_accepted_at" IS NOT NULL
                AND char_length("provider_message_code") BETWEEN 1 AND 64
            )
        ) NOT VALID;

ALTER TABLE "employee_otp_challenges"
    VALIDATE CONSTRAINT "employee_otp_challenges_provider_message_code_check";

-- Preserve the existing Testing lifecycle contract and extend it only with
-- provider-message insert/immutability guards. Provider and mock behavior,
-- phone-wide invalidation, existing triggers, and accepted provider values are
-- intentionally unchanged.
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
        RAISE EXCEPTION 'Employee OTP challenge account scope mismatch';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."attempts" <> 0
           OR NEW."verified_at" IS NOT NULL
           OR NEW."invalidated_at" IS NOT NULL
           OR NEW."provider_reference" IS NOT NULL
           OR NEW."provider_message_code" IS NOT NULL
           OR NEW."delivery_accepted_at" IS NOT NULL
           OR NEW."verification_attempt_id" IS NOT NULL
           OR NEW."verification_started_at" IS NOT NULL THEN
            RAISE EXCEPTION 'New Employee OTP challenge must be unused';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."employee_account_id" IS DISTINCT FROM OLD."employee_account_id"
       OR NEW."phone_number_normalized" IS DISTINCT FROM OLD."phone_number_normalized"
       OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
       OR NEW."otp_hash" IS DISTINCT FROM OLD."otp_hash"
       OR NEW."provider" IS DISTINCT FROM OLD."provider"
       OR NEW."delivery_channel" IS DISTINCT FROM OLD."delivery_channel"
       OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
       OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
       OR NEW."resend_available_at" IS DISTINCT FROM OLD."resend_available_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
        RAISE EXCEPTION 'Employee OTP challenge identity is immutable';
    END IF;

    IF OLD."provider_reference" IS NOT NULL
       AND NEW."provider_reference" IS DISTINCT FROM OLD."provider_reference" THEN
        RAISE EXCEPTION 'Employee OTP provider reference is immutable';
    END IF;

    IF OLD."provider_message_code" IS NOT NULL
       AND NEW."provider_message_code" IS DISTINCT FROM OLD."provider_message_code" THEN
        RAISE EXCEPTION 'Employee OTP provider message code is immutable';
    END IF;

    IF OLD."delivery_accepted_at" IS NOT NULL
       AND NEW."delivery_accepted_at" IS DISTINCT FROM OLD."delivery_accepted_at" THEN
        RAISE EXCEPTION 'Employee OTP delivery acceptance is immutable';
    END IF;

    IF NEW."attempts" < OLD."attempts" THEN
        RAISE EXCEPTION 'Employee OTP challenge attempts cannot decrease';
    END IF;

    IF OLD."verified_at" IS NOT NULL
       AND (
           NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
           OR NEW."attempts" IS DISTINCT FROM OLD."attempts"
           OR NEW."verification_attempt_id" IS DISTINCT FROM OLD."verification_attempt_id"
           OR NEW."verification_started_at" IS DISTINCT FROM OLD."verification_started_at"
       ) THEN
        RAISE EXCEPTION 'Employee OTP challenge was already used';
    END IF;

    IF OLD."invalidated_at" IS NOT NULL
       AND (
           NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
           OR NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at"
           OR NEW."attempts" IS DISTINCT FROM OLD."attempts"
           OR NEW."verification_attempt_id" IS DISTINCT FROM OLD."verification_attempt_id"
           OR NEW."verification_started_at" IS DISTINCT FROM OLD."verification_started_at"
       ) THEN
        RAISE EXCEPTION 'Employee OTP challenge was invalidated';
    END IF;

    IF NEW."verified_at" IS DISTINCT FROM OLD."verified_at"
       AND (
           OLD."verified_at" IS NOT NULL
           OR OLD."invalidated_at" IS NOT NULL
           OR OLD."expires_at" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
           OR OLD."attempts" >= OLD."max_attempts"
       ) THEN
        RAISE EXCEPTION 'Employee OTP challenge cannot be verified';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
