BEGIN;

-- SMS123 is a delivery gateway. Tetamu generates the OTP and stores only a
-- keyed hash; the plaintext code never persists in the database.
ALTER TABLE "employee_otp_challenges"
    DROP CONSTRAINT IF EXISTS "employee_otp_challenges_provider_check",
    ADD CONSTRAINT "employee_otp_challenges_provider_check"
        CHECK (
            ("provider" = 'legacy_local' AND "delivery_channel" = 'local' AND "otp_hash" IS NOT NULL)
            -- Preserve both generations of non-production mock challenges:
            -- older rows stored a hash, while current provider-owned mock rows do not.
            OR ("provider" = 'mock' AND "delivery_channel" = 'local')
            OR ("provider" = 'twilio_verify' AND "delivery_channel" = 'sms' AND "otp_hash" IS NULL)
            OR ("provider" = 'sms123' AND "delivery_channel" = 'sms' AND "otp_hash" IS NOT NULL)
        );

COMMIT;
