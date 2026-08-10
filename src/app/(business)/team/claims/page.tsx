import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerClaimDashboard } from "@/lib/claim/service";
import {
  createClaimPolicyRevisionAction,
  cancelApprovedClaimAction,
  installClaimStartersAction,
  markClaimPaidAction,
  reviewClaimAction,
  selectClaimChannelAction,
} from "./actions";
import styles from "./claims.module.css";

type Props = { searchParams: Promise<{ status?: string; employee?: string; type?: string; message?: string }> };

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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p>HR / Claims</p><h1>Claims & reimbursements</h1><span>Approval, reimbursement and Payroll inclusion are separate controlled stages.</span></div>
        <nav><Link href="/team/leave">Leave</Link><Link href="/team/payroll/workspace">Payroll</Link></nav>
      </header>
      {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}

      <section className={styles.summary}>
        <article><span>Submitted</span><strong>{data.claims.filter((claim) => claim.status === "SUBMITTED").length}</strong></article>
        <article><span>Awaiting channel</span><strong>{data.claims.filter((claim) => claim.reimbursement?.status === "AWAITING_CHANNEL").length}</strong></article>
        <article><span>Outside Payroll pending</span><strong>{data.claims.filter((claim) => claim.reimbursement?.status === "OUTSIDE_PAYROLL_PENDING").length}</strong></article>
      </section>

      {data.categories.length === 0 ? (
        <section className={styles.setup}><div><h2>Claim setup required</h2><p>Install company policy starters. They do not claim statutory non-wage treatment.</p></div>{canManage ? <form action={installClaimStartersAction}><button>Install starters</button></form> : null}</section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p>Review queue</p><h2>Employee Claims</h2></div><span>{claims.length} record(s)</span></div>
        <form className={styles.filters}><label>Employee<input name="employee" defaultValue={params.employee} placeholder="Name or employee code" /></label><label>Status<select name="status" defaultValue={params.status ?? ""}><option value="">All</option>{["SUBMITTED","APPROVED","PARTIALLY_APPROVED","REJECTED","WITHDRAWN"].map((status) => <option key={status}>{status}</option>)}</select></label><button>Filter</button></form>
        <div className={styles.claims}>{claims.length ? claims.map((claim) => (
          <article key={claim.id} className={styles.claim}>
            <header><div><strong>{claim.membership.fullName}</strong><span>{claim.membership.employeeCode} · {claim.branch.name} · Claim {claim.claimNumber}</span></div><b>{claim.status.replaceAll("_", " ")}</b></header>
            <p>{claim.purpose}</p>
            <div className={styles.amounts}><span>Submitted <strong>RM {claim.submittedTotal}</strong></span><span>Approved <strong>RM {claim.approvedTotal}</strong></span><span>Revision <strong>{claim.revision}</strong></span></div>
            {claim.duplicateWarning ? <div className={styles.warning}>Possible duplicate warning only — same employee/category/date/amount. Review remains a human decision.</div> : null}
            <div className={styles.lines}>{claim.lines.map((line) => (
              <div key={line.id} className={styles.line}>
                <div><strong>{line.categoryNameSnapshot}</strong><span>{line.expenseDate} · {line.description}</span>{line.merchant ? <small>{line.merchant}</small> : null}</div>
                <div><strong>RM {line.submittedAmount}</strong><span>{line.reviewStatus.replaceAll("_", " ")}</span></div>
                <div>{line.attachments.map((attachment) => <a key={attachment.id} href={`/api/claims/attachments/${attachment.id}`} target="_blank" rel="noreferrer">View receipt</a>)}</div>
              </div>
            ))}</div>
            {canReview && claim.status === "SUBMITTED" ? (
              <form action={reviewClaimAction} className={styles.review}>
                <input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} />
                {claim.lines.map((line) => <div key={line.id}><label>Approved for {line.categoryNameSnapshot}<input name={`approved:${line.id}`} type="number" min="0" max={line.submittedAmount} step="0.01" defaultValue={line.submittedAmount} required /></label><label>Line reason<input name={`reason:${line.id}`} maxLength={500} placeholder="Required if reduced or rejected" /></label></div>)}
                <label>Overall reason<input name="reason" maxLength={500} placeholder="Required for partial approval or rejection" /></label>
                <button>Record decision</button>
              </form>
            ) : null}
            {claim.reimbursement ? (
              <section className={styles.reimbursement}>
                <h3>Reimbursement · RM {claim.reimbursement.amount}</h3>
                <p>Status: {claim.reimbursement.status.replaceAll("_", " ")}{claim.reimbursement.channel ? ` · ${claim.reimbursement.channel.replaceAll("_", " ")}` : ""}</p>
                {claim.reimbursement.status === "AWAITING_CHANNEL" ? <div className={styles.channelGrid}>
                  {canVerify ? <form action={selectClaimChannelAction}><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><input type="hidden" name="channel" value="OUTSIDE_PAYROLL" /><label>Note<input name="note" maxLength={500} /></label><button>Reimburse outside Payroll</button></form> : null}
                  {canLinkPayroll ? <form action={selectClaimChannelAction}><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><input type="hidden" name="channel" value="PAYROLL" /><label>Draft Payroll<select name="payrollRunId" required><option value="">Select</option>{data.payrollRuns.map((run) => <option key={run.id} value={run.id}>{run.label}</option>)}</select></label><button disabled={!data.payrollRuns.length}>Link to Payroll</button><small>Unverified treatment creates `CLAIM_STATUTORY_TREATMENT_NOT_READY` and does not change net pay.</small></form> : null}
                </div> : null}
                {canVerify && claim.reimbursement.status === "OUTSIDE_PAYROLL_PENDING" ? <form action={markClaimPaidAction} className={styles.pay}><input type="hidden" name="reimbursementId" value={claim.reimbursement.id} /><input type="hidden" name="expectedRevision" value={claim.reimbursement.revision} /><input type="hidden" name="operationKey" value={randomUUID()} /><label>Payment reference<input name="paymentReference" required minLength={2} maxLength={120} /></label><label>Note<input name="note" maxLength={500} /></label><button>Mark paid outside Payroll</button></form> : null}
                {claim.payrollSnapshots.map((snapshot) => <div className={styles.blocker} key={snapshot.id}>{snapshot.status === "BLOCKED_STATUTORY" ? `${snapshot.blockerCode}: statutory treatment is not verified; Payroll review/finalize is blocked.` : `Payroll snapshot ${snapshot.status}`}</div>)}
              </section>
            ) : null}
            {canReview && ["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status) && claim.reimbursement && !["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED", "CANCELLED"].includes(claim.reimbursement.status) ? <form action={cancelApprovedClaimAction} className={styles.pay}><input type="hidden" name="claimId" value={claim.id} /><input type="hidden" name="expectedRevision" value={claim.revision} /><label>Cancellation reason<input name="reason" required minLength={5} maxLength={500} /></label><button>Cancel approved Claim</button></form> : null}
          </article>
        )) : <p>No Claims match this view.</p>}</div>
      </section>

      {canManage ? <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p>Effective-dated policy</p><h2>Create immutable revision</h2></div></div>
        <form action={createClaimPolicyRevisionAction} className={styles.settings}>
          <label>Existing category (optional)<select name="categoryId"><option value="">New category</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label>Code<input name="code" required pattern="[A-Z0-9_]{2,40}" /></label><label>Name<input name="name" required minLength={2} maxLength={120} /></label>
          <label>Nature<select name="nature"><option value="GENERAL">General</option><option value="MILEAGE">Mileage</option></select></label><label>Effective from<input name="effectiveFrom" type="date" required /></label>
          <label>Max line amount<input name="maxLineAmount" type="number" min="0.01" step="0.01" /></label><label>Mileage RM / km<input name="mileageRatePerKm" type="number" min="0.0001" step="0.0001" /></label>
          <label><input name="receiptRequired" type="checkbox" /> Receipt required</label><label><input name="descriptionRequired" type="checkbox" defaultChecked /> Description required</label>
          <label className={styles.full}>Description<input name="description" maxLength={500} /></label><label className={styles.full}>Reason<input name="reason" required minLength={5} maxLength={500} /></label>
          <p className={styles.full}>New revisions are always `REVIEW_REQUIRED` for statutory treatment; this UI cannot self-certify non-wage treatment.</p><button className={styles.full}>Create revision</button>
        </form>
      </section> : null}
    </main>
  );
}
