import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { getMfaSecurityState } from "@/lib/auth/mfa-service";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import {
  ACTIVATE_STATUTORY_RULESET,
  SIGN_OFF_STATUTORY_RULESET,
} from "@/lib/payroll/statutory-activation-service";
import { REVIEW_STATUTORY_CLASSIFICATION } from "@/lib/payroll/statutory-governance-service";
import {
  STATUTORY_REVIEW_CHECKLIST_VERSION,
} from "@/lib/payroll/statutory-human-review";
import { getStatutoryActivationReadiness } from "@/lib/payroll/statutory-readiness-service";
import { statutoryHumanSignOffReadiness } from "@/lib/payroll/statutory-review-ui-readiness";
import { isArrearsComponent } from "@/lib/payroll/statutory-classification-policy";
import { prisma } from "@/lib/prisma";
import {
  activateStatutoryRuleAction,
  completeStatutoryHumanReviewAction,
  recordPcbSoftwareVerificationAction,
  reviewStatutoryClassificationsAction,
  signOffStatutoryRuleAction,
} from "../actions";
import { ApprovalChecklist } from "./approval-checklist";
import styles from "../../statutory-admin.module.css";

type Props = {
  params: Promise<{ ruleSetId: string }>;
  searchParams: Promise<{ result?: string; error?: string; stepUp?: string }>;
};

export default async function RuleSetReviewPage({ params, searchParams }: Props) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const { ruleSetId } = await params;
  const messages = await searchParams;
  const mfaFeatureEnabled = isMfaFeatureEnabled();
  const reviewerMfaStatus = mfaFeatureEnabled && user.sessionId
    ? (await getMfaSecurityState({ userId: user.userId, sessionId: user.sessionId })).status
    : "ENROLLED";
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
  const stepUpReady = !mfaFeatureEnabled || messages.stepUp === "READY";
  const humanSignOffReadiness = statutoryHumanSignOffReadiness({
    stepUpInfrastructureStatus: layers.stepUp,
    reviewerMfaStatus,
    reviewerCanSign: canSign,
    humanReviewStatus: rule.humanReviewStatus,
    signOffExecuted: layers.humanSignOff === "EXECUTED",
  });
  const copy = schemeCopy(rule.scheme);
  const reviewedUnknownCount = unknown.filter((item) => latestDecision.has(item.id)).length;
  const reviewComplete = layers.unknownReview === "COMPLETE";
  const signOffComplete = layers.humanSignOff === "EXECUTED";
  const active = layers.activation === "ACTIVE" || rule.status === "ACTIVE";
  const actionNotice = messages.error ? friendlyActionNotice(messages.error) : null;
  const resultNotice = messages.result ? friendlyResultNotice(messages.result) : null;
  const shouldOpenPcbVerification = Boolean(messages.error?.startsWith("PCB_"));
  const pcbReviewDraft = rule.scheme === "PCB" && rule.status === "ENGINEERING_VERIFIED" &&
    rule.readiness === "DATASET_VERIFIED" &&
    (rule.ruleData as { reviewDraft?: unknown } | null)?.reviewDraft === true;

  return (
    <AppShell user={user}>
      <main className={styles.workspace}>
        <header className={styles.hero}>
          <div className={styles.schemeHeroIdentity}>
            <div className={styles.schemeMark}>{copy.mark}</div>
            <div>
              <p className={styles.eyebrow}>Payroll compliance</p>
              <p className={styles.backLink}><Link href="/admin/statutory/rulesets">← All statutory rules</Link></p>
              <h1>{copy.title}</h1>
              <p className={styles.heroText}>{copy.description}</p>
            </div>
          </div>
          <div className={styles.heroMeta}>
            <div className={styles.metric}>
              <strong>{active ? "Active" : signOffComplete ? "Approved" : "In review"}</strong>
              <span>Current status</span>
            </div>
            <div className={styles.metric}>
              <strong>{displayDate(rule.effectiveFrom)}</strong>
              <span>Effective from</span>
            </div>
          </div>
        </header>

        {resultNotice ? (
          <div className={styles.successNotice} role="status"><strong>{resultNotice.title}</strong><p>{resultNotice.message}</p></div>
        ) : null}
        {actionNotice ? (
          <div className={actionNotice.tone === "review" ? styles.reviewNotice : styles.errorNotice} role="alert">
            <strong>{actionNotice.title}</strong>
            <p>{actionNotice.message}</p>
          </div>
        ) : null}

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Review progress</p>
              <h2>From official evidence to payroll use</h2>
              <p>Complete each step in order. A reviewed rule does not affect payroll until it is approved and enabled.</p>
            </div>
            <span className={`${styles.badge} ${active ? styles.badgeReady : styles.badgePending}`}>
              {active ? "Payroll enabled" : "Not yet used by payroll"}
            </span>
          </div>
          <ol className={styles.progressList}>
            <ProgressStep number="1" label="Official evidence" status={layers.evidence} />
            <ProgressStep number="2" label="HR review" status={layers.unknownReview} />
            <ProgressStep number="3" label="Approval" status={layers.humanSignOff} />
            <ProgressStep number="4" label="Payroll use" status={layers.activation} />
          </ol>
        </section>

        <NextAction
          active={active}
          canActivate={canActivate}
          canReview={canReview}
          canSign={canSign}
          everyUnknownReviewed={everyUnknownReviewed}
          reviewComplete={reviewComplete}
          signOffComplete={signOffComplete}
          unknownCount={unknown.length}
          pcbReviewDraft={pcbReviewDraft}
        />

        <section className={styles.section} id="classification-review">
          <div className={styles.reviewSectionHeading}>
            <div>
              <p className={styles.eyebrow}>Step 2 · HR review</p>
              <h2>Review payroll items</h2>
              <p>Decide whether each item should be included in this statutory calculation.</p>
            </div>
            {unknown.length ? (
              <div className={styles.reviewProgress}>
                <div>
                  <strong>{reviewedUnknownCount} / {unknown.length}</strong>
                  <span>{everyUnknownReviewed ? "Ready to finish" : "reviewed"}</span>
                </div>
                <progress value={reviewedUnknownCount} max={unknown.length} aria-label="HR review progress" />
              </div>
            ) : <span className={`${styles.badge} ${styles.badgeReady}`}>Nothing to review</span>}
          </div>

          {unknown.length ? (
            <>
              <div className={styles.decisionGuide} aria-label="Decision guide">
                <DecisionGuideItem
                  tone="include"
                  title={rule.scheme === "PCB" ? "Monthly pay" : "Include"}
                  copy={rule.scheme === "PCB"
                    ? "Salary, monthly commission or another payment included in the employee's regular monthly payroll."
                    : "Payroll should calculate this item."}
                />
                {rule.scheme === "PCB" ? (
                  <DecisionGuideItem
                    tone="additional"
                    title="One-off or non-monthly pay"
                    copy="Bonus, back pay, irregular commission or another payment made outside the normal monthly cycle."
                  />
                ) : null}
                <DecisionGuideItem
                  tone="exclude"
                  title={rule.scheme === "PCB" ? "Not included in PCB" : "Exclude"}
                  copy={rule.scheme === "PCB"
                    ? "Use only when this item is confirmed as exempt or outside PCB remuneration."
                    : "Payroll should ignore this item."}
                />
                <DecisionGuideItem
                  tone="unresolved"
                  title={rule.scheme === "PCB" ? "Review required" : "Needs clarification"}
                  copy="Keep this selected when the actual payment type or tax treatment is still unclear."
                />
              </div>

              <form action={reviewStatutoryClassificationsAction} className={styles.bulkReviewForm}>
                <input type="hidden" name="ruleSetId" value={rule.id}/>
                <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
                <input type="hidden" name="expectedReviewRevision" value={rule.humanReviewRevision}/>
                <div className={styles.decisionList}>
                  <div className={styles.decisionListHeader} aria-hidden="true">
                    <span>Pay item</span>
                    <span>{rule.scheme === "PCB" ? "PCB treatment" : "HR decision"}</span>
                  </div>
                  {unknown.map((item, index) => {
                    const decision = latestDecision.get(item.id);
                    return (
                      <article
                        className={`${styles.decisionCard} ${decision ? styles.decisionCardReviewed : ""}`}
                        id={`classification-${item.id}`}
                        key={item.id}
                      >
                      <div className={styles.decisionCardHeader}>
                        <span className={styles.decisionNumber}>{index + 1}</span>
                        <div className={styles.decisionIdentity}>
                          <h3>{classificationLabel(item.componentCode)}</h3>
                        </div>
                        <span className={`${styles.badge} ${decision ? styles.badgeReady : styles.badgePending}`}>
                          {decision ? friendlyDecision(decision.decision, rule.scheme) : "Needs review"}
                        </span>
                      </div>

                      <p className={styles.decisionRationale}>
                        {rule.scheme === "PCB"
                          ? pcbClassificationExplanation(item.componentCode, item.rationale)
                          : item.rationale}
                      </p>

                      <details className={styles.evidenceDetails}>
                        <summary>View official evidence</summary>
                        <p>{item.authorityRef}</p>
                        <p><strong>System code:</strong> <code>{item.componentCode}</code></p>
                      </details>

                      {rule.humanReviewStatus !== "COMPLETED" && canReview ? (
                        <div className={styles.decisionForm}>
                          {isArrearsComponent(item.componentCode) ? (
                            <div className={styles.arrearsDecisionPrompt}>
                              <input type="hidden" name={`decision:${item.id}`} value="KEEP_UNKNOWN"/>
                              <strong>Needs clarification</strong>
                              <span>{decision
                                ? "Only payroll containing this item will pause until the back payment is confirmed."
                                : "Confirm what this back payment is for before including it in payroll."}</span>
                            </div>
                          ) : (
                            <label className={`${styles.decisionField} ${styles.fullWidth}`}>Decision
                              <select name={`decision:${item.id}`} required defaultValue={decision?.decision ?? ""}>
                                <option value="" disabled>Choose a decision</option>
                                <option value="INCLUDED">
                                  {rule.scheme === "PCB" ? "Monthly pay" : "Include in calculation"}
                                </option>
                                {rule.scheme === "PCB" ? (
                                  <option value="ADDITIONAL_REMUNERATION">One-off or non-monthly pay</option>
                                ) : null}
                                <option value="EXCLUDED">
                                  {rule.scheme === "PCB" ? "Not included in PCB" : "Exclude from calculation"}
                                </option>
                                <option value="KEEP_UNKNOWN">
                                  {rule.scheme === "PCB" ? "Review required" : "Needs clarification"}
                                </option>
                              </select>
                            </label>
                          )}
                        </div>
                      ) : decision ? (
                        <div className={styles.recordedDecision}>
                          <strong>{friendlyDecision(decision.decision, rule.scheme)}</strong>
                        </div>
                      ) : null}
                      </article>
                    );
                  })}
                </div>
                {rule.humanReviewStatus !== "COMPLETED" && canReview ? (
                  <div className={styles.bulkReviewBar}>
                    <div>
                      <strong>Save all payroll item decisions</strong>
                      <span>Review the selections above, then save everything once.</span>
                    </div>
                    <button className={styles.primaryAction}>Save all changes</button>
                  </div>
                ) : null}
              </form>
            </>
          ) : (
            <div className={styles.emptyState}>
              <strong>No items need a manual decision.</strong>
              <p>The official evidence was classified successfully.</p>
            </div>
          )}

          {rule.humanReviewStatus === "IN_PROGRESS" && canReview ? (
            <form action={completeStatutoryHumanReviewAction} className={styles.completionForm}>
              <input type="hidden" name="ruleSetId" value={rule.id}/>
              <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
              <input type="hidden" name="expectedReviewRevision" value={rule.humanReviewRevision}/>
              <div className={styles.completionCopy}>
                <strong>Finish HR review</strong>
                <span>{everyUnknownReviewed
                  ? "All items have a decision. Finish this step to continue to approval."
                  : `${unknown.length - reviewedUnknownCount} item${unknown.length - reviewedUnknownCount === 1 ? "" : "s"} still need a decision.`}</span>
              </div>
              <button className={styles.primaryAction} disabled={!canReview || !everyUnknownReviewed}>Finish HR review</button>
            </form>
          ) : null}
        </section>

        <section className={styles.section} id="approval">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Step 3 · Approval</p>
              <h2>Final payroll approval</h2>
              <p>Confirm the reviewed evidence before this rule can be enabled for payroll.</p>
            </div>
            <span className={`${styles.badge} ${signOffComplete ? styles.badgeReady : styles.badgePending}`}>
              {signOffComplete ? "Approved" : "Waiting for approval"}
            </span>
          </div>

          <div className={`${styles.approvalReadiness} ${reviewComplete ? styles.approvalReadinessReady : styles.approvalReadinessWaiting}`}>
            <span className={styles.approvalReadinessIcon}>{reviewComplete ? "✓" : "2"}</span>
            <div>
              <strong>{reviewComplete ? "HR review complete" : "Complete HR review first"}</strong>
              <p>{reviewComplete
                ? "The evidence is ready for an authorized approver's final confirmation."
                : "Step 2 must be completed before this rule can be approved."}</p>
            </div>
          </div>

          {pcbReviewDraft ? (
            <div className={styles.pcbVerificationPanel}>
              <div className={styles.pcbVerificationIntro}>
                <div>
                  <p className={styles.eyebrow}>Official approval required</p>
                  <strong>Waiting for HASiL approval</strong>
                  <p>Do not enter test details. Continue only after this software appears in the official approved list or receives an approval letter.</p>
                </div>
                <Link className={styles.secondaryAction} href="/admin/statutory/review/pcb#pcb-readiness">View requirements</Link>
              </div>
              {reviewComplete && canSign ? (
                <details className={styles.pcbVerificationDisclosure} open={shouldOpenPcbVerification}>
                  <summary>
                    <span>
                      <strong>I have official HASiL approval</strong>
                      <small>Open the form only when you have the approval letter or approved-list entry.</small>
                    </span>
                    <span className={styles.disclosureAction}>Enter approval details</span>
                  </summary>
                  <form action={recordPcbSoftwareVerificationAction} className={styles.pcbVerificationForm}>
                    <input type="hidden" name="ruleSetId" value={rule.id}/>
                    <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
                    <input type="hidden" name="verifiedCalculatorVersion" value={rule.calculatorVersion ?? ""}/>
                    <div className={styles.formGrid}>
                      <label>Software name shown in approval
                        <input name="approvedSoftwareName" placeholder="Enter the exact approved name" required/>
                      </label>
                      <label>Approval reference
                        <input name="approvalReference" placeholder="Letter number or approved-list entry" required/>
                      </label>
                      <label className={styles.fullWidth}>Official HASiL approval link
                        <input name="sourceUrl" type="url" inputMode="url" placeholder="https://www.hasil.gov.my/..." required/>
                      </label>
                      <label>Approval effective date
                        <input name="effectiveFrom" type="date" required/>
                      </label>
                      <label>Calculator version
                        <input value={rule.calculatorVersion ?? "Not recorded"} readOnly aria-readonly="true"/>
                      </label>
                    </div>
                    <label className={styles.verificationConfirmation}>
                      <input name="confirmExactVersion" type="checkbox" required/>
                      <span>I confirm the official approval applies to the software and calculator version shown here.</span>
                    </label>
                    <div className={styles.pcbVerificationFooter}>
                      <p>Use the official approval letter or approved-software listing—not a general PCB guide.</p>
                      <button className={styles.primaryAction}>Save official approval</button>
                    </div>
                  </form>
                </details>
              ) : (
                <div className={styles.notice}>
                  <div>
                    <strong>{reviewComplete ? "Approval access required" : "Finish HR review first"}</strong>
                    <p>{reviewComplete
                      ? "An authorized payroll approver must record the official software verification."
                      : "Complete Step 2 before recording the software verification."}</p>
                  </div>
                </div>
              )}
            </div>
          ) : !canSign ? (
            <div className={styles.notice}><div><strong>Approval permission required</strong><p>You can review this rule, but an authorized payroll approver must approve it.</p></div></div>
          ) : null}
          {mfaFeatureEnabled && reviewerMfaStatus === "ENROLLED" ? (
            <div className={styles.infoNotice}><div><strong>Identity confirmation required</strong><p><Link href={mfaChallengeHref("STATUTORY_RULESET_SIGNOFF", rule.id, evidenceDigest)}>Confirm your identity for this approval</Link></p></div></div>
          ) : mfaFeatureEnabled ? (
            <div className={styles.notice}><div><strong>Security setup required</strong><p><Link href="/security/mfa">Set up account verification first</Link></p></div></div>
          ) : null}

          {canSign && !signOffComplete && !pcbReviewDraft ? <form action={signOffStatutoryRuleAction} className={styles.approvalForm}>
            <input type="hidden" name="ruleSetId" value={rule.id}/>
            <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
            <input type="hidden" name="reviewChecklistVersion" value={STATUTORY_REVIEW_CHECKLIST_VERSION}/>
            <fieldset className={styles.reviewFieldset} disabled={layers.stepUp === "BLOCKED"}>
              <legend className={styles.visuallyHidden}>Final confirmation</legend>
              <ApprovalChecklist />
            </fieldset>

            <div className={styles.approvalFooter}>
              <div className={styles.approvalSubmit}>
                <p>Approval is recorded automatically. Payroll use is enabled separately in Step 4.</p>
                <button className={styles.primaryAction} disabled={!reviewComplete || layers.stepUp === "BLOCKED" || !stepUpReady}>
                  Approve for payroll
                </button>
              </div>
            </div>
          </form> : null}

          {signOffComplete ? (
            <div className={styles.approvalComplete}>
              <span>✓</span>
              <div><strong>Approval complete</strong><p>This reviewed revision is ready to be turned on for payroll.</p></div>
            </div>
          ) : null}
        </section>

        <section className={styles.section} id="activation">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Step 4 · Turn on</p>
              <h2>Use this rule in payroll</h2>
              <p>Turn it on when payroll should start using this approved rule.</p>
            </div>
            <span className={`${styles.badge} ${active ? styles.badgeReady : styles.badgeNeutral}`}>
              {active ? "On" : "Off"}
            </span>
          </div>

          {readiness.blockers.length ? (
            <div className={styles.notice}><div><strong>Not ready to turn on</strong><p>Finish the remaining review and approval steps first.</p></div></div>
          ) : null}
          {!active && !canActivate && !readiness.blockers.length ? (
            <div className={styles.notice}>
              <div>
                <strong>Payroll administrator access required</strong>
                <p>This rule is approved. An authorized payroll administrator must turn it on.</p>
              </div>
            </div>
          ) : null}
          {active ? (
            <div className={styles.approvalComplete}>
              <span>✓</span>
              <div><strong>Rule is on</strong><p>Future payroll calculations will use this approved rule.</p></div>
            </div>
          ) : null}
          {mfaFeatureEnabled && reviewerMfaStatus === "ENROLLED" ? (
            <p><Link href={mfaChallengeHref("STATUTORY_RULESET_ACTIVATE", rule.id, evidenceDigest)}>Confirm activator identity</Link></p>
          ) : null}
          {canActivate && !active ? <form action={activateStatutoryRuleAction} className={styles.activationForm}>
            <input type="hidden" name="ruleSetId" value={rule.id}/>
            <input type="hidden" name="expectedEvidenceDigest" value={evidenceDigest}/>
            <button className={styles.primaryAction} disabled={rule.status !== "HUMAN_SIGNED_OFF" || layers.stepUp === "BLOCKED" || !stepUpReady}>
              Turn on for payroll
            </button>
          </form> : null}
        </section>

        <details className={`${styles.section} ${styles.technicalRecord}`}>
          <summary>Technical record</summary>
          <p className={styles.subtle}>Immutable source, version and audit identifiers for engineering and compliance checks.</p>
          <dl className={styles.technicalGrid}>
            <TechnicalItem label="Rule version" value={rule.version} code />
            <TechnicalItem label="RuleSet ID" value={rule.id} code />
            <TechnicalItem label="Lifecycle" value={`${rule.status} / ${rule.readiness}`} />
            <TechnicalItem label="Effective period" value={`${displayDate(rule.effectiveFrom)} – ${rule.effectiveTo ? displayDate(rule.effectiveTo) : "Open"}`} />
            <TechnicalItem label="Publisher" value={`${rule.authority} · ${rule.sourceDocumentName}`} />
            <TechnicalItem label="Source SHA-256" value={rule.sourceDigest ?? "Missing"} code />
            <TechnicalItem label="Dataset" value={`${rule.datasetRowCount ?? 0} rows · ${rule.datasetDigest ?? "Missing"}`} code />
            <TechnicalItem label="Parser" value={`${rule.parserName ?? "—"} ${rule.parserVersion ?? "—"}`} />
            <TechnicalItem label="Calculator" value={rule.calculatorVersion ?? "—"} />
            <TechnicalItem label="Classification" value={`${rule.classificationVersion ?? "—"} · ${rule.classifications.length} records`} />
            <TechnicalItem label="Human review digest" value={rule.humanClassificationDigest ?? "Not recorded"} code />
            <TechnicalItem label="Current evidence digest" value={evidenceDigest} code />
            <TechnicalItem label="Sign-off readiness" value={humanSignOffReadiness} code />
            <TechnicalItem label="Activation readiness" value={readiness.status} code />
          </dl>
          {readiness.blockers.length ? (
            <details className={styles.nestedDetails}>
              <summary>Technical blockers ({readiness.blockers.length})</summary>
              <ul>{readiness.blockers.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
            </details>
          ) : null}
          {readiness.conditionalRuntimeBlockers.length ? (
            <p className={styles.subtle}>Fail-closed components: <code>{readiness.conditionalRuntimeBlockers.join(", ")}</code></p>
          ) : null}
        </details>
      </main>
    </AppShell>
  );
}

function ProgressStep({ number, label, status }: { number: string; label: string; status: string }) {
  return <li><span>{number} · {label}</span><strong>{friendlyStatus(status)}</strong></li>;
}

function NextAction({ active, canActivate, canReview, canSign, everyUnknownReviewed, reviewComplete, signOffComplete, unknownCount, pcbReviewDraft }: {
  active: boolean;
  canActivate: boolean;
  canReview: boolean;
  canSign: boolean;
  everyUnknownReviewed: boolean;
  reviewComplete: boolean;
  signOffComplete: boolean;
  unknownCount: number;
  pcbReviewDraft: boolean;
}) {
  let title = "Rule is ready for payroll";
  let copy = "No further action is required for this revision.";
  let href: string | undefined;
  let action: string | undefined;
  let warning = false;

  if (pcbReviewDraft && everyUnknownReviewed) {
    title = "Pay-item review is up to date";
    copy = "Your decisions are saved. PCB still needs the remaining calculation and HASiL verification before final approval.";
    href = "/admin/statutory/review/pcb#pcb-readiness";
    action = "View PCB setup";
  } else if (!active && !reviewComplete) {
    title = everyUnknownReviewed ? "Complete the HR review" : `Review ${unknownCount} item${unknownCount === 1 ? "" : "s"}`;
    copy = canReview ? "Record any required decisions, then complete the HR review." : "An authorized HR reviewer must complete the classification review.";
    href = "#classification-review";
    action = "Go to HR review";
    warning = !canReview;
  } else if (!active && !signOffComplete) {
    title = "Approve the reviewed rule";
    copy = canSign ? "Confirm the approval checklist and approve this exact revision." : "An authorized payroll approver must approve this revision.";
    href = "#approval";
    action = "Go to approval";
    warning = !canSign;
  } else if (!active) {
    title = "Turn on the approved rule";
    copy = canActivate ? "This rule is approved and ready for future payroll calculations." : "An authorized payroll administrator must turn on this approved rule.";
    href = "#activation";
    action = "Go to final step";
    warning = !canActivate;
  }

  return (
    <section className={warning ? styles.notice : styles.infoNotice}>
      <div><strong>{title}</strong><p>{copy}</p></div>
      {href && action ? <a className={styles.secondaryAction} href={href}>{action}</a> : null}
    </section>
  );
}

function TechnicalItem({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return <div><dt>{label}</dt><dd>{code ? <code>{value}</code> : value}</dd></div>;
}

function DecisionGuideItem({ tone, title, copy }: { tone: "include" | "additional" | "exclude" | "unresolved"; title: string; copy: string }) {
  const toneClass = tone === "include"
    ? styles.decisionGuideInclude
    : tone === "additional"
      ? styles.decisionGuideAdditional
    : tone === "exclude"
      ? styles.decisionGuideExclude
      : styles.decisionGuideUnresolved;
  return (
    <div className={`${styles.decisionGuideItem} ${toneClass}`}>
      <span aria-hidden="true" />
      <div><strong>{title}</strong><p>{copy}</p></div>
    </div>
  );
}

function classificationLabel(componentCode: string) {
  const labels: Record<string, string> = {
    ARREARS: "Arrears payment",
    ANY_UNLISTED_CUSTOM_COMPONENT: "Other uncategorized pay item",
    COMMISSION: "Commission",
    CUSTOM_UNKNOWN_EARNING: "Other uncategorized earning",
    FIXED_ALLOWANCE: "Fixed allowance",
    MANUAL_ADJUSTMENT: "Payroll adjustment",
    ONE_OFF_EARNING: "One-time payment",
    PHONE_ALLOWANCE: "Phone allowance",
    PUBLIC_HOLIDAY_PAY: "Public holiday work pay",
    RECURRING_ALLOWANCE: "Monthly allowance",
    REST_DAY_PAY: "Rest-day work pay",
    SALARY_ARREARS: "Salary arrears / back pay",
    TRANSPORT_ALLOWANCE: "Transport allowance",
  };
  return labels[componentCode] ?? componentCode
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function pcbClassificationExplanation(componentCode: string, fallback: string) {
  const explanations: Record<string, string> = {
    ANY_UNLISTED_CUSTOM_COMPONENT: "The system does not know what this payment represents. Keep it under Review required until it is renamed or mapped to a specific pay type.",
    COMMISSION: "Choose Monthly pay when commission is paid every month. Choose One-off or non-monthly pay when it is paid irregularly.",
    CUSTOM_UNKNOWN_EARNING: "Confirm what this earning is for before deciding how PCB should treat it.",
    MANUAL_ADJUSTMENT: "An adjustment is not a tax category by itself. Confirm whether it corrects salary, commission, allowance or another original pay item.",
    ONE_OFF_EARNING: "Confirm whether this payment is a bonus, back pay, incentive or another one-time earning before assigning its PCB treatment.",
    PUBLIC_HOLIDAY_PAY: "Pay for work performed on a public holiday. Confirm whether your payroll policy treats it as monthly pay or a separate non-monthly payment.",
    RECURRING_ALLOWANCE: "Identify the allowance type first. Some allowances are taxable monthly pay, while qualifying exemptions or reimbursements may not be included in PCB.",
    REST_DAY_PAY: "Pay for work performed on a rest day. Confirm whether it is included in the regular monthly payroll or paid separately.",
    SALARY_ARREARS: "Back pay must retain the original earning type and payment period. Keep it under Review required until those details are confirmed.",
    TRANSPORT_ALLOWANCE: "Choose Monthly pay for a fixed taxable transport allowance. Choose Not included in PCB only for a confirmed exemption or documented business-expense reimbursement.",
  };
  return explanations[componentCode] ?? fallback;
}

function schemeCopy(scheme: string) {
  const normalized = scheme.toUpperCase();
  if (normalized === "EPF") return { mark: "EPF", title: "EPF / KWSP contribution rule", description: "Review and approve the official EPF calculation rule before payroll can use it." };
  if (normalized === "SOCSO") return { mark: "SOCSO", title: "SOCSO / PERKESO contribution rule", description: "Review and approve the official SOCSO contribution rule before payroll can use it." };
  if (normalized === "EIS") return { mark: "EIS", title: "EIS / SIP contribution rule", description: "Review and approve the official employment insurance rule before payroll can use it." };
  if (normalized === "PCB") return { mark: "PCB", title: "PCB / MTD monthly tax rule", description: "Review how each pay item is treated for monthly tax deduction. Final approval remains locked until the official calculator verification is complete." };
  return { mark: "L24", title: "LINDUNG 24 participation rule", description: "Review and approve the official participation rule before payroll can use it." };
}

function friendlyStatus(status: string) {
  const value = status.toUpperCase();
  if (["READY", "COMPLETE", "COMPLETED", "EXECUTED", "REGISTERED"].includes(value)) return "Complete";
  if (["ACTIVE", "ACTIVATED"].includes(value)) return "Enabled";
  if (value.includes("BLOCKED")) return "Needs attention";
  return "Waiting";
}

function friendlyDecision(decision: string, scheme?: string) {
  const isPcb = scheme?.toUpperCase() === "PCB";
  if (decision === "INCLUDED") return isPcb ? "Monthly pay" : "Included";
  if (decision === "ADDITIONAL_REMUNERATION") return isPcb ? "One-off / non-monthly" : "Additional pay";
  if (decision === "EXCLUDED") return isPcb ? "Not included in PCB" : "Excluded";
  return isPcb ? "Review required" : "Needs clarification";
}

function friendlyActionNotice(error: string) {
  const pcbVerificationMessages: Record<string, string> = {
    PCB_EXACT_VERSION_CONFIRMATION_REQUIRED: "Confirm that the official approval applies to the calculator version shown on this page.",
    PCB_HASIL_EVIDENCE_URL_INVALID: "Use an official HTTPS link from hasil.gov.my that supports this software approval.",
    PCB_HASIL_APPROVAL_REFERENCE_REQUIRED: "Enter the approval letter number or the exact published-list reference.",
    PCB_APPROVED_SOFTWARE_NAME_REQUIRED: "Enter the software name exactly as it appears in the HASiL approval.",
    PCB_HASIL_APPROVAL_DATE_REQUIRED: "Enter the date from which the HASiL approval applies.",
    PCB_VERIFIED_CALCULATOR_VERSION_MISMATCH: "The approval must apply to the exact PCB calculator version shown on this page.",
  };
  if (pcbVerificationMessages[error]) {
    return {
      tone: "review" as const,
      title: "PCB verification needs attention",
      message: pcbVerificationMessages[error],
    };
  }
  if (error === "ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED") {
    return {
      tone: "review" as const,
      title: "Arrears needs clarification",
      message: "Confirm what the back payment is for before using this item in payroll.",
    };
  }
  if (error === "STATUTORY_ACTION_FAILED") {
    return {
      tone: "error" as const,
      title: "Action could not be completed",
      message: "No changes were saved. Please try again.",
    };
  }
  if (error === "STATUTORY_REVIEWER_ACTIVATOR_SEPARATION_REQUIRED") {
    return {
      tone: "error" as const,
      title: "Activation permission required",
      message: "This account must have both rule approval and payroll activation access.",
    };
  }
  if (error === "UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE") {
    return {
      tone: "error" as const,
      title: "Rule verification is incomplete",
      message: "The approved review could not be matched to its saved verification record. No payroll rule was enabled.",
    };
  }
  return { tone: "error" as const, title: "Action needed", message: error };
}

function friendlyResultNotice(result: string) {
  if (result === "PCB_SOFTWARE_VERIFICATION_RECORDED") {
    return {
      title: "PCB verification recorded",
      message: "The verified resident-standard scope is ready for final payroll approval.",
    };
  }
  if (result === "HUMAN_REVIEW_COMPLETED") {
    return {
      title: "HR review complete",
      message: "All payroll items have been reviewed. Complete the remaining PCB verification items before final approval.",
    };
  }
  if (result === "SIGNED_OFF") {
    return { title: "Rule approved", message: "The rule is ready to be enabled for payroll." };
  }
  if (result === "ACTIVATED") {
    return { title: "Rule enabled", message: "Payroll can now use this approved rule." };
  }
  return { title: "Changes saved", message: result };
}

function displayDate(value: Date) {
  const [year, month, day] = value.toISOString().slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function mfaChallengeHref(action: "STATUTORY_RULESET_SIGNOFF" | "STATUTORY_RULESET_ACTIVATE", ruleSetId: string, evidenceDigest: string) {
  const params = new URLSearchParams({ action, resourceId: ruleSetId, requestFingerprint: evidenceDigest, returnTo: `/admin/statutory/rulesets/${ruleSetId}` });
  return `/admin/security/sensitive-actions?${params.toString()}`;
}
