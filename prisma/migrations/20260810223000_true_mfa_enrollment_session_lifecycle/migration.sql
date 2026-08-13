ALTER TABLE "user_mfa_credentials"
  DROP CONSTRAINT "user_mfa_credentials_enrollment_session_id_fkey";

UPDATE "user_mfa_credentials"
SET "enrollment_session_id" = NULL
WHERE "status" IN ('ACTIVE', 'REVOKED');

ALTER TABLE "user_mfa_credentials"
  DROP CONSTRAINT "user_mfa_credentials_state_check";

ALTER TABLE "user_mfa_credentials"
  ADD CONSTRAINT "user_mfa_credentials_state_check" CHECK (
    ("status" = 'PENDING' AND "enrollment_session_id" IS NOT NULL AND "pending_expires_at" IS NOT NULL AND "enrolled_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'ACTIVE' AND "enrollment_session_id" IS NULL AND "enrolled_at" IS NOT NULL AND "verified_at" IS NOT NULL AND "pending_expires_at" IS NULL AND "revoked_at" IS NULL)
    OR ("status" = 'REVOKED' AND "enrollment_session_id" IS NULL AND "revoked_at" IS NOT NULL)
  );

ALTER TABLE "user_mfa_credentials"
  ADD CONSTRAINT "user_mfa_credentials_enrollment_session_id_fkey"
  FOREIGN KEY ("enrollment_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
