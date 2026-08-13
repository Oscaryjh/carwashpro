"use client";

import Image from "next/image";
import { useActionState } from "react";
import {
  completeMfaEnrollmentAction,
  disableMfaAction,
  regenerateRecoveryCodesAction,
  startMfaEnrollmentAction,
} from "./actions";

const INITIAL_MFA_ACTION_STATE = {
  status: "IDLE" as const,
  message: null,
  recoveryCodes: [] as readonly string[],
};

type Props = Readonly<{
  state:
    | {
        status: "NOT_ENROLLED";
        pending: null;
      }
    | {
        status: "PENDING";
        pending: {
          credentialId: string;
          expiresAt: string;
          manualSecret: string;
          qrDataUrl: string;
        };
      }
    | {
        status: "ENROLLED";
        pending: null;
        enrolledAt: string | null;
        recoveryCodesAvailable: number;
      };
}>;

export function MfaClient({ state }: Props) {
  const [completion, completeAction, completing] = useActionState(
    completeMfaEnrollmentAction,
    INITIAL_MFA_ACTION_STATE,
  );
  const [regeneration, regenerateAction, regenerating] = useActionState(
    regenerateRecoveryCodesAction,
    INITIAL_MFA_ACTION_STATE,
  );
  const shownCodes =
    completion.recoveryCodes.length > 0
      ? completion.recoveryCodes
      : regeneration.recoveryCodes;

  if (shownCodes.length > 0) {
    return (
      <div className="panel" data-testid="recovery-codes">
        <h2>Save your recovery codes now</h2>
        <p>Each code works once. They cannot be shown again after you leave this page.</p>
        <ol>
          {shownCodes.map((code) => (
            <li key={code}><code>{code}</code></li>
          ))}
        </ol>
        <a href="/security/mfa">I have saved these codes</a>
      </div>
    );
  }

  if (state.status === "NOT_ENROLLED") {
    return (
      <div className="panel">
        <h2>Enable authenticator app</h2>
        <p>Confirm your current password before Tetamu creates a pending TOTP enrollment.</p>
        <form action={startMfaEnrollmentAction}>
          <label>Current password
            <input name="password" type="password" autoComplete="current-password" required maxLength={256}/>
          </label>
          <button type="submit">Start MFA enrollment</button>
        </form>
      </div>
    );
  }

  if (state.status === "PENDING") {
    return (
      <div className="panel">
        <h2>Scan and verify</h2>
        <p>This pending enrollment expires at {state.pending.expiresAt}. It is not active until a valid TOTP is verified.</p>
        <Image
          src={state.pending.qrDataUrl}
          alt="Tetamu TOTP enrollment QR code"
          width={240}
          height={240}
          unoptimized
          data-testid="mfa-qr"
        />
        <p>Manual key: <code data-testid="mfa-manual-secret">{state.pending.manualSecret}</code></p>
        <form action={completeAction}>
          <input type="hidden" name="credentialId" value={state.pending.credentialId}/>
          <label>Authenticator code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6}/>
          </label>
          <button type="submit" disabled={completing}>Verify and enable MFA</button>
        </form>
        {completion.status === "ERROR" ? <p data-testid="mfa-error"><code>{completion.message}</code></p> : null}
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h2>MFA enrolled</h2>
        <dl>
          <dt>Method</dt><dd>TOTP authenticator app</dd>
          <dt>Enrolled</dt><dd>{state.enrolledAt ?? "Recorded"}</dd>
          <dt>Unused recovery codes</dt><dd data-testid="recovery-count">{state.recoveryCodesAvailable}</dd>
        </dl>
      </div>
      <div className="panel">
        <h2>Regenerate recovery codes</h2>
        <p>Current password plus a current TOTP or unused recovery code is required. All old unused codes are revoked.</p>
        <form action={regenerateAction}>
          <FactorFields/>
          <button type="submit" disabled={regenerating}>Regenerate codes</button>
        </form>
        {regeneration.status === "ERROR" ? <p><code>{regeneration.message}</code></p> : null}
      </div>
      <div className="panel">
        <h2>Disable MFA</h2>
        <p>Disabling MFA revokes current sensitive authorizations. Administrator reset is not supported.</p>
        <form action={disableMfaAction}>
          <FactorFields/>
          <button type="submit">Disable MFA</button>
        </form>
      </div>
    </>
  );
}

function FactorFields() {
  return (
    <>
      <label>Current password
        <input name="password" type="password" autoComplete="current-password" required maxLength={256}/>
      </label>
      <label>Second factor
        <select name="factorType" defaultValue="TOTP">
          <option value="TOTP">Authenticator code</option>
          <option value="RECOVERY_CODE">Recovery code</option>
        </select>
      </label>
      <label>Code
        <input name="code" autoComplete="one-time-code" required maxLength={64}/>
      </label>
    </>
  );
}
