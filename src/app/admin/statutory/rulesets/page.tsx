import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { SIGN_OFF_STATUTORY_RULESET } from "@/lib/payroll/statutory-activation-service";
import { loadStatutoryHumanReviewPackages } from "@/lib/payroll/statutory-evidence-pack";
import { statutoryStepUpReadiness } from "@/lib/payroll/statutory-governance-service";
import {
  statutoryHumanSignOffReadiness,
  statutoryReviewerMfaLabel,
} from "@/lib/payroll/statutory-review-ui-readiness";

export default async function StatutoryRuleSetsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  if (!user.sessionId) throw new Error("MFA_REQUIRED");
  const [rules, evidencePacks, reviewerMfa] = await Promise.all([
    prisma.statutoryRuleSet.findMany({
      where: { NOT: { version: { startsWith: "TEST_" } } },
      include: {
        _count: { select: { classifications: true, signOffs: true, reviewDecisions: true } },
        signOffs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }, { recordedAt: "desc" }],
    }),
    loadStatutoryHumanReviewPackages(),
    getMfaSecurityState({ userId: user.userId, sessionId: user.sessionId }),
  ]);
  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header"><div>
          <h1>Statutory rule governance</h1>
          <p>Engineering evidence, human review, sign-off, step-up and activation are distinct states.</p>
        </div></div>

        <div className="panel">
          <h2>Official candidate matrix</h2>
          <p className="muted">Registration does not execute human sign-off and never activates a rule.</p>
          <table className="table">
            <thead><tr><th>Scheme</th><th>Engineering</th><th>Evidence</th><th>Canonical RuleSet</th><th>UNKNOWN review</th><th>Sign-off</th><th>MFA Step-up Infrastructure</th><th>Reviewer MFA Enrollment</th><th>Human Sign-off Readiness</th><th>Activation</th></tr></thead>
            <tbody>{evidencePacks.map((pack) => {
              const canonical = rules.find((rule) =>
                rule.scheme === pack.scheme && rule.version === pack.classification.version);
              const stepUpInfrastructureStatus = canonical
                ? statutoryStepUpReadiness(canonical).status
                : "BLOCKED";
              const signOffReadiness = canonical
                ? statutoryHumanSignOffReadiness({
                    stepUpInfrastructureStatus,
                    reviewerMfaStatus: reviewerMfa.status,
                    reviewerCanSign: user.permissions.includes(SIGN_OFF_STATUTORY_RULESET),
                    humanReviewStatus: canonical.humanReviewStatus,
                    signOffExecuted: canonical.signOffs[0]?.decision === "APPROVED",
                  })
                : "BLOCKED_CANONICAL_RULESET";
              return (
                <tr key={pack.scheme}>
                  <td><strong>{pack.scheme}</strong><br/><Link href={`/admin/statutory/review/${pack.scheme.toLowerCase()}`}>Evidence pack</Link></td>
                  <td>{pack.engineering}</td>
                  <td>{pack.evidencePack}</td>
                  <td>{canonical ? <Link href={`/admin/statutory/rulesets/${canonical.id}`}>REGISTERED</Link> : "BLOCKED"}</td>
                  <td>{canonical?.humanReviewStatus ?? "PENDING"}</td>
                  <td>{canonical?.signOffs[0]?.decision === "APPROVED" ? "EXECUTED" : "NOT EXECUTED"}</td>
                  <td>{stepUpInfrastructureStatus}</td>
                  <td>{reviewerMfa.status === "ENROLLED"
                    ? statutoryReviewerMfaLabel(reviewerMfa.status)
                    : <Link href="/security/mfa">{statutoryReviewerMfaLabel(reviewerMfa.status)}</Link>}</td>
                  <td><code>{signOffReadiness}</code></td>
                  <td>NOT ACTIVE</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Stored RuleSets</h2>
          <p className="muted">Platform rules only. Business entitlement never activates a statutory rule.</p>
          <table className="table">
            <thead><tr><th>Scheme</th><th>Version</th><th>Effective</th><th>Engineering</th><th>Human review</th><th>Decisions</th><th>Sign-offs</th><th>Activation</th><th /></tr></thead>
            <tbody>{rules.map((rule) => (
              <tr key={rule.id}>
                <td><strong>{rule.scheme}</strong></td>
                <td>{rule.version}</td>
                <td>{dateOnly(rule.effectiveFrom)} – {rule.effectiveTo ? dateOnly(rule.effectiveTo) : "open"}</td>
                <td>{rule.readiness}</td>
                <td>{rule.humanReviewStatus}</td>
                <td>{rule._count.reviewDecisions}</td>
                <td>{rule._count.signOffs}{rule.signOffs[0] ? ` (${rule.signOffs[0].decision})` : ""}</td>
                <td>{rule.status === "ACTIVE" ? "ACTIVE" : "NOT ACTIVE"}</td>
                <td><Link href={`/admin/statutory/rulesets/${rule.id}`}>Review</Link></td>
              </tr>
            ))}</tbody>
          </table>
          {!rules.length ? <p className="empty-state">No statutory rule sets.</p> : null}
        </div>
      </section>
    </AppShell>
  );
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
