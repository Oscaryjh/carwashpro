import Link from "next/link";

export function CommercialMfaFields({ label }: { label: string }) {
  return <fieldset className="commercial-mfa-fields">
    <legend>True TOTP MFA · {label}</legend>
    <p>This one-time authorization is bound to this exact billing action and record.</p>
    <label>Password<input type="password" name="stepUpPassword" autoComplete="current-password" maxLength={256} required /></label>
    <label>MFA factor<select name="stepUpFactorType" defaultValue="TOTP"><option value="TOTP">Authenticator code</option><option value="RECOVERY_CODE">Recovery code</option></select></label>
    <label>Authenticator or recovery code<input name="stepUpCode" autoComplete="one-time-code" maxLength={64} required /></label>
    <small>Not enrolled? <Link href="/security/mfa">Set up MFA</Link>.</small>
  </fieldset>;
}
