BEGIN;

-- Twilio Verify may reuse one Verification SID for resend attempts within its
-- provider lifecycle. Tetamu challenge identity and invalidation remain the
-- replay boundary, so the provider reference is indexed but not globally unique.
DROP INDEX IF EXISTS "employee_otp_challenges_provider_reference_key";
CREATE INDEX "employee_otp_challenges_provider_reference_idx"
    ON "employee_otp_challenges"("provider", "provider_reference")
    WHERE "provider_reference" IS NOT NULL;

COMMIT;
