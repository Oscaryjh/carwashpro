import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import { requireUser } from "@/lib/auth/session";
import {
  assertSensitiveActionAccessPreconditions,
  getSensitiveActionPolicy,
  isSensitiveActionKey,
  TRUE_MFA_CAPABILITY,
  type SensitiveActionKey,
} from "@/lib/auth/sensitive-actions";
import {
  consumeQaSensitiveAction,
  verifyQaSensitiveAction,
} from "./actions";

type Props = {
  searchParams: Promise<{
    action?: string;
    resourceId?: string;
    requestFingerprint?: string;
    returnTo?: string;
    result?: string;
    error?: string;
  }>;
};

const SUPPORTED_ACTIONS = new Set<SensitiveActionKey>([
  "QA_SENSITIVE_ACTION",
  "STATUTORY_RULESET_SIGNOFF",
  "STATUTORY_RULESET_ACTIVATE",
]);

export default async function SensitiveActionQaPage({ searchParams }: Props) {
  const user = await requireUser();
  if (user.role !== "PLATFORM_ADMIN" || !user.sessionId) redirect("/reports");
  const messages = await searchParams;
  if (!isMfaFeatureEnabled()) {
    const returnTo = messages.returnTo;
    redirect(returnTo?.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/admin/statutory/rulesets");
  }
  const requested = messages.action ?? "QA_SENSITIVE_ACTION";
  if (!isSensitiveActionKey(requested) || !SUPPORTED_ACTIONS.has(requested)) {
    redirect("/reports");
  }
  try {
    assertSensitiveActionAccessPreconditions({
      actionKey: requested,
      capabilities: user.permissions,
      enabledModules: new Set(),
    });
  } catch {
    redirect("/reports");
  }
  const policy = getSensitiveActionPolicy(requested);
  const resourceId = messages.resourceId ?? "local-testing-step-up-foundation";
  const requestFingerprint = messages.requestFingerprint ?? "";
  const returnTo = messages.returnTo ?? "";
  const mfa = await getMfaSecurityState({
    userId: user.userId,
    sessionId: user.sessionId,
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div>
          <p><Link href="/security/mfa">Account security</Link></p>
          <h1>Sensitive action verification</h1>
          <p>Local / Testing challenge for genuine password plus TOTP or recovery-code MFA.</p>
        </div></div>

        {messages.result ? <div className="panel"><strong data-testid="step-up-result">{messages.result}</strong></div> : null}
        {messages.error ? <div className="panel"><strong data-testid="step-up-error">{messages.error}</strong></div> : null}

        <div className="panel">
          <h2>Policy</h2>
          <dl>
            <dt>Action</dt><dd><code>{policy.actionKey}</code></dd>
            <dt>Assurance</dt><dd>{policy.requiredAssurance}</dd>
            <dt>Lifetime</dt><dd>{policy.ttlSeconds / 60} minutes</dd>
            <dt>Consumption</dt><dd>ONE_TIME</dd>
            <dt>Resource</dt><dd><code>{policy.resourceType}:{resourceId}</code></dd>
            <dt>True MFA capability</dt><dd>{TRUE_MFA_CAPABILITY.status}</dd>
            <dt>User MFA</dt><dd data-testid="mfa-enrollment-status">{mfa.status}</dd>
            {mfa.status === "ENROLLED" ? <><dt>Recovery codes available</dt><dd>{mfa.recoveryCodesAvailable}</dd></> : null}
          </dl>
        </div>

        {mfa.status !== "ENROLLED" ? (
          <div className="panel">
            <h2>MFA enrollment required</h2>
            <p><code>MFA_NOT_ENROLLED</code></p>
            <Link href="/security/mfa">Enroll a TOTP authenticator</Link>
          </div>
        ) : (
          <div className="panel">
            <h2>Additional verification required</h2>
            <p>The server verifies the current password and a current possession/recovery factor before issuing one scoped authorization.</p>
            <form action={verifyQaSensitiveAction}>
              <ChallengeFields
                actionKey={policy.actionKey}
                resourceId={resourceId}
                requestFingerprint={requestFingerprint}
                returnTo={returnTo}
              />
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
              <button type="submit">Verify MFA step-up</button>
            </form>
          </div>
        )}

        {messages.result === "VERIFIED" ? (
          <div className="panel">
            <h2>Scoped authorization ready</h2>
            <p>The opaque credential is in an HttpOnly SameSite cookie and can be consumed once by this exact action and resource.</p>
            <form action={consumeQaSensitiveAction}>
              <ChallengeFields
                actionKey={policy.actionKey}
                resourceId={resourceId}
                requestFingerprint={requestFingerprint}
                returnTo=""
              />
              <button type="submit">Validate scoped action precondition</button>
            </form>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}

function ChallengeFields(props: {
  actionKey: SensitiveActionKey;
  resourceId: string;
  requestFingerprint: string;
  returnTo: string;
}) {
  return (
    <>
      <input type="hidden" name="actionKey" value={props.actionKey}/>
      <input type="hidden" name="resourceId" value={props.resourceId}/>
      <input type="hidden" name="requestFingerprint" value={props.requestFingerprint}/>
      <input type="hidden" name="returnTo" value={props.returnTo}/>
    </>
  );
}
