import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerClaimDashboard } from "@/lib/claim/service";
import {
  cancelApprovedClaimAction,
  createClaimPolicyRevisionAction,
  installClaimStartersAction,
  markClaimPaidAction,
  reviewClaimAction,
  selectClaimChannelAction,
} from "./actions";
import styles from "./claims.module.css";

type Props = { searchParams: Promise<{ status?: string; employee?: string; type?: string; message?: string }> };

const claimStatuses = ["SUBMITTED", "APPROVED", "PARTIALLY_APPROVED", "REJECTED", "WITHDRAWN"] as const;

const statusLabels: Record<string, string> = {
  SUBMITTED: "Needs review",
  APPROVED: "Approved",
  PARTIALLY_APPROVED: "Partially approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  AWAITING_CHANNEL: "Choose how to reimburse",
  OUTSIDE_PAYROLL_PENDING: "Payment pending",
  OUTSIDE_PAYROLL_PAID: "Paid outside Payroll",
  PAYROLL_LINKED: "Linked to Payroll",
  PAYROLL_SETTLED: "Paid through Payroll",
  CANCELLED: "Cancelled",
  PENDING: "Pending",
};

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
  const claims = data.claims.filter((claim) =>
    (!params.status || claim.status === params.status) &&
    (!employeeSearch || claim.membership.fullName.toLowerCase().includes(employeeSearch) || claim.membership.employeeCode.toLowerCase().includes(employeeSearch)),
  );
  const submittedCount = data.claims.filter((claim) => claim.status === "SUBMITTED").length;
  const channelCount = data.claims.filter((claim) => claim.reimbursement?.status === "AWAITING_CHANNEL").length;
  const paymentCount = data.claims.filter((claim) => claim.reimbursement?.status === "OUTSIDE_PAYROLL_PENDING").length;
  const hasFilters = Boolean(params.employee || params.status);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>CLAIMS</p>
          <h1>Claims</h1>
          <span>Review employee expenses, then choose how each approved amount is reimbursed.</span>
        </div>
        <div className={styles.attentionCount}><strong>{submittedCount + channelCount + paymentCount}</strong><span>need attention</span></div>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}

      <section className={styles.summary} aria-label="Claims requiring attention">
        <article className={submittedCount ? styles.summaryActive : undefined}><span>To review</span><strong>{submittedCount}</strong><small>Submitted by employees</small></article>
        <article className={channelCount ? styles.summaryActive : undefined}><span>Choose payment route</span><strong>{channelCount}</strong><small>Payroll or direct reimbursement</small></article>
        <article className={paymentCount ? styles.summaryActive : undefined}><span>Payment pending</span><strong>{paymentCount}</strong><small>Direct payments to complete</small></article>
      </section>

      {data.categories.length === 0 ? (
        <section className={styles.setup}>
          <div><p className={styles.eyebrow}>SETUP REQUIRED</p><h2>Add claim categories before employees submit claims</h2><p>Start with practical company categories; you can adjust their limits later.</p></div>
          {canManage ? <form action={installClaimStartersAction}><button>Install starter categories</button></form> : null}
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}>
          <div><p className={styles.eyebrow}>INBOX</p><h2>Employee claims</h2><span>{claims.length} shown · {data.claims.length} total</span></div>
          <details className={styles.filterDisclosure} open={hasFilters}>
            <summary>{hasFilters ? "Filters applied" : "Filter claims"}</summary>
            <form className={styles.filters}>
              <label>Employee<input name="employee" defaultValue={params.employee} placeholder="Name or employee code" /></label>
              <label>Status<select name="status" defaultValue={params.status ?? ""}><option value="">All statuses</option>{claimStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
              <button>Apply filters</button>
              {hasFilters ? <Link href="/team/claims">Clear</Link> : null}
            </form>
          </details>
        </div>

        <div className={styles.claims}>{claims.length ? claims.map((claim) => (
          <article key={claim.id} className={styles.claim}>
            <header className={styles.claimHeader}>
              <div className={styles.employeeIdentity}>
                <span className={styles.avatar}>{initials(claim.membership.fullName)}</span>
                <div><strong>{claim.membership.fullName}</strong><span>{claim.membership.employeeCode} · {claim.branch.name}</span></div>
              </div>
              <div className={styles.claimMeta}><b className={styles.status} data-status={claim.status}>{statusLabels[claim.status] ?? humanize(claim.status)}</b><span>{claim.claimNumber}</span></div>
            </header>

            <div className={styles.claimSummary}>
              <div><span>Purpose</span><strong>{claim.purpose}</strong></div>
              <div><span>Submitted</span><strong>RM {claim.submittedTotal}</strong></div>
              <div><span>Approved</span><strong>RM {claim.approvedTotal}</strong></div>
            </div>

            {claim.duplicateWarning ? <div className={styles.warning}><strong>Possible duplicate</strong><span>A similar employee, category, date and amount already exists. Please check before deciding.</span></div> : null}

            <details className={styles.lineDisclosure} open={claim.status === "SUBMITTED"}>
              <summary>{claim.lines.length} expense item{claim.lines.length === 1 ? "" : "s"}</summary>
              <div className={styles.lines}>{claim.lines.map((line) => (
                <div key={line.id} className={styles.line}>
                  <div><strong>{line.categoryNameSnapshot}</strong><span>{line.expenseDate} · {line.description}</span>{line.merchant ? <small>{line.merchant}</small> : null}</div>
                  <div><strong>RM {line.submittedAmount}</strong><span>{humanize(line.reviewStatus)}</span></div>
                  <div>{line.attachments.map((attachment) => <a key={attachment.id} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View receipt</a>)}</div>
                </div>
              ))}</div>
            </details>

            {canReview && claim.status === "SUBMITTED" ? (
              <details className={styles.actionDisclosure} open>
                <summary>Review and decide</summary>
                <form action={reviewClaimAction} className={styles.review}>
                  <input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} />
                  {claim.lines.map((line) => <div key={line.id} className={styles.reviewLine}><label>Approved amount · {line.categoryNameSnapshot}<div className={styles.moneyInput}><span>RM</span><input name={`approved:${line.id}`} type="number" min="0" max={line.submittedAmount} step="0.01" defaultValue={line.submittedAmount} required /></div></label><label>Reason if reduced or rejected<input name={`reason:${line.id}`} maxLength={500} placeholder="Explain the adjustment" /></label></div>)}
                  <label>Decision note (optional when fully approved)<input name="reason" maxLength={500} placeholder="Add a note for the employee" /></label>
                  <button>Save decision</button>
                </form>
              </details>
            ) : null}

            {claim.reimbursement ? (
              <section className={styles.reimbursement}>
                <div className={styles.reimbursementHeader}><div><p className={styles.eyebrow}>REIMBURSEMENT</p><h3>RM {claim.reimbursement.amount}</h3></div><b>{statusLabels[claim.reimbursement.status] ?? humanize(claim.reimbursement.status)}</b></div>
                {claim.reimbursement.status === "AWAITING_CHANNEL" ? <div className={styles.channelGrid}>
                  {canVerify ? <form action={selectClaimChannelAction}><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><input type="hidden" name="channel" value="OUTSIDE_PAYROLL" /><div><strong>Pay directly</strong><span>Record payment outside Payroll.</span></div><label>Note (optional)<input name="note" maxLength={500} /></label><button>Choose direct payment</button></form> : null}
                  {canLinkPayroll ? <form action={selectClaimChannelAction}><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><input type="hidden" name="channel" value="PAYROLL" /><div><strong>Pay with Payroll</strong><span>Add it to an open Payroll run.</span></div><label>Payroll run<select name="payrollRunId" required><option value="">Select a draft run</option>{data.payrollRuns.map((run) => <option key={run.id} value={run.id}>{run.label}</option>)}</select></label><button disabled={!data.payrollRuns.length}>Link to Payroll</button>{!data.payrollRuns.length ? <small>No draft Payroll run is available.</small> : null}</form> : null}
                </div> : null}
                {canVerify && claim.reimbursement.status === "OUTSIDE_PAYROLL_PENDING" ? <form action={markClaimPaidAction} className={styles.pay}><label>Payment reference<input name="paymentReference" required minLength={2} maxLength={120} placeholder="Transfer or receipt reference" /></label><label>Note (optional)<input name="note" maxLength={500} /></label><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><button>Confirm direct payment</button></form> : null}
                {claim.payrollSnapshots.map((snapshot) => <div className={styles.blocker} key={snapshot.id}>{snapshot.status === "BLOCKED_STATUTORY" ? "Payroll is waiting for the claim's statutory treatment to be verified." : `Payroll status: ${humanize(snapshot.status)}`}</div>)}
              </section>
            ) : null}

            {canReview && ["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status) && claim.reimbursement && !["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED", "CANCELLED"].includes(claim.reimbursement.status) ? <details className={styles.dangerDisclosure}><summary>Cancel this approved claim</summary><form action={cancelApprovedClaimAction} className={styles.pay}><input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} /><label>Cancellation reason<input name="reason" required minLength={5} maxLength={500} /></label><button>Cancel approved claim</button></form></details> : null}
          </article>
        )) : <div className={styles.empty}><strong>{hasFilters ? "No claims match these filters" : "No employee claims yet"}</strong><span>{hasFilters ? "Clear the filters or try a different employee." : "New submissions will appear here for review."}</span>{hasFilters ? <Link href="/team/claims">Clear filters</Link> : null}</div>}</div>
      </section>

      {canManage ? <details className={styles.settingsPanel}>
        <summary><span><b>Claims settings</b><small>{data.categories.length} categories · limits and receipt rules</small></span><span>Manage</span></summary>
        <div className={styles.settingsBody}>
          <div><p className={styles.eyebrow}>CATEGORY POLICY</p><h2>Create a new policy version</h2><p>Changes apply from the selected date and do not rewrite earlier claims.</p></div>
          <form action={createClaimPolicyRevisionAction} className={styles.settings}>
            <label>Category<select name="categoryId"><option value="">Create a new category</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Code<input name="code" required pattern="[A-Z0-9_]{2,40}" placeholder="e.g. MEALS" /></label><label>Display name<input name="name" required minLength={2} maxLength={120} /></label>
            <label>Expense type<select name="nature"><option value="GENERAL">General expense</option><option value="MILEAGE">Mileage</option></select></label><label>Effective from<input name="effectiveFrom" type="date" required /></label>
            <label>Maximum per item (RM)<input name="maxLineAmount" type="number" min="0.01" step="0.01" /></label><label>Mileage rate (RM / km)<input name="mileageRatePerKm" type="number" min="0.0001" step="0.0001" /></label>
            <label className={styles.checkLabel}><input name="receiptRequired" type="checkbox" /> Receipt required</label><label className={styles.checkLabel}><input name="descriptionRequired" type="checkbox" defaultChecked /> Description required</label>
            <label className={styles.full}>Description<input name="description" maxLength={500} /></label><label className={styles.full}>Reason for change<input name="reason" required minLength={5} maxLength={500} /></label>
            <p className={`${styles.full} ${styles.policyNote}`}>New versions remain subject to statutory review. Creating a category does not classify it as non-wage automatically.</p><button className={styles.full}>Save policy version</button>
          </form>
        </div>
      </details> : null}
    </main>
  );
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}
