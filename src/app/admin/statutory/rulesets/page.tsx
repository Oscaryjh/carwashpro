import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { SIGN_OFF_STATUTORY_RULESET } from "@/lib/payroll/statutory-activation-service";
import { loadStatutoryHumanReviewPackages } from "@/lib/payroll/statutory-evidence-pack";
import { statutoryStepUpReadiness } from "@/lib/payroll/statutory-governance-service";
import {
  statutoryHumanSignOffReadiness,
  type StatutoryHumanSignOffReadiness,
} from "@/lib/payroll/statutory-review-ui-readiness";
import styles from "../statutory-admin.module.css";

const schemeCopy = {
  EPF: "Retirement contribution rules",
  SOCSO: "Employment injury and invalidity protection",
  EIS: "Employment insurance contribution rules",
  LINDUNG24: "PERKESO participation evidence",
  PCB: "Monthly tax deduction calculation",
} as const;

const schemeOrder = ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"] as const;

export default async function StatutoryRuleSetsPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const mfaFeatureEnabled = isMfaFeatureEnabled();

  const [rules, evidencePacks] = await Promise.all([
    prisma.statutoryRuleSet.findMany({
      where: { NOT: { version: { startsWith: "TEST_" } } },
      include: {
        _count: { select: { classifications: true, signOffs: true, reviewDecisions: true } },
        signOffs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ scheme: "asc" }, { effectiveFrom: "desc" }, { recordedAt: "desc" }],
    }),
    loadStatutoryHumanReviewPackages(),
  ]);
  const reviewerMfaStatus = mfaFeatureEnabled && user.sessionId
    ? (await getMfaSecurityState({ userId: user.userId, sessionId: user.sessionId })).status
    : "ENROLLED";

  const reviewerCanSign = user.permissions.includes(SIGN_OFF_STATUTORY_RULESET);
  const setupItems = [...evidencePacks]
    .sort((left, right) => schemeOrder.indexOf(left.scheme) - schemeOrder.indexOf(right.scheme))
    .map((pack) => ({
      pack,
      canonical: rules.find((rule) =>
        rule.scheme === pack.scheme && rule.version === pack.classification.version),
    }));
  const activeCount = setupItems.filter(({ canonical }) => canonical?.status === "ACTIVE").length;
  const remainingCount = setupItems.length - activeCount;
  const nextSetupItem = setupItems.find(({ canonical }) => canonical?.status !== "ACTIVE");
  const nextSetupEngineeringReady = nextSetupItem
    ? nextSetupItem.pack.engineering === "READY" && nextSetupItem.pack.evidencePack === "COMPLETE"
    : false;
  const nextSetupHref = nextSetupItem
    ? nextSetupItem.canonical && (nextSetupEngineeringReady || nextSetupItem.pack.scheme === "PCB")
      ? `/admin/statutory/rulesets/${nextSetupItem.canonical.id}`
      : `/admin/statutory/review/${nextSetupItem.pack.scheme.toLowerCase()}`
    : null;

  return (
    <AppShell user={user}>
      <main className={styles.workspace}>
        <header className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Payroll compliance</p>
            <h1>Statutory rule review</h1>
            <p className={styles.heroText}>
              Review the official evidence for EPF, SOCSO, EIS, LINDUNG 24 and PCB before a rule is approved for payroll use.
            </p>
          </div>
          <div className={styles.heroMeta} aria-label="Review summary">
            <div className={styles.metric}><strong>{activeCount} / {setupItems.length}</strong><span>rules active</span></div>
            <div className={styles.metric}><strong>{remainingCount}</strong><span>remaining</span></div>
          </div>
        </header>

        {!reviewerCanSign || (mfaFeatureEnabled && reviewerMfaStatus !== "ENROLLED") ? (
          <aside className={styles.notice}>
            <div>
              <strong>Approval is not available for this account yet</strong>
              <p>
                You can review every evidence pack now. Final approval requires the statutory sign-off permission
                {mfaFeatureEnabled && reviewerMfaStatus !== "ENROLLED" ? " and an enrolled MFA method" : ""}.
              </p>
            </div>
            {mfaFeatureEnabled && reviewerMfaStatus !== "ENROLLED" ? <Link className={styles.secondaryAction} href="/security/mfa">Set up MFA</Link> : null}
          </aside>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Review workspace</p>
              <h2>Statutory payroll rules</h2>
              <p>Use one consistent Evidence → HR Review → Approval → Payroll Use flow for every statutory calculation.</p>
            </div>
            <span className={`${styles.badge} ${remainingCount === 0 ? styles.badgeReady : styles.badgePending}`}>
              {activeCount} of {setupItems.length} active
            </span>
          </div>

          <div className={styles.setupOverview}>
            <div className={styles.setupProgressCopy}>
              <span className={styles.stepNumber}>{remainingCount === 0 ? "✓" : activeCount + 1}</span>
              <div>
                <strong>{remainingCount === 0 ? "All rules are ready" : `Continue with ${nextSetupItem?.pack.scheme}`}</strong>
                <p>
                  {remainingCount === 0
                    ? "All five statutory rules are approved and active in payroll."
                    : `${remainingCount} rule${remainingCount === 1 ? "" : "s"} still need review, approval or activation.`}
                </p>
              </div>
            </div>
            <progress value={activeCount} max={setupItems.length} aria-label="Statutory rule setup progress" />
            {nextSetupHref ? (
              <Link className={styles.primaryAction} href={nextSetupHref}>
                Continue setup · {remainingCount} remaining
              </Link>
            ) : <span className={`${styles.badge} ${styles.badgeReady}`}>Setup complete</span>}
          </div>

          <div className={styles.schemeGrid}>
            {setupItems.map(({ pack, canonical }) => {
              const engineeringReady = pack.engineering === "READY" && pack.evidencePack === "COMPLETE";
              const pcbReviewAvailable = pack.scheme === "PCB" && Boolean(canonical);
              const stepUpInfrastructureStatus = canonical
                ? mfaFeatureEnabled
                  ? statutoryStepUpReadiness(canonical).status
                  : "READY"
                : "BLOCKED";
              const readiness = canonical
                ? statutoryHumanSignOffReadiness({
                    stepUpInfrastructureStatus,
                    reviewerMfaStatus,
                    reviewerCanSign,
                    humanReviewStatus: canonical.humanReviewStatus,
                    signOffExecuted: canonical.signOffs[0]?.decision === "APPROVED",
                  })
                : "BLOCKED_CANONICAL_RULESET";
              const isApproved = canonical?.signOffs[0]?.decision === "APPROVED";
              const isActive = canonical?.status === "ACTIVE";
              const displayedReadiness = engineeringReady ? readiness : "BLOCKED_ENGINEERING";

              return (
                <article className={styles.schemeCard} key={pack.scheme}>
                  <div className={styles.cardHeader}>
                    <div className={styles.schemeIdentity}>
                      <span className={styles.schemeIcon}>{pack.scheme === "LINDUNG24" ? "L24" : pack.scheme}</span>
                      <div>
                        <h3>{pack.scheme}</h3>
                        <p>{schemeCopy[pack.scheme]}</p>
                      </div>
                    </div>
                    <span className={`${styles.badge} ${readinessBadge(displayedReadiness, isActive)}`}>
                      {readinessLabel(displayedReadiness, isActive)}
                    </span>
                  </div>

                  <ol className={styles.progressList} aria-label={`${pack.scheme} review progress`}>
                    <li><span>1 · Evidence</span><strong>{engineeringReady ? "Ready" : "Needs work"}</strong></li>
                    <li><span>2 · HR review</span><strong>{engineeringReady || pcbReviewAvailable ? reviewLabel(canonical?.humanReviewStatus) : "Locked"}</strong></li>
                    <li><span>3 · Approval</span><strong>{engineeringReady ? (isApproved ? "Approved" : "Waiting") : "Locked"}</strong></li>
                    <li><span>4 · Payroll use</span><strong>{engineeringReady ? (isActive ? "Active" : "Not active") : "Locked"}</strong></li>
                  </ol>

                  <div className={styles.actions}>
                    <Link
                      className={isActive ? styles.secondaryAction : styles.primaryAction}
                      href={(engineeringReady || pcbReviewAvailable) && canonical
                        ? `/admin/statutory/rulesets/${canonical.id}`
                        : `/admin/statutory/review/${pack.scheme.toLowerCase()}`}
                    >
                      {!engineeringReady && !pcbReviewAvailable ? "Review readiness" : isActive ? "View details" : canonical ? "Continue review" : "Start review"}
                    </Link>
                  </div>

                  <details className={styles.technicalDetails}>
                    <summary>Technical record</summary>
                    <dl className={styles.technicalGrid}>
                      <div><dt>Candidate version</dt><dd>{pack.classification.version}</dd></div>
                      <div><dt>Evidence status</dt><dd>{pack.evidencePack}</dd></div>
                      <div><dt>Engineering status</dt><dd>{pack.engineering}</dd></div>
                      <div><dt>Rule record</dt><dd>{canonical ? "Registered" : "Not registered"}</dd></div>
                      {mfaFeatureEnabled ? <div><dt>Step-up service</dt><dd>{stepUpInfrastructureStatus}</dd></div> : null}
                      {mfaFeatureEnabled ? <div><dt>Reviewer MFA</dt><dd>{reviewerMfaStatus}</dd></div> : null}
                      <div><dt>Readiness code</dt><dd>{displayedReadiness}</dd></div>
                    </dl>
                  </details>
                </article>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Rule register</p>
              <h2>Saved rule versions</h2>
              <p>Use this list when you need to review an older version or its effective period.</p>
            </div>
          </div>
          {rules.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Scheme</th><th>Effective period</th><th>Human review</th><th>Approval</th><th>Payroll status</th><th /></tr></thead>
                <tbody>{rules.map((rule) => (
                  <tr key={rule.id}>
                    <td><strong>{rule.scheme}</strong><br/><span className={styles.subtle}>{rule.version}</span></td>
                    <td>{dateOnly(rule.effectiveFrom)} – {rule.effectiveTo ? dateOnly(rule.effectiveTo) : "Ongoing"}</td>
                    <td>{reviewLabel(rule.humanReviewStatus)}<br/><span className={styles.subtle}>{rule._count.reviewDecisions} recorded decision(s)</span></td>
                    <td>{rule.signOffs[0]?.decision === "APPROVED" ? "Approved" : "Waiting for approval"}</td>
                    <td><span className={`${styles.badge} ${rule.status === "ACTIVE" ? styles.badgeReady : styles.badgeNeutral}`}>{rule.status === "ACTIVE" ? "Active" : "Not active"}</span></td>
                    <td><Link className={styles.secondaryAction} href={`/admin/statutory/rulesets/${rule.id}`}>Review</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className={styles.emptyState}>No saved statutory rule versions.</p>}
        </section>
      </main>
    </AppShell>
  );
}

function reviewLabel(status?: "PENDING" | "IN_PROGRESS" | "COMPLETED") {
  if (status === "COMPLETED") return "Reviewed";
  if (status === "IN_PROGRESS") return "In review";
  return "Waiting for review";
}

type DisplayedReadiness = StatutoryHumanSignOffReadiness | "BLOCKED_CANONICAL_RULESET" | "BLOCKED_ENGINEERING";

function readinessLabel(readiness: DisplayedReadiness, active: boolean) {
  if (active) return "Active";
  if (readiness === "BLOCKED_ENGINEERING") return "Evidence not ready";
  if (readiness === "READY") return "Ready for approval";
  if (readiness === "SIGN_OFF_EXECUTED") return "Approved · not active";
  if (readiness === "BLOCKED_HUMAN_REVIEW_PENDING") return "Review required";
  if (readiness === "BLOCKED_CANONICAL_RULESET") return "Rule record required";
  if (readiness === "BLOCKED_REVIEWER_MFA_ENROLLMENT") return "MFA required";
  if (readiness === "BLOCKED_REVIEWER_CAPABILITY") return "Approver required";
  return "Setup required";
}

function readinessBadge(readiness: DisplayedReadiness, active: boolean) {
  if (active || readiness === "READY" || readiness === "SIGN_OFF_EXECUTED") return styles.badgeReady;
  if (readiness === "BLOCKED_HUMAN_REVIEW_PENDING") return styles.badgePending;
  return styles.badgeBlocked;
}

function dateOnly(value: Date) {
  return value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}
