BEGIN;

-- Add provider-owned verification metadata without rewriting or deleting
-- legacy Employee OTP rows. Twilio Verify and the test provider never persist
-- an OTP code or OTP hash in Tetamu.
ALTER TABLE "employee_otp_challenges"
    ALTER COLUMN "otp_hash" DROP NOT NULL,
    ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'legacy_local',
    ADD COLUMN "delivery_channel" TEXT NOT NULL DEFAULT 'local',
    ADD COLUMN "provider_reference" TEXT,
    ADD COLUMN "delivery_accepted_at" TIMESTAMP(3),
    ADD COLUMN "verification_attempt_id" UUID,
    ADD COLUMN "verification_started_at" TIMESTAMP(3);

ALTER TABLE "employee_otp_challenges"
    DROP CONSTRAINT IF EXISTS "employee_otp_challenges_hash_check",
    ADD CONSTRAINT "employee_otp_challenges_hash_check"
        CHECK ("otp_hash" IS NULL OR char_length("otp_hash") >= 32),
    ADD CONSTRAINT "employee_otp_challenges_provider_check"
        CHECK (
            ("provider" = 'legacy_local' AND "delivery_channel" = 'local' AND "otp_hash" IS NOT NULL)
            OR ("provider" = 'mock' AND "delivery_channel" = 'local' AND "otp_hash" IS NULL)
            OR ("provider" = 'twilio_verify' AND "delivery_channel" = 'sms' AND "otp_hash" IS NULL)
        ),
    ADD CONSTRAINT "employee_otp_challenges_delivery_state_check"
        CHECK (
            ("provider_reference" IS NULL AND "delivery_accepted_at" IS NULL)
            OR ("provider_reference" IS NOT NULL AND "delivery_accepted_at" IS NOT NULL)
        ),
    ADD CONSTRAINT "employee_otp_challenges_verification_claim_check"
        CHECK (
            ("verification_attempt_id" IS NULL AND "verification_started_at" IS NULL)
            OR ("verification_attempt_id" IS NOT NULL AND "verification_started_at" IS NOT NULL)
        );

CREATE UNIQUE INDEX "employee_otp_challenges_provider_reference_key"
    ON "employee_otp_challenges"("provider", "provider_reference")
    WHERE "provider_reference" IS NOT NULL;

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
