CREATE TABLE "sensitive_action_authorizations" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "auth_session_id" UUID NOT NULL,
    "business_id" UUID,
    "action_key" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "verification_method" TEXT NOT NULL,
    "assurance_level" TEXT NOT NULL,
    "request_fingerprint" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sensitive_action_authorizations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sensitive_action_authorizations_expiry_check"
      CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "sensitive_action_authorizations_resource_pair_check"
      CHECK (("resource_type" IS NULL) = ("resource_id" IS NULL)),
    CONSTRAINT "sensitive_action_authorizations_method_check"
      CHECK ("verification_method" IN ('PASSWORD_REAUTH', 'TOTP', 'PASSKEY')),
    CONSTRAINT "sensitive_action_authorizations_assurance_check"
      CHECK ("assurance_level" IN ('REAUTH', 'MFA'))
);

CREATE UNIQUE INDEX "sensitive_action_authorizations_token_hash_key"
  ON "sensitive_action_authorizations"("token_hash");
CREATE INDEX "sensitive_action_authorizations_user_action_idx"
  ON "sensitive_action_authorizations"("user_id", "action_key", "expires_at");
CREATE INDEX "sensitive_action_authorizations_session_state_idx"
  ON "sensitive_action_authorizations"("auth_session_id", "consumed_at", "revoked_at", "expires_at");
CREATE INDEX "sensitive_action_authorizations_business_action_idx"
  ON "sensitive_action_authorizations"("business_id", "action_key", "expires_at");

ALTER TABLE "sensitive_action_authorizations"
  ADD CONSTRAINT "sensitive_action_authorizations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sensitive_action_authorizations"
  ADD CONSTRAINT "sensitive_action_authorizations_auth_session_id_fkey"
  FOREIGN KEY ("auth_session_id") REFERENCES "auth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
