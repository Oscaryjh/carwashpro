import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import {
  ACTIVATE_STATUTORY_RULESET,
  SIGN_OFF_STATUTORY_RULESET,
} from "@/lib/payroll/statutory-activation-service";
import {
  REVIEW_STATUTORY_CLASSIFICATION,
} from "@/lib/payroll/statutory-governance-service";
import {
  STATUTORY_REVIEW_CHECKLIST,
  STATUTORY_REVIEW_CHECKLIST_VERSION,
} from "@/lib/payroll/statutory-human-review";
import { getStatutoryActivationReadiness } from "@/lib/payroll/statutory-readiness-service";
import {
  statutoryHumanSignOffReadiness,
  statutoryReviewerMfaLabel,
} from "@/lib/payroll/statutory-review-ui-readiness";
import { prisma } from "@/lib/prisma";
import {
  activateStatutoryRuleAction,
  completeStatutoryHumanReviewAction,
  reviewStatutoryClassificationAction,
  signOffStatutoryRuleAction,
} from "../actions";

type Props = {
  params: Promise<{ ruleSetId: string }>;
  searchParams: Promise<{ result?: string; error?: string; stepUp?: string }>;
};

export default async function RuleSetReviewPage({ params, searchParams }: Props) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const { ruleSetId } = await params;
  const messages = await searchParams;
  if (!user.sessionId) throw new Error("MFA_REQUIRED");
  const mfa = await getMfaSecurityState({ userId: user.userId, sessionId: user.sessionId });
  const exists = await prisma.statutoryRuleSet.findUnique({
    where: { id: ruleSetId }, select: { id: true },
  });
  if (!exists) notFound();
  const readiness = await getStatutoryActivationReadiness(ruleSetId);
  const { rule, evidenceDigest, layers } = readiness;
  const unknown = rule.classifications.filter((item) => item.treatment === "UNKNOWN");
  const latestDecision = new Map<string, (typeof rule.reviewDecisions)[number]>();
  for (const decision of rule.reviewDecisions) {
    const current = latestDecision.get(decision.classificationId);
    if (!current || current.decisionRevision < decision.decisionRevision) {
      latestDecision.set(decision.classificationId, decision);
    }
  }
  const canReview = user.permissions.includes(REVIEW_STATUTORY_CLASSIFICATION);
  const canSign = user.permissions.includes(SIGN_OFF_STATUTORY_RULESET);
  const canActivate = user.permissions.includes(ACTIVATE_STATUTORY_RULESET);
  const everyUnknownReviewed = unknown.every((item) => latestDecision.has(item.id));
  const humanSignOffReadiness = statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: layers.stepUp,
    reviewerMfaStatus: mfa.status,
    reviewerCanSign: canSign,
    humanReviewStatus: rule.humanReviewStatus,
    signOffExecuted: layers.humanSignOff === "EXECUTED",
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div>
          <p><Link href="/admin/statutory/rulesets">Statutory rules</Link></p>
          <h1>{rule.scheme} · {rule.version}</h1>
          <p>Engineering evidence, human classification review, sign-off, step-up and activation are separate governance layers.</p>
        </div></div>
        {messages.result ? <div className="panel"><strong>{messages.result}</strong></div> : null}
        {messages.error ? <div className="panel"><strong>{messages.error}</strong></div> : null}

        <div className="panel">
          <h2>Governance status</h2>
          <table className="table"><tbody>
            <tr><th>Engineering</th><td>{layers.engineering}</td></tr>
            <tr><th>Evidence</th><td>{layers.evidence}</td></tr>
            <tr><th>Canonical RuleSet</th><td>{layers.canonicalRuleSet}</td></tr>
            <tr><th>UNKNOWN review</th><td>{layers.unknownReview}</td></tr>
            <tr><th>Human sign-off</th><td>{layers.humanSignOff}</td></tr>
            <tr><th>MFA Step-up Infrastructure</th><td>{layers.stepUp}</td></tr>
            <tr><th>Reviewer MFA Enrollment</th><td>{statutoryReviewerMfaLabel(mfa.status)}</td></tr>
            <tr><th>Human Sign-off Readiness</th><td><code>{humanSignOffReadiness}</code></td></tr>
            <tr><th>Activation</th><td>{layers.activation}</td></tr>
          </tbody></table>
          <p className="muted">A registered candidate is not signed off and is not active. True TOTP MFA is available, but enrollment is personal and every sensitive action still requires a recent scoped verification.</p>
          <p>Resource-bound step-up assertion: <strong>{messages.stepUp === "READY" ? "READY FOR THIS RESOURCE" : "REQUIRED"}</strong></p>
        </div>

        <div className="panel">
          <h2>Exact immutable revision</h2>
          <dl>
            <dt>RuleSet ID</dt><dd><code>{rule.id}</code></dd>
            <dt>Lifecycle / engineering</dt><dd>{rule.status} / {rule.readiness}</dd>
            <dt>Human review revision</dt><dd>{rule.humanReviewRevision}</dd>
            <dt>Effective period</dt><dd>{dateOnly(rule.effectiveFrom)} – {rule.effectiveTo ? dateOnly(rule.effectiveTo) : "open"}</dd>
            <dt>Publisher / source</dt><dd>{rule.authority} · {rule.sourceDocumentName}</dd>
            <dt>Artifact SHA-256</dt><dd><code>{rule.sourceDigest ?? "MISSING"}</code></dd>
            <dt>Dataset</dt><dd>{rule.datasetRowCount ?? 0} rows · <code>{rule.datasetDigest ?? "MISSING"}</code></dd>
            <dt>Parser</dt><dd>{rule.parserName ?? "—"} {rule.parserVersion ?? "—"}</dd>
            <dt>Calculator</dt><dd>{rule.calculatorVersion ?? "—"}</dd>
            <dt>Classification</dt><dd>{rule.classificationVersion ?? "—"} · {rule.classifications.length} records · {unknown.length} base UNKNOWN</dd>
            <dt>Human classification digest</dt><dd><code>{rule.humanClassificationDigest ?? "NOT_RECORDED"}</code></dd>
            <dt>Current evidence digest</dt><dd><code>{evidenceDigest}</code></dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Activation readiness</h2>
          <p><strong>{readiness.status}</strong></p>
          {readiness.blockers.length
            ? <ul>{readiness.blockers.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
            : <p>No blockers.</p>}
          {readiness.conditionalRuntimeBlockers.length
            ? <p>Conditional fail-closed components: <code>{readiness.conditionalRuntimeBlockers.join(", ")}</code></p>
            : null}
        </div>

        <div className="panel">
          <h2>UNKNOWN classification review</h2>
          <p>Each decision is append-only, attributed to the authenticated human reviewer, and bound to this exact evidence digest. “Keep UNKNOWN” never silently becomes included or excluded.</p>
          {unknown.length ? unknown.map((item) => {
            const decision = latestDecision.get(item.id);
            return (
              <article key={item.id} style={{ borderTop: "1px solid var(--border)", padding: "1rem 0" }}>
                <h3>{item.componentCode}</h3>
                <p>{item.rationale}</p>
                <p><strong>Official/evidence reference:</strong> {item.authorityRef}</p>
                <p><strong>Current human decision:</strong> {decision ? `${decision.decision} · ${decision.blockingScope}` : "PENDING"}</p>
                {decision ? <p className="muted">Revision {decision.decisionRevision} by {decision.reviewerUserId}: {decision.reason}</p> : null}
                {rule.humanReviewStatus !== "COMPLETED" ? (
                  <form action={reviewStatutoryClassificationAction}>
                    <input type="hidden" name="ruleSetId" value={rule.id}/>
                    <input type="hidden" name="classificationId" value={item.id}/>
                    <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
                    <input type="hidden" name="expectedReviewRevision" value={rule.humanReviewRevision}/>
                    <label>Decision
                      <select name="decision" required defaultValue="">
                        <option value="" disabled>Select one exact decision</option>
                        <option value="INCLUDED">Included</option>
                        <option value="EXCLUDED">Excluded</option>
                        <option value="KEEP_UNKNOWN">Keep UNKNOWN (fail closed)</option>
                      </select>
                    </label>
                    <label>Evidence reference<input name="evidenceReference" required minLength={5}/></label>
                    <label>Decision reason<textarea name="reason" required minLength={10}/></label>
                    <button disabled={!canReview}>Record immutable decision</button>
                  </form>
                ) : null}
              </article>
            );
          }) : <p>No base UNKNOWN classifications.</p>}
          {rule.humanReviewStatus === "IN_PROGRESS" ? (
            <form action={completeStatutoryHumanReviewAction}>
              <input type="hidden" name="ruleSetId" value={rule.id}/>
              <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
              <input type="hidden" name="expectedReviewRevision" value={rule.humanReviewRevision}/>
              <label>Completion reason<textarea name="reason" required minLength={10}/></label>
              <button disabled={!canReview || !everyUnknownReviewed}>Complete UNKNOWN review</button>
            </form>
          ) : null}
        </div>

        <div className="panel">
          <h2>Human sign-off</h2>
          <p>Requires <code>{SIGN_OFF_STATUTORY_RULESET}</code>, a completed classification review, and a genuine step-up authentication assertion.</p>
          {mfa.status === "ENROLLED" ? (
            <Link href={mfaChallengeHref("STATUTORY_RULESET_SIGNOFF", rule.id, evidenceDigest)}>
              Perform MFA step-up for this exact RuleSet
            </Link>
          ) : <Link href="/security/mfa">Enroll personal TOTP MFA first</Link>}
          <form action={signOffStatutoryRuleAction}>
            <input type="hidden" name="ruleSetId" value={rule.id}/>
            <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
            <input type="hidden" name="reviewChecklistVersion" value={STATUTORY_REVIEW_CHECKLIST_VERSION}/>
            <fieldset disabled={layers.stepUp === "BLOCKED"}>
              <legend>Human review checklist</legend>
              {STATUTORY_REVIEW_CHECKLIST.map((item) => (
                <label key={item.id} style={{ display: "block", marginBottom: "0.5rem" }}>
                  <input type="checkbox" name={`reviewChecklist.${item.id}`} value="confirmed" required/> {item.label}
                </label>
              ))}
            </fieldset>
            <label>Review reason / note<textarea name="reason" required minLength={10}/></label>
            <button disabled={!canSign || layers.unknownReview !== "COMPLETE" || layers.stepUp === "BLOCKED" || messages.stepUp !== "READY"}>Sign off reviewed revision</button>
          </form>
          {layers.stepUp === "BLOCKED" ? <p><code>STATUTORY_STEP_UP_AUTH_NOT_READY</code> · <code>BLOCKED_TRUE_MFA</code></p> : null}
        </div>

        <div className="panel">
          <h2>Controlled activation</h2>
          <p>Requires <code>{ACTIVATE_STATUTORY_RULESET}</code>, a separate human actor, unchanged evidence and a separate genuine step-up assertion.</p>
          {mfa.status === "ENROLLED" ? (
            <Link href={mfaChallengeHref("STATUTORY_RULESET_ACTIVATE", rule.id, evidenceDigest)}>
              Perform separate Activator MFA step-up
            </Link>
          ) : null}
          <form action={activateStatutoryRuleAction}>
            <input type="hidden" name="ruleSetId" value={rule.id}/>
            <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
            <label>Activation reason<textarea name="reason" required minLength={10}/></label>
            <button disabled={!canActivate || rule.status !== "HUMAN_SIGNED_OFF" || layers.stepUp === "BLOCKED" || messages.stepUp !== "READY"}>Activate exact revision</button>
          </form>
          <p><strong>Activation remains NOT ACTIVE.</strong></p>
        </div>
      </section>
    </AppShell>
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function mfaChallengeHref(
  action: "STATUTORY_RULESET_SIGNOFF" | "STATUTORY_RULESET_ACTIVATE",
  ruleSetId: string,
  evidenceDigest: string,
) {
  const params = new URLSearchParams({
    action,
    resourceId: ruleSetId,
    requestFingerprint: evidenceDigest,
    returnTo: `/admin/statutory/rulesets/${ruleSetId}`,
  });
  return `/admin/security/sensitive-actions?${params.toString()}`;
}
