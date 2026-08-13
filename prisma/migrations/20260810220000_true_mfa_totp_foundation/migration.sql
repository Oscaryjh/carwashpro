CREATE TYPE "UserMfaCredentialType" AS ENUM ('TOTP');
CREATE TYPE "UserMfaCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

CREATE TABLE "user_mfa_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "UserMfaCredentialType" NOT NULL DEFAULT 'TOTP',
    "status" "UserMfaCredentialStatus" NOT NULL DEFAULT 'PENDING',
    "encrypted_secret" BYTEA NOT NULL,
    "secret_iv" BYTEA NOT NULL,
    "secret_auth_tag" BYTEA NOT NULL,
    "encryption_key_version" VARCHAR(40) NOT NULL,
    "algorithm" VARCHAR(16) NOT NULL DEFAULT 'SHA1',
    "digits" INTEGER NOT NULL DEFAULT 6,
    "period_seconds" INTEGER NOT NULL DEFAULT 30,
    "enrollment_session_id" UUID,
    "pending_expires_at" TIMESTAMP(3),
    "enrolled_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "last_accepted_counter" BIGINT,
    "recovery_version" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mfa_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_mfa_credentials_algorithm_check" CHECK ("algorithm" = 'SHA1'),
    CONSTRAINT "user_mfa_credentials_digits_check" CHECK ("digits" = 6),
    CONSTRAINT "user_mfa_credentials_period_check" CHECK ("period_seconds" = 30),
    CONSTRAINT "user_mfa_credentials_iv_check" CHECK (octet_length("secret_iv") = 12),
    CONSTRAINT "user_mfa_credentials_auth_tag_check" CHECK (octet_length("secret_auth_tag") = 16),
    CONSTRAINT "user_mfa_credentials_counter_check" CHECK ("last_accepted_counter" IS NULL OR "last_accepted_counter" >= 0),
    CONSTRAINT "user_mfa_credentials_recovery_version_check" CHECK ("recovery_version" >= 0),
    CONSTRAINT "user_mfa_credentials_state_check" CHECK (
      ("status" = 'PENDING' AND "enrollment_session_id" IS NOT NULL AND "pending_expires_at" IS NOT NULL AND "enrolled_at" IS NULL AND "revoked_at" IS NULL)
      OR ("status" = 'ACTIVE' AND "enrolled_at" IS NOT NULL AND "verified_at" IS NOT NULL AND "pending_expires_at" IS NULL AND "revoked_at" IS NULL)
      OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
    )
);

CREATE TABLE "user_mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "user_mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_mfa_recovery_codes_generation_check" CHECK ("generation" > 0),
    CONSTRAINT "user_mfa_recovery_codes_ordinal_check" CHECK ("ordinal" BETWEEN 1 AND 10),
    CONSTRAINT "user_mfa_recovery_codes_state_check" CHECK (NOT ("consumed_at" IS NOT NULL AND "revoked_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "user_mfa_credentials_one_active_totp_per_user"
  ON "user_mfa_credentials"("user_id", "type") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "user_mfa_credentials_one_pending_totp_per_user"
  ON "user_mfa_credentials"("user_id", "type") WHERE "status" = 'PENDING';
CREATE INDEX "user_mfa_credentials_user_type_status_idx"
  ON "user_mfa_credentials"("user_id", "type", "status");
CREATE INDEX "user_mfa_credentials_enrollment_session_idx"
  ON "user_mfa_credentials"("enrollment_session_id", "status", "pending_expires_at");
CREATE UNIQUE INDEX "user_mfa_recovery_codes_generation_ordinal_key"
  ON "user_mfa_recovery_codes"("credential_id", "generation", "ordinal");
CREATE INDEX "user_mfa_recovery_codes_credential_state_idx"
  ON "user_mfa_recovery_codes"("credential_id", "consumed_at", "revoked_at");

ALTER TABLE "user_mfa_credentials"
  ADD CONSTRAINT "user_mfa_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_mfa_credentials"
  ADD CONSTRAINT "user_mfa_credentials_enrollment_session_id_fkey"
  FOREIGN KEY ("enrollment_session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_mfa_recovery_codes"
  ADD CONSTRAINT "user_mfa_recovery_codes_credential_id_fkey"
  FOREIGN KEY ("credential_id") REFERENCES "user_mfa_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sensitive_action_authorizations"
  DROP CONSTRAINT "sensitive_action_authorizations_method_check";
ALTER TABLE "sensitive_action_authorizations"
  ADD CONSTRAINT "sensitive_action_authorizations_method_check"
  CHECK ("verification_method" IN ('PASSWORD_REAUTH', 'TOTP', 'RECOVERY_CODE', 'PASSKEY'));
