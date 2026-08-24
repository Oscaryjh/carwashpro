import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";

export function PayrollHighRiskMfaFields({
  actionLabel,
}: {
  actionLabel: string;
}) {
  if (!isMfaFeatureEnabled()) return null;

  return (
    <fieldset>
      <legend>MFA required · {actionLabel}</legend>
      <p>
        This verification is bound to this exact action and resource, expires
        after five minutes and can be consumed only once.
      </p>
      <label>
        <span>Current password</span>
        <input
          autoComplete="current-password"
          maxLength={256}
          name="stepUpPassword"
          required
          type="password"
        />
      </label>
      <label>
        <span>MFA factor</span>
        <select defaultValue="TOTP" name="stepUpFactorType">
          <option value="TOTP">Authenticator code</option>
          <option value="RECOVERY_CODE">Recovery code</option>
        </select>
      </label>
      <label>
        <span>Authenticator or recovery code</span>
        <input
          autoComplete="one-time-code"
          maxLength={64}
          name="stepUpCode"
          required
        />
      </label>
      <small>Use the authenticator or recovery code enrolled for this account.</small>
    </fieldset>
  );
}
