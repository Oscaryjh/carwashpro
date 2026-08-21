import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  loadStatutoryHumanReviewPackages,
  type EvidencePackScheme,
  type StatutoryClassificationReviewEntry,
} from "@/lib/payroll/statutory-evidence-pack";
import {
  STATUTORY_REVIEW_CHECKLIST,
} from "@/lib/payroll/statutory-human-review";
import { registerPcbReviewDraftAction } from "../../rulesets/actions";
import styles from "../../statutory-admin.module.css";

type Props = { params: Promise<{ scheme: string }> };
const schemeOrder: EvidencePackScheme[] = ["EPF", "SOCSO", "EIS", "LINDUNG24", "PCB"];

const schemeCopy: Record<EvidencePackScheme, {
  shortLabel: string;
  title: string;
  description: string;
  reviewPoints: [string, string, string];
}> = {
  EPF: {
    shortLabel: "EPF / KWSP",
    title: "EPF / KWSP contribution review",
    description: "Confirm that the retirement contribution rates, wage bands and calculation results match the official EPF material.",
    reviewPoints: [
      "The official EPF contribution schedule and effective dates are correct.",
      "Employer and employee amounts match the tested wage bands and boundaries.",
      "The rule is suitable for the employees and pay items it will cover.",
    ],
  },
  SOCSO: {
    shortLabel: "SOCSO / PERKESO",
    title: "SOCSO / PERKESO contribution review",
    description: "Confirm that employee coverage categories and contribution amounts match the official PERKESO material.",
    reviewPoints: [
      "The correct SOCSO coverage category and effective dates are represented.",
      "Employer and employee contribution amounts match the official schedule.",
      "Age, eligibility and wage-boundary cases have been tested correctly.",
    ],
  },
  EIS: {
    shortLabel: "EIS / SIP",
    title: "EIS / SIP contribution review",
    description: "Confirm that employment insurance eligibility and contribution amounts match the official PERKESO material.",
    reviewPoints: [
      "The official EIS contribution schedule and effective dates are correct.",
      "Employer and employee contribution amounts match the tested wage bands.",
      "Employee age and eligibility limits are represented correctly.",
    ],
  },
  LINDUNG24: {
    shortLabel: "LINDUNG 24",
    title: "LINDUNG 24 participation review",
    description: "Confirm the participation record and supporting PERKESO evidence. This is separate from PCB and does not create a deduction by itself.",
    reviewPoints: [
      "The participation state and effective period match the official evidence.",
      "The selected employer and employee coverage context is correct.",
      "The record is treated as participation evidence, not as PCB or a payroll deduction.",
    ],
  },
  PCB: {
    shortLabel: "PCB / MTD",
    title: "PCB monthly tax deduction readiness",
    description: "Review the HASiL sources, official examples and remaining payroll-data gaps before PCB can move to HR review, approval and payroll use.",
    reviewPoints: [
      "The 2026 HASiL computerised calculation specification and official examples are retained and verified.",
      "Every required employee tax, TP1, TP3 and year-to-date input is available as a governed payroll record.",
      "Every pay item has an evidence-backed PCB treatment and the calculator has completed the required software verification.",
    ],
  },
};

export default async function StatutoryHumanReviewPage({ params }: Props) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const requestedScheme = (await params).scheme.toUpperCase();
  if (!isEvidencePackScheme(requestedScheme)) notFound();

  const [packages, canonicalRuleSets] = await Promise.all([
    loadStatutoryHumanReviewPackages(),
    prisma.statutoryRuleSet.findMany({
      where: { scheme: requestedScheme },
      select: {
        id: true,
        version: true,
        status: true,
        humanReviewStatus: true,
        sourceReference: true,
      },
      orderBy: { recordedAt: "desc" },
    }),
  ]);
  const pack = packages.find((item) => item.scheme === requestedScheme);
  if (!pack) notFound();
  const reviewPosition = schemeOrder.indexOf(pack.scheme) + 1;
  const matrix = classificationMatrix(packages.flatMap((item) => item.classification.entries));
  const currentRule = canonicalRuleSets.find(
    (rule) => !rule.sourceReference.startsWith("local://"),
  );
  const copy = schemeCopy[pack.scheme];
  const ruleStatus = friendlyRuleStatus(currentRule?.status, currentRule?.humanReviewStatus);
  const engineeringReady = pack.engineering === "READY" && pack.evidencePack === "COMPLETE";
  const isPcb = pack.scheme === "PCB";
  const humanReviewComplete = currentRule?.humanReviewStatus === "COMPLETED" || currentRule?.status === "HUMAN_SIGNED_OFF" || currentRule?.status === "ACTIVE";
  const pcbReadinessItems = isPcb
    ? pack.knownLimitations
      .filter((limitation) => !(humanReviewComplete && limitation.startsWith("Several pay items")))
      .map(friendlyPcbReadinessItem)
    : [];
  const pcbReadinessCounts = {
    hr: pcbReadinessItems.filter((item) => item.owner === "hr").length,
    product: pcbReadinessItems.filter((item) => item.owner === "product").length,
    external: pcbReadinessItems.filter((item) => item.owner === "external").length,
  };
  const payItemReviewAvailable = isPcb && Boolean(currentRule);
  const approvalComplete = currentRule?.status === "HUMAN_SIGNED_OFF" || currentRule?.status === "ACTIVE";
  const payrollUseEnabled = currentRule?.status === "ACTIVE";
  const pcbWorkflow = [
    {
      label: "Complete setup",
      detail: engineeringReady ? "Complete" : `${pcbReadinessItems.length} items remaining`,
      state: engineeringReady ? "complete" : "current",
    },
    {
      label: "HR review",
      detail: humanReviewComplete ? "Complete" : payItemReviewAvailable ? "In progress" : "Ready to start",
      state: humanReviewComplete ? "complete" : "current",
    },
    {
      label: "Approve rule",
      detail: approvalComplete ? "Approved" : humanReviewComplete ? "Ready for approval" : "Available after HR review",
      state: approvalComplete ? "complete" : humanReviewComplete ? "current" : "locked",
    },
    {
      label: "Use in payroll",
      detail: payrollUseEnabled ? "Enabled" : approvalComplete ? "Ready to turn on" : "Available after approval",
      state: payrollUseEnabled ? "complete" : approvalComplete ? "current" : "locked",
    },
  ] as const;

  return (
    <AppShell user={user}>
      <main className={styles.workspace}>
        <header className={styles.hero}>
          <div className={styles.schemeHeroIdentity}>
            <span className={styles.schemeMark} aria-hidden="true">{pack.scheme === "LINDUNG24" ? "L24" : pack.scheme}</span>
            <div>
              <p className={styles.eyebrow}>Statutory review · {reviewPosition} of {schemeOrder.length}</p>
              <h1>{copy.title}</h1>
              <p className={styles.heroText}>{copy.description}</p>
            </div>
          </div>
          <div className={styles.heroMeta} aria-label="Evidence summary">
            <div className={styles.metric}><strong>{pack.artifacts.length}</strong><span>verified sources</span></div>
            <div className={styles.metric}><strong>{pack.fixtures.length}</strong><span>test cases</span></div>
          </div>
        </header>

        <nav className={styles.schemeNav} aria-label="Evidence packs">
          {schemeOrder.map((scheme) => scheme === pack.scheme
            ? <strong aria-current="page" key={scheme}>{schemeCopy[scheme].shortLabel}</strong>
            : <Link href={`/admin/statutory/review/${scheme.toLowerCase()}`} key={scheme}>{schemeCopy[scheme].shortLabel}</Link>)}
        </nav>

        <aside className={styles.infoNotice}>
          <div>
            <strong>Review supporting evidence here</strong>
            <p>Use this page to understand the official sources and test results. Final approval happens in Rule governance.</p>
          </div>
          <Link className={styles.secondaryAction} href="/admin/statutory/rulesets">Rule governance</Link>
        </aside>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{isPcb ? "PCB setup" : "At a glance"}</p>
              <h2>{isPcb ? "Setup progress" : "Review overview"}</h2>
              {isPcb ? <p>Classify pay items now. Final approval stays locked until the official PCB verification is complete.</p> : null}
            </div>
            <span className={`${styles.badge} ${engineeringReady ? (ruleStatus.tone === "ready" ? styles.badgeReady : styles.badgePending) : styles.badgeBlocked}`}>
              {engineeringReady ? ruleStatus.label : isPcb ? `${pcbReadinessItems.length} setup items remaining` : "Evidence not ready"}
            </span>
          </div>
          {isPcb ? (
            <>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}><span>Official evidence</span><strong>Collected</strong></div>
                <div className={styles.summaryCard}><span>Calculation examples</span><strong>{pack.independentReview.rowsChecked} of {pack.fixtures.length} passed</strong></div>
                <div className={styles.summaryCard}><span>Effective period</span><strong>{friendlyDate(pack.effectiveFrom)}{pack.effectiveTo ? ` to ${friendlyDate(pack.effectiveTo)}` : " onward"}</strong></div>
              </div>
              <ol className={styles.setupWorkflow} aria-label="PCB setup workflow">
                {pcbWorkflow.map((step, index) => (
                  <li
                    className={`${styles.setupWorkflowStep} ${step.state === "complete" ? styles.setupWorkflowComplete : step.state === "current" ? styles.setupWorkflowCurrent : styles.setupWorkflowLocked}`}
                    key={step.label}
                  >
                    <span className={styles.setupWorkflowNumber}>{step.state === "complete" ? "✓" : index + 1}</span>
                    <div><strong>{step.label}</strong><p>{step.detail}</p></div>
                  </li>
                ))}
              </ol>
              <div className={styles.setupNextAction}>
                <div>
                  <strong>{engineeringReady ? "PCB is ready for final HR review." : "Start with pay-item treatment"}</strong>
                  <p>{engineeringReady ? "The official evidence and payroll requirements are ready for a human decision." : "HR can classify pay items while the remaining HASiL and calculation checks are completed. Payroll use remains locked."}</p>
                </div>
                {currentRule ? (
                  <Link className={styles.primaryAction} href={`/admin/statutory/rulesets/${currentRule.id}#classification-review`}>Continue pay-item review</Link>
                ) : (
                  <form action={registerPcbReviewDraftAction}>
                    <button className={styles.primaryAction} type="submit">Start pay-item review</button>
                  </form>
                )}
              </div>
            </>
          ) : (
            <>
              <div className={styles.summaryGrid}>
                <div className={styles.summaryCard}><span>Evidence</span><strong>{engineeringReady ? "Ready" : "Work remaining"}</strong></div>
                <div className={styles.summaryCard}><span>Independent check</span><strong>{pack.independentReview.mismatchCount === 0 ? "Passed" : `${pack.independentReview.mismatchCount} open`}</strong></div>
                <div className={styles.summaryCard}><span>Applies from</span><strong>{friendlyDate(pack.effectiveFrom)}{pack.effectiveTo ? ` to ${friendlyDate(pack.effectiveTo)}` : " onward"}</strong></div>
              </div>
              <div className={styles.reviewGuide}>
                <div className={styles.reviewGuideHeader}>
                  <span className={styles.stepNumber}>1</span>
                  <div><strong>What HR should confirm</strong><p>Read these three points before opening the final rule review.</p></div>
                </div>
                <ul>{copy.reviewPoints.map((point) => <li key={point}>{point}</li>)}</ul>
              </div>
              <div className={styles.sectionActions}>
                <div>
                  <strong>{engineeringReady ? (currentRule ? "Evidence can now be reviewed for approval." : "The approval record has not been created yet.") : "Evidence is not ready for HR approval yet."}</strong>
                  <p className={styles.subtle}>{engineeringReady ? (currentRule ? "Open Rule governance to make the final decision. Reviewing this page alone does not enable payroll calculations." : "Register a governed rule before approval can begin.") : "Complete the readiness items below first. HR Review, Approval and Payroll Use stay locked until the evidence gate passes."}</p>
                </div>
                {engineeringReady && currentRule ? <Link className={styles.primaryAction} href={`/admin/statutory/rulesets/${currentRule.id}`}>Review and approve rule</Link> : null}
              </div>
            </>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Source evidence</p>
              <h2>Official documents</h2>
              <p>These are the official references used to build and verify the calculation.</p>
            </div>
          </div>
          <ul className={styles.sourceList}>
            {pack.artifacts.map((artifact) => (
              <li className={styles.sourceItem} key={artifact.id}>
                <div><strong>{artifact.title}</strong><p className={styles.subtle}>{artifact.authority} · {artifact.version}</p></div>
                <div><span className={styles.subtle}>Used for</span><p>{friendlyArtifactRole(artifact.role)}</p></div>
                <span className={`${styles.badge} ${artifact.verified ? styles.badgeReady : styles.badgeBlocked}`}>{artifact.verified ? "Verified" : "Needs attention"}</span>
              </li>
            ))}
          </ul>
          <details className={styles.technicalDetails}>
            <summary>Technical file records</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Document</th><th>Retained file</th><th>SHA-256 fingerprint</th></tr></thead>
                <tbody>{pack.artifacts.map((artifact) => <tr key={artifact.id}>
                  <td>{artifact.title}</td><td><code>{artifact.retainedPath ?? "Missing"}</code></td><td><code>{artifact.sha256 ?? "Missing"}</code></td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>
        </section>

        <section className={`${styles.section} ${isPcb ? styles.pcbReadiness : ""}`} id={isPcb ? "pcb-readiness" : undefined}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Verification</p>
              <h2>{isPcb ? "PCB payroll readiness" : "Independent check"}</h2>
              <p>{isPcb ? "The supported calculation passed its official examples. Complete the remaining items below before PCB can be approved and used in payroll." : "A separate comparison checked that the system data matches the retained official documents."}</p>
            </div>
            <span className={`${styles.badge} ${pack.independentReview.mismatchCount === 0 ? styles.badgeReady : styles.badgeBlocked}`}>
              {pack.independentReview.mismatchCount === 0 ? (isPcb ? "Ready for HR review" : "Passed") : isPcb ? `${pack.independentReview.mismatchCount} items remaining` : "Review required"}
            </span>
          </div>
          <div className={isPcb ? styles.readinessSummaryGrid : styles.summaryGrid}>
            <div className={isPcb ? styles.readinessMetric : styles.summaryCard}>
              <span>{isPcb ? "Supported requirements" : "Schedule rows"}</span>
              <strong>{isPcb ? `${pack.dataset.actualRowCount} / ${pack.dataset.expectedRowCount}` : `${pack.dataset.actualRowCount} of ${pack.dataset.expectedRowCount}`}</strong>
              {isPcb ? <p>{Math.max(0, pack.dataset.expectedRowCount - pack.dataset.actualRowCount)} requirements are not available yet.</p> : null}
            </div>
            <div className={isPcb ? styles.readinessMetric : styles.summaryCard}>
              <span>{isPcb ? "Official examples passed" : "Rows independently checked"}</span>
              <strong>{isPcb ? `${pack.independentReview.rowsChecked} / ${pack.fixtures.length}` : pack.independentReview.rowsChecked}</strong>
              {isPcb ? <p>All retained HASiL worked examples pass.</p> : null}
            </div>
            <div className={isPcb ? `${styles.readinessMetric} ${styles.readinessMetricWarning}` : styles.summaryCard}>
              <span>{isPcb ? "Remaining blockers" : "Mismatches found"}</span>
              <strong>{pack.independentReview.mismatchCount}</strong>
              {isPcb ? <p>Payroll use stays locked until these are resolved.</p> : null}
            </div>
          </div>
          {isPcb ? (
            <div className={styles.readinessOwnership} aria-label="PCB setup ownership">
              <span><strong>{pcbReadinessCounts.hr}</strong> HR review</span>
              <span><strong>{pcbReadinessCounts.product}</strong> system updates</span>
              <span><strong>{pcbReadinessCounts.external}</strong> external verification</span>
            </div>
          ) : null}
          {isPcb && pcbReadinessItems.length ? (
            <div className={styles.readinessBlockers}>
              <div className={styles.readinessBlockersHeader}>
                <div>
                  <strong>What can be completed now</strong>
                  <p>Only items marked “HR action” can be completed in Tetamu today. The others need a system update or external HASiL verification.</p>
                </div>
                <span className={`${styles.badge} ${styles.badgePending}`}>{pcbReadinessItems.length} remaining</span>
              </div>
              <ol className={styles.readinessBlockerList}>
                {pcbReadinessItems.map((item, index) => {
                  const actionHref = item.owner === "hr"
                    ? currentRule
                      ? `/admin/statutory/rulesets/${currentRule.id}#classification-review`
                      : "#pay-item-treatment"
                    : null;
                  return <li className={styles[`readinessBlocker_${item.owner}`]} key={item.title}>
                    <span className={styles.readinessBlockerNumber}>{index + 1}</span>
                    <div className={styles.readinessBlockerContent}>
                      <div className={styles.readinessBlockerTitle}>
                        <strong>{item.title}</strong>
                        <span className={`${styles.readinessOwnerBadge} ${styles[`readinessOwnerBadge_${item.owner}`]}`}>{item.status}</span>
                      </div>
                      <p>{item.description}</p>
                      {actionHref ? (
                        <Link className={styles.readinessInlineAction} href={actionHref}>
                          {currentRule ? "Review pay items" : "View pay items"}
                        </Link>
                      ) : null}
                    </div>
                  </li>;
                })}
              </ol>
            </div>
          ) : null}
          <details className={styles.technicalDetails}>
            <summary>{isPcb ? "View technical verification record" : "Technical verification details"}</summary>
            <dl className={styles.technicalGrid}>
              <div><dt>Dataset</dt><dd>{pack.dataset.id}</dd></div>
              <div><dt>Parser</dt><dd>{pack.dataset.parserName} {pack.dataset.parserVersion}</dd></div>
              <div><dt>Review method</dt><dd>{pack.independentReview.method}</dd></div>
              <div><dt>Dataset fingerprint</dt><dd><code>{pack.dataset.digest}</code></dd></div>
              <div><dt>Review fingerprint</dt><dd><code>{pack.independentReview.digest}</code></dd></div>
              <div><dt>Reviewer type</dt><dd>{pack.independentReview.reviewerType}</dd></div>
            </dl>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Reviewed range</th><th>Official pages</th></tr></thead>
                <tbody>{pack.independentReview.ranges.map((range) => (
                  <tr key={`${range.from}-${range.to}`}><td>{range.from} – {range.to}</td><td>{range.sourcePages.join(", ") || "Recorded in source reference"}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Calculation testing</p>
              <h2>Test results</h2>
              <p>{pack.fixtures.length} evidence-backed cases check normal values, limits and employee eligibility.{isPcb ? " Passing these examples does not by itself make PCB production-ready." : ""}</p>
            </div>
            <span className={`${styles.badge} ${pack.fixtureProvenance.MISSING === 0 ? styles.badgeReady : styles.badgeBlocked}`}>
              {pack.fixtureProvenance.MISSING === 0 ? "All tests traceable" : "Missing provenance"}
            </span>
          </div>
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}><span>Calculation method</span><strong>{pack.dataset.calculationMode ?? "Official schedule lookup"}</strong></div>
            <div className={styles.summaryCard}><span>Rounding method</span><strong>{pack.dataset.rounding ?? "Verified by test cases"}</strong></div>
            <div className={styles.summaryCard}><span>Calculator version</span><strong>{pack.calculator.version}</strong></div>
          </div>
          <details className={styles.technicalDetails}>
            <summary>View technical test cases ({pack.fixtures.length})</summary>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Test case</th><th>Input</th><th>Expected result</th></tr></thead>
                <tbody>{pack.fixtures.map((fixture) => (
                  <tr key={fixture.id}>
                    <td><strong>{fixture.id}</strong><br/><span className={styles.subtle}>{fixture.sourceReference}</span></td>
                    <td><code>{JSON.stringify(fixture.input)}</code></td>
                    <td><code>{JSON.stringify(fixture.expected)}</code></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <dl className={styles.technicalGrid}>
              <div><dt>Formula above schedule</dt><dd>{pack.dataset.formulaAboveCents === null ? "Defined by the verified scheme calculator" : money(pack.dataset.formulaAboveCents)}</dd></div>
              <div><dt>Test fingerprint</dt><dd><code>{pack.calculator.testDigest}</code></dd></div>
              <div><dt>Fixture fingerprint</dt><dd><code>{pack.fixtureDigest}</code></dd></div>
            </dl>
          </details>
        </section>

        <section className={styles.section} id={isPcb ? "pay-item-treatment" : undefined}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Payroll coverage</p>
              <h2>How pay items are treated</h2>
              <p>
                Review which salary items are included, excluded or still need a decision.
                {isPcb && !currentRule ? " Start the review to record HR decisions for unclear items." : ""}
              </p>
            </div>
            {isPcb && !currentRule ? (
              <span className={`${styles.badge} ${styles.badgePending}`}>Preview</span>
            ) : null}
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Pay component</th><th>EPF</th><th>SOCSO</th><th>EIS</th><th>LINDUNG 24</th><th>PCB</th><th>Evidence note</th></tr></thead>
              <tbody>{matrix.map((entry) => (
                <tr key={entry.componentCode}>
                  <td><strong>{entry.displayName}</strong><br/><span className={styles.subtle}>{entry.componentCode}</span></td>
                  <td>{friendlyTreatment(entry.treatments.EPF)}</td><td>{friendlyTreatment(entry.treatments.SOCSO)}</td><td>{friendlyTreatment(entry.treatments.EIS)}</td><td>{friendlyTreatment(entry.treatments.LINDUNG24)}</td><td>{friendlyTreatment(entry.treatments.PCB)}</td>
                  <td>{entry.reason}<br/><span className={styles.subtle}>{entry.officialEvidence.join(", ") || "No component-specific reference recorded"}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Open decisions</p>
              <h2>{pack.unknownComponents.length ? `${pack.unknownComponents.length} pay item(s) need review` : "No pay items need review"}</h2>
              <p>The system does not guess. Any undecided pay item remains blocked until an authorised reviewer confirms its treatment.</p>
            </div>
            <span className={`${styles.badge} ${pack.unknownComponents.length ? styles.badgePending : styles.badgeReady}`}>{pack.unknownComponents.length ? "Human decision required" : "No open items"}</span>
          </div>
          {pack.unknownComponents.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Pay component</th><th>Available evidence</th><th>Required action</th></tr></thead>
                <tbody>{pack.unknownComponents.map((component) => {
                  const entry = pack.classification.entries.find((item) => item.componentCode === component);
                  return <tr key={component}>
                    <td><strong>{entry?.displayName ?? component}</strong><br/><span className={styles.subtle}>{component}</span></td>
                    <td>{entry?.officialEvidence.join(", ") || entry?.reason || "No component-specific official evidence"}</td>
                    <td>Keep it blocked, or add an evidence-backed decision.</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          ) : <p className={styles.emptyState}>No unresolved pay components.</p>}
          <p className={styles.subtle}>Backdated amounts follow the original pay item. Payroll remains blocked when its source cannot be identified.</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Before approval</p>
              <h2>Important limitations</h2>
              <p>Read these conditions before approving the rule for payroll use.</p>
            </div>
          </div>
          <ul className={styles.limitationList}>{pack.knownLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          {pack.scheme === "LINDUNG24" ? <aside className={styles.notice}><div><strong>Schedule renewal required</strong><p>A new official schedule must be reviewed before 01 Jun 2028.</p></div></aside> : null}
          <details className={styles.technicalDetails}>
            <summary>Technical evidence fingerprint</summary>
            <p className={styles.codeBlock}><code>{pack.evidenceDigest}</code></p>
          </details>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Detailed checklist</p>
              <h2>Final review checklist</h2>
              <p>Use this checklist as a reading guide. Selections are not saved here; the final decision is recorded in Rule governance.</p>
            </div>
          </div>
          <details className={styles.technicalDetails}>
            <summary>Open {STATUTORY_REVIEW_CHECKLIST.length}-point checklist</summary>
            <fieldset className={styles.reviewFieldset}>
              <legend className={styles.subtle}>{copy.shortLabel} review confirmations</legend>
              <div className={styles.checklist}>
                {STATUTORY_REVIEW_CHECKLIST.map((item) => (
                  <label key={item.id}><input type="checkbox" /> {friendlyChecklistLabel(item.id)}</label>
                ))}
              </div>
            </fieldset>
          </details>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Finish review</p>
              <h2>Approve from Rule governance</h2>
              <p>Evidence review and rule approval are kept separate so payroll calculations cannot be enabled accidentally.</p>
            </div>
          </div>
          {engineeringReady && canonicalRuleSets.length ? (
            <div className={styles.actions}>{canonicalRuleSets.map((rule) => (
              <Link className={styles.primaryAction} href={`/admin/statutory/rulesets/${rule.id}`} key={rule.id}>
                Open {copy.shortLabel} rule review
              </Link>
            ))}</div>
          ) : <p className={styles.emptyState}>{engineeringReady ? `No approval record is available for ${copy.shortLabel} yet.` : "Approval remains locked until the evidence and engineering readiness gate is complete."}</p>}
          <p className={styles.subtle}>Opening this evidence page never enables a payroll calculation. Approval and activation remain controlled in Rule governance.</p>
        </section>
      </main>
    </AppShell>
  );
}

function isEvidencePackScheme(value: string): value is EvidencePackScheme {
  return schemeOrder.includes(value as EvidencePackScheme);
}

function classificationMatrix(entries: StatutoryClassificationReviewEntry[]) {
  const matrix = new Map<string, StatutoryClassificationReviewEntry>();
  for (const entry of entries) {
    const existing = matrix.get(entry.componentCode);
    if (!existing) {
      matrix.set(entry.componentCode, structuredClone(entry));
      continue;
    }
    existing.treatments = { ...existing.treatments, ...entry.treatments };
    existing.officialEvidence = [...new Set([...existing.officialEvidence, ...entry.officialEvidence])];
    if (!existing.reason.includes(entry.reason)) existing.reason += ` ${entry.reason}`;
  }
  return [...matrix.values()].sort((a, b) => a.componentCode.localeCompare(b.componentCode));
}

function friendlyTreatment(value?: string) {
  if (!value) return "—";
  if (value === "INCLUDED") return "Included";
  if (value === "EXCLUDED") return "Excluded";
  if (value === "NORMAL_REMUNERATION") return "Monthly remuneration";
  if (value === "ADDITIONAL_REMUNERATION") return "Additional remuneration";
  if (value === "UNKNOWN") return "Needs review";
  return value.replaceAll("_", " ").toLowerCase();
}

function friendlyArtifactRole(role: string) {
  return role.replaceAll("_", " ").toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

function friendlyPcbReadinessItem(limitation: string) {
  if (limitation.startsWith("TP1 ")) return {
    title: "Employee TP1 relief declarations",
    description: "The formal TP1 declaration and review record is not available yet. Entering one total amount in the employee profile does not complete this requirement.",
    owner: "product" as const,
    status: "System update needed",
  };
  if (limitation.startsWith("Previous-employer TP3")) return {
    title: "Previous-employer TP3 records",
    description: "The employee profile accepts previous-employer totals, but the versioned TP3 declaration, evidence and reviewer workflow still need to be added.",
    owner: "product" as const,
    status: "System update needed",
  };
  if (limitation.startsWith("Several pay items")) return {
    title: "Pay item tax treatment",
    description: "HR can review how salary, overtime, bonuses, allowances and deductions should be treated for PCB in Rule governance.",
    owner: "hr" as const,
    status: "HR action",
  };
  if (limitation.startsWith("Approved special tax regimes")) return {
    title: "Approved special tax treatment",
    description: "Tax treatment can be selected in the employee profile, but Tetamu cannot yet retain the official approval evidence required to use a special rate.",
    owner: "product" as const,
    status: "System update needed",
  };
  if (limitation.startsWith("Non-resident")) return {
    title: "Non-resident tax treatment",
    description: "The non-resident calculation path exists, but exempt-income classification and its supporting evidence are not complete yet.",
    owner: "product" as const,
    status: "System update needed",
  };
  if (limitation.startsWith("HASiL software verification")) return {
    title: "HASiL software verification",
    description: "This requires external verification for the calculator version. Passing Tetamu's local examples cannot replace HASiL approval.",
    owner: "external" as const,
    status: "External process",
  };
  return {
    title: "PCB readiness requirement",
    description: limitation,
    owner: "product" as const,
    status: "System update needed",
  };
}

function friendlyDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function friendlyChecklistLabel(id: string) {
  const labels: Record<string, string> = {
    "official-publisher": "The source comes from the correct official authority",
    "official-document": "The correct official document and version were used",
    "retained-artifact": "A copy of every official source is retained",
    "artifact-sha256": "The retained files match their recorded fingerprints",
    "effective-date": "The rule starts and ends on the correct dates",
    dataset: "The extracted contribution schedule is complete",
    "independent-review": "The independent comparison found no unexplained mismatch",
    calculator: "The calculator follows the official schedule",
    "boundary-logic": "Minimum, maximum and boundary values were checked",
    rounding: "Rounding produces the expected result",
    "fixture-provenance": "Every test case can be traced to evidence",
    eligibility: "Employee eligibility rules were checked",
    "component-classifications": "Pay component treatments were reviewed",
    "unknown-inventory": "Every unresolved pay component was considered",
    "known-limitations": "Known limitations are acceptable and understood",
    "effective-period-limit": "The review horizon and renewal date were checked",
    "evidence-digest": "The complete evidence package fingerprint was checked",
  };
  return labels[id] ?? id;
}

function friendlyRuleStatus(status?: string, humanReviewStatus?: string) {
  if (status === "ACTIVE") return { label: "Active in payroll", tone: "ready" as const };
  if (status === "HUMAN_SIGNED_OFF") return { label: "Approved", tone: "ready" as const };
  if (humanReviewStatus === "COMPLETED") return { label: "Review completed", tone: "ready" as const };
  if (humanReviewStatus === "IN_PROGRESS") return { label: "Review in progress", tone: "pending" as const };
  return { label: "Ready for review", tone: "pending" as const };
}

function money(cents: number) {
  return `MYR ${(cents / 100).toFixed(2)}`;
}
