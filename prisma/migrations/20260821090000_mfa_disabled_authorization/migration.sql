ALTER TABLE "sensitive_action_authorizations"
  DROP CONSTRAINT "sensitive_action_authorizations_method_check";

ALTER TABLE "sensitive_action_authorizations"
  ADD CONSTRAINT "sensitive_action_authorizations_method_check"
  CHECK (
    "verification_method" IN (
      'PASSWORD_REAUTH',
      'TOTP',
      'RECOVERY_CODE',
      'PASSKEY',
      'MFA_TEMPORARILY_DISABLED'
    )
  );
