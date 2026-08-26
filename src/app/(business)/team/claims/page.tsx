import { randomUUID } from "node:crypto";
import Link from "next/link";
import { HrPayrollIssue } from "@/components/hr-payroll-issue";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerClaimDashboard } from "@/lib/claim/service";
import {
  claimStageContent,
  getClaimOperationalStage,
  getManagerClaimStatus,
  type ClaimOperationalStage,
} from "@/lib/claim/presentation";
import { ClaimCategoryPolicyForm } from "./claim-category-policy-form";
import { ClaimReceiptPreview } from "./claim-receipt-preview";
import { ClaimsFilterControls } from "./claims-filter-controls";
import {
  cancelApprovedClaimAction,
  installClaimStartersAction,
  markClaimPaidAction,
  reevaluateClaimPayrollTreatmentAction,
  reviewClaimAction,
  selectClaimChannelAction,
} from "./actions";
import styles from "./claims.module.css";

type Props = { searchParams: Promise<{ stage?: string; status?: string; employee?: string; filterCategory?: string; from?: string; to?: string; type?: string; message?: string; manage?: string; category?: string; newCategory?: string; claim?: string }> };

const operationalStages: ClaimOperationalStage[] = ["NEEDS_REVIEW", "READY_TO_PAY", "PROCESSING", "COMPLETED"];

export default async function ClaimsPage({ searchParams }: Props) {
  const { access } = await requireBusinessUser("VIEW_CLAIM");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const data = await getManagerClaimDashboard({ businessId: scope.businessId, allowedBranchIds: [...scope.allowedBranchIds] });
  const canReview = hasBusinessCapability(access, "REVIEW_CLAIM");
  const canVerify = hasBusinessCapability(access, "VERIFY_CLAIM");
  const canManage = hasBusinessCapability(access, "MANAGE_CLAIM_SETTINGS");
  const canLinkPayroll = hasBusinessCapability(access, "LINK_CLAIM_TO_PAYROLL");
  const employeeSearch = params.employee?.trim().toLowerCase();
  const activeStage = operationalStages.includes(params.stage as ClaimOperationalStage) ? params.stage as ClaimOperationalStage : "NEEDS_REVIEW";
  const stageCounts = Object.fromEntries(operationalStages.map((stage) => [stage, data.claims.filter((claim) => getClaimOperationalStage({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status })).length])) as Record<ClaimOperationalStage, number>;
  const claims = data.claims.filter((claim) =>
    getClaimOperationalStage({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status }) === activeStage &&
    (!params.status || claim.status === params.status) &&
    (!employeeSearch || claim.membership.fullName.toLowerCase().includes(employeeSearch) || claim.membership.employeeCode.toLowerCase().includes(employeeSearch)) &&
    (!params.filterCategory || claim.lines.some((line) => line.categoryId === params.filterCategory)) &&
    claim.lines.some((line) => {
      const expenseDate = line.expenseDate.slice(0, 10);
      return (!params.from || expenseDate >= params.from) && (!params.to || expenseDate <= params.to);
    }),
  );
  const submittedCount = data.claims.filter((claim) => claim.status === "SUBMITTED").length;
  const channelCount = data.claims.filter((claim) => claim.reimbursement?.status === "AWAITING_CHANNEL").length;
  const completedCount = stageCounts.COMPLETED;
  const attentionCount = stageCounts.NEEDS_REVIEW + stageCounts.READY_TO_PAY;
  const hasFilters = Boolean(params.employee || params.status || params.filterCategory || params.from || params.to);
  const activeFilterCount = [params.employee, params.status, params.filterCategory, params.from, params.to].filter(Boolean).length;
  const manageCategories = canManage && params.manage === "categories";
  const selectedCategory = data.categories.find((category) => category.id === params.category) ?? null;
  const currentDate = today();
  const selectedRevision = selectedCategory?.revisions.find((revision) => revision.effectiveFrom <= currentDate && (!revision.effectiveTo || revision.effectiveTo >= currentDate)) ?? selectedCategory?.revisions[0] ?? null;

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>CLAIMS</p><h1>Employee claims</h1><span>Review requests and track reimbursements in one place.</span></div>
        {attentionCount > 0 ? <div className={styles.attentionCount}><strong>{attentionCount}</strong><span>open task{attentionCount === 1 ? "" : "s"}</span></div> : null}
      </header>

      {params.message ? params.type === "error" ? (
        <HrPayrollIssue
          affected="The claim or reimbursement action you just attempted"
          impact="No claim, reimbursement or payroll record was changed."
          nextAction={{ href: "/team/claims", label: "Review claims" }}
          title="Claim action needs attention"
          tone="error"
          whatHappened={friendlyMessage(params.message)}
        />
      ) : <div className={styles.success}>{friendlyMessage(params.message)}</div> : null}

      <section className={styles.summary} aria-label="Claims workflow">
        <Link data-active={activeStage === "NEEDS_REVIEW"} href={stageHref("NEEDS_REVIEW")}><span>Needs review</span><strong>{submittedCount}</strong><small>Waiting for an HR decision</small></Link>
        <Link data-active={activeStage === "READY_TO_PAY"} href={stageHref("READY_TO_PAY")}><span>Ready to pay</span><strong>{channelCount}</strong><small>Choose a reimbursement method</small></Link>
        <Link data-active={activeStage === "PROCESSING"} href={stageHref("PROCESSING")}><span>Processing</span><strong>{stageCounts.PROCESSING}</strong><small>In payroll or awaiting payment</small></Link>
        <Link data-active={activeStage === "COMPLETED"} href={stageHref("COMPLETED")}><span>Completed</span><strong>{completedCount}</strong><small>Paid, payroll-finalized or closed</small></Link>
      </section>

      {data.categories.length === 0 ? <section className={styles.setup}><div><p className={styles.eyebrow}>SETUP REQUIRED</p><h2>Add claim categories</h2><p>Employees need at least one category before they can submit a claim.</p></div>{canManage ? <form action={installClaimStartersAction}><button>Install starter categories</button></form> : null}</section> : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <div><p className={styles.eyebrow}>CLAIM REQUESTS</p><h2>{claimStageContent[activeStage].label}</h2><span>{claims.length} result{claims.length === 1 ? "" : "s"}</span></div>
          <ClaimsFilterControls stage={activeStage} employee={params.employee} status={params.status} category={params.filterCategory} from={params.from} to={params.to} categories={data.categories.map((category) => ({ id: category.id, name: category.name }))} activeFilterCount={activeFilterCount} />
        </div>

        <div className={styles.claims}>{claims.length ? claims.map((claim) => {
          const firstLine = claim.lines[0];
          const categoryText = claim.lines.length > 1 ? `${firstLine?.categoryNameSnapshot ?? "Claim"} +${claim.lines.length - 1}` : firstLine?.categoryNameSnapshot ?? "Claim";
          const receiptCount = claim.lines.reduce((count, line) => count + line.attachments.length, 0);
          const eligiblePayrollRuns = data.payrollRuns.filter((run) => run.eligibleMembershipIds.includes(claim.membership.id));
          const currentPolicies = claim.lines.map((line) => {
            const category = data.categories.find((item) => item.id === line.categoryId);
            return category?.revisions.find((revision) => revision.effectiveFrom <= currentDate && (!revision.effectiveTo || revision.effectiveTo >= currentDate)) ?? category?.revisions[0] ?? null;
          });
          const currentTreatmentReady = currentPolicies.length > 0 && currentPolicies.every((policy) => policy?.statutoryTreatmentStatus === "VERIFIED_NON_WAGE");
          const firstCategoryId = claim.lines[0]?.categoryId;
          return <article key={claim.id} className={styles.claim} id={`claim-${claim.id}`}>
            <details className={styles.claimDisclosure} open={params.claim === claim.id}>
              <summary className={styles.claimRow}>
                <span className={styles.avatar}>{initials(claim.membership.fullName)}</span>
                <span className={styles.claimPerson}><strong>{claim.membership.fullName}</strong><small>{claim.membership.employeeCode} · {claim.branch.name}</small></span>
                <span className={styles.rowData}><small>Category</small><strong>{categoryText}</strong></span>
                <span className={styles.rowData}><small>Amount</small><strong>RM {claim.submittedTotal}</strong></span>
                <span className={styles.rowData}><small>Claim date</small><strong>{formatDate(firstLine?.expenseDate)}</strong></span>
                <span className={styles.rowData}><small>Submitted</small><strong>{formatDateTime(claim.submittedAt ?? claim.createdAt)}</strong></span>
                <span className={styles.rowData}><small>Receipt</small><strong>{receiptCount ? `${receiptCount} attached` : "None"}</strong></span>
                <b className={styles.status} data-status={getClaimOperationalStage({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status })}>{getManagerClaimStatus({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement?.status })}</b>
                <span className={styles.chevron} aria-hidden="true">⌄</span>
              </summary>

              <div className={styles.claimDetail}>
                <div className={styles.detailGrid}><div><small>Employee</small><strong>{claim.membership.fullName}</strong><span>{claim.membership.employeeCode}</span></div><div><small>Amount</small><strong>RM {claim.submittedTotal}</strong><span>{claim.lines.length} item{claim.lines.length === 1 ? "" : "s"}</span></div><div className={styles.detailWide}><small>Description</small><strong>{claim.purpose}</strong></div></div>
                <div className={styles.lines}>{claim.lines.map((line) => <div key={line.id} className={styles.line}><div><strong>{line.categoryNameSnapshot}</strong><span>{formatDate(line.expenseDate)} · {line.description}</span>{line.merchant ? <small>{line.merchant}</small> : null}</div><div><strong>RM {line.submittedAmount}</strong><span>{humanize(line.reviewStatus)}</span></div><div><ClaimReceiptPreview attachments={line.attachments.map((attachment) => ({ id: attachment.id, fileName: attachment.sanitizedFileName, mimeType: attachment.mimeType }))} category={line.categoryNameSnapshot} amount={`RM ${line.submittedAmount}`} expenseDate={formatDate(line.expenseDate)} merchant={line.merchant} /></div></div>)}</div>

                {claim.duplicateWarning ? <div className={styles.warning}><strong>Possible duplicate</strong><span>Please compare the employee, category, date and amount before deciding.</span></div> : null}
                {canReview && claim.status === "SUBMITTED" ? <form action={reviewClaimAction} className={styles.review}><input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} />{claim.lines.map((line) => <div key={line.id} className={styles.reviewLine}><label>Approved amount · {line.categoryNameSnapshot}<div className={styles.moneyInput}><span>RM</span><input name={`approved:${line.id}`} type="number" min="0" max={line.submittedAmount} step="0.01" defaultValue={line.submittedAmount} required /></div></label><label>Reason if reduced or rejected<input name={`reason:${line.id}`} maxLength={500} placeholder="Explain the adjustment" /></label></div>)}<label>Note to employee<input name="reason" maxLength={500} placeholder="Required when rejecting or reducing an amount" /></label><div className={styles.decisionActions}><button name="decisionIntent" value="APPROVE">Approve claim</button><button className={styles.rejectButton} name="decisionIntent" value="REJECT">Reject claim</button></div></form> : null}

                {claim.reimbursement ? <section className={styles.reimbursement}>
                  <div className={styles.reimbursementHeader}>
                    <div>
                      <p className={styles.eyebrow}>REIMBURSEMENT</p>
                      <h3>How should this claim be paid?</h3>
                      <span>Choose payroll reimbursement or a separate business payment.</span>
                    </div>
                    <div className={styles.reimbursementSummary}>
                      <span><small>Approved</small><strong>RM {claim.reimbursement.amount}</strong></span>
                      <b>{getManagerClaimStatus({ claimStatus: claim.status, reimbursementStatus: claim.reimbursement.status })}</b>
                    </div>
                  </div>

                  {claim.reimbursement.status === "AWAITING_CHANNEL" ? <div className={styles.channelList}>
                    {canLinkPayroll ? <form action={selectClaimChannelAction} className={`${styles.channelOption} ${styles.payrollChannel}`}>
                      <input type="hidden" name="reimbursementId" value={claim.reimbursement.id} />
                      <input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} />
                      <input type="hidden" name="operationKey" value={randomUUID()} />
                      <input type="hidden" name="channel" value="PAYROLL" />
                      <span className={styles.channelIcon} aria-hidden="true">PAY</span>
                      <div className={styles.channelOptionCopy}><strong>Through payroll</strong><span>Add the reimbursement to an open payroll draft.</span></div>
                      <label>Payroll draft<select name="payrollRunId" required disabled={!eligiblePayrollRuns.length}><option value="">{eligiblePayrollRuns.length ? "Choose a draft" : "No eligible draft"}</option>{eligiblePayrollRuns.map((run) => <option key={run.id} value={run.id}>{run.label}</option>)}</select></label>
                      <button disabled={!eligiblePayrollRuns.length}>Add</button>
                      {!eligiblePayrollRuns.length ? <small className={styles.channelNote}>{data.payrollRuns.length ? "This employee is not in an open payroll draft. Add them in Payroll, then return here." : "Create a payroll draft before using this option."} <Link href="/team/payroll">Open Payroll</Link></small> : null}
                    </form> : null}

                    {canVerify ? <form action={selectClaimChannelAction} className={`${styles.channelOption} ${styles.directChannel}`}>
                      <input type="hidden" name="reimbursementId" value={claim.reimbursement.id} />
                      <input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} />
                      <input type="hidden" name="operationKey" value={randomUUID()} />
                      <input type="hidden" name="channel" value="OUTSIDE_PAYROLL" />
                      <span className={styles.channelIcon} aria-hidden="true">RM</span>
                      <div className={styles.channelOptionCopy}><strong>Pay separately</strong><span>Record a bank transfer, cash payment or other direct reimbursement.</span></div>
                      <button>Continue</button>
                    </form> : null}
                  </div> : null}

                  {canVerify && claim.reimbursement.status === "OUTSIDE_PAYROLL_PENDING" ? <form action={markClaimPaidAction} className={styles.pay}><label>Payment reference<input name="paymentReference" required minLength={2} maxLength={120} placeholder="Transfer or receipt reference" /></label><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><button>Mark as paid</button></form> : null}
                  {claim.payrollSnapshots.map((snapshot) => <div className={snapshot.status === "BLOCKED_STATUTORY" ? styles.claimHold : styles.claimReady} key={snapshot.id}>
                    <div><strong>{snapshot.status === "BLOCKED_STATUTORY" ? (currentTreatmentReady ? "Ready to re-evaluate" : "Reimbursement on hold") : "Ready for payroll"}</strong><span>{snapshot.status === "BLOCKED_STATUTORY" ? (currentTreatmentReady ? "The category is now a business reimbursement. Apply the current rule to this claim." : "Set every category in this claim to Business reimbursement. The employee's salary can continue.") : "This amount will be added as a reimbursement and will not increase gross salary."}</span></div>
                    {snapshot.status === "BLOCKED_STATUTORY" && currentTreatmentReady && canLinkPayroll ? <form action={reevaluateClaimPayrollTreatmentAction}><input type="hidden" name="reimbursementId" value={claim.reimbursement?.id} /><input type="hidden" name="snapshotId" value={snapshot.id} /><input type="hidden" name="expectedSourceDigest" value={snapshot.sourceDigest} /><button>Re-evaluate reimbursement</button></form> : snapshot.status === "BLOCKED_STATUTORY" && firstCategoryId && canManage ? <Link href={`/team/claims?manage=categories&category=${firstCategoryId}#claim-category-settings`}>Update category</Link> : null}
                  </div>)}
                </section> : null}

                {canReview && ["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status) && claim.reimbursement && !["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED", "CANCELLED"].includes(claim.reimbursement.status) ? <details className={styles.dangerDisclosure}><summary>Cancel approved claim</summary><form action={cancelApprovedClaimAction} className={styles.cancelForm}><input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} /><label>Cancellation reason<input name="reason" required minLength={5} maxLength={500} /></label><button>Cancel claim</button></form></details> : null}
              </div>
            </details>
          </article>;
        }) : <div className={styles.empty}><strong>{hasFilters ? "No claims match these filters" : claimStageContent[activeStage].emptyTitle}</strong><span>{hasFilters ? "Clear the filters or try another search." : claimStageContent[activeStage].emptyBody}</span>{hasFilters ? <Link href={`/team/claims?stage=${activeStage}`}>Clear filters</Link> : null}</div>}</div>
      </section>

      {canManage ? <section id="claim-category-settings" className={styles.settingsPanel}>
        <div className={styles.settingsSummary}><div><p className={styles.eyebrow}>SETTINGS</p><h2>Claim settings</h2><span>{data.categories.length} categories · limits, receipts and reimbursement rules</span></div><Link className={styles.secondaryButton} href={manageCategories ? "/team/claims" : "/team/claims?manage=categories"}>{manageCategories ? "Close settings" : "Manage categories"}</Link></div>
        {manageCategories ? <div className={styles.categoryManager}>
          <div className={styles.categoryToolbar}><div><h3>Categories</h3><p>Select a category to edit its limits, requirements and reimbursement method.</p></div><Link className={styles.primaryLink} href="/team/claims?manage=categories&newCategory=1#claim-category-settings">+ Add category</Link></div>
          <div className={styles.categoryLayout}>
            <div className={styles.categoryList}>{data.categories.map((category) => { const current = category.revisions.find((revision) => revision.effectiveFrom <= currentDate && (!revision.effectiveTo || revision.effectiveTo >= currentDate)) ?? category.revisions[0]; return <Link key={category.id} className={selectedCategory?.id === category.id ? styles.categoryActive : styles.categoryRow} href={`/team/claims?manage=categories&category=${category.id}#claim-category-settings`}><span><strong>{category.name}</strong><small>{policySummary(category.nature, current?.maxLineAmount ?? null, current?.mileageRatePerKm ?? null)}</small></span><span><b>{current?.statutoryTreatmentStatus === "VERIFIED_NON_WAGE" ? "Reimburse normally" : "Review required"}</b><small>{current?.receiptRequired ? "Receipt required" : "Receipt optional"}</small></span></Link>; })}</div>
            <div className={styles.policyEditor}>{params.newCategory === "1" ? <ClaimCategoryPolicyForm key="new" category={null} today={currentDate} /> : selectedCategory ? <ClaimCategoryPolicyForm key={selectedCategory.id} category={{ id: selectedCategory.id, name: selectedCategory.name, nature: selectedCategory.nature, latest: selectedRevision ? { nameSnapshot: selectedRevision.nameSnapshot, effectiveFrom: selectedRevision.effectiveFrom, receiptRequired: selectedRevision.receiptRequired, descriptionRequired: selectedRevision.descriptionRequired, maxLineAmount: selectedRevision.maxLineAmount, mileageRatePerKm: selectedRevision.mileageRatePerKm, statutoryTreatmentStatus: selectedRevision.statutoryTreatmentStatus } : null }} today={currentDate} /> : <div className={styles.categoryPlaceholder}><strong>Select a category</strong><span>Its current policy and update controls will appear here.</span></div>}</div>
          </div>
        </div> : null}
      </section> : null}
    </main>
  );
}

function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function today() { return new Date().toISOString().slice(0, 10); }
function formatDate(value?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value.slice(0, 10)}T00:00:00`)); }
function formatDateTime(value?: string | null) { if (!value) return "—"; return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)); }
function policySummary(nature: string, max: string | null, mileage: string | null) { if (nature === "MILEAGE") return mileage ? `Mileage · RM ${Number(mileage).toFixed(2)} / km` : "Mileage"; return max ? `Maximum RM ${Number(max).toFixed(2)} per claim` : "General expense · No amount limit"; }
function friendlyMessage(message: string) { return message.replace("Immutable Claim policy revision created.", "Claim category policy updated.").replace("Claim decision recorded. Approval remains separate from payment.", "Claim approved. Choose how it should be reimbursed.").replace("Claim decision recorded. Expense representation is queued for reconciliation.", "Claim approved. Choose how it should be reimbursed.").replace("The selected Draft Payroll Run has no eligible employee entry.", "This employee is not included in the selected payroll draft. Add them to a draft in Payroll, then try again.").replace("Payroll bridge snapshot created. Unverified statutory treatment remains blocked.", "This reimbursement is on hold until its payroll treatment is set. The employee's salary can continue."); }
function stageHref(stage: ClaimOperationalStage) { return `/team/claims?stage=${stage}`; }
