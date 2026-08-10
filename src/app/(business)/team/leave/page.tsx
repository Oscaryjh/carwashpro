import { randomUUID } from "node:crypto";
import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerLeaveDashboard } from "@/lib/leave/service";
import {
  cancelApprovedLeaveAction,
  createLeavePolicyVersionAction,
  installLeaveStarterAction,
  reviewLeaveRequestAction,
  updateLeaveBalanceAction,
} from "./actions";
import styles from "./leave.module.css";

type Props = { searchParams: Promise<{ year?: string; employee?: string; branch?: string; status?: string; policy?: string; date?: string; type?: string; message?: string }> };

export default async function LeavePage({ searchParams }: Props) {
  const { access } = await requireBusinessUser("VIEW_LEAVE");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const requestedYear = Number(params.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200 ? requestedYear : new Date().getUTCFullYear();
  const data = await getManagerLeaveDashboard({ businessId: scope.businessId, allowedBranchIds: scope.allowedBranchIds, year });
  const canApprove = hasBusinessCapability(access, "APPROVE_LEAVE");
  const canEditPolicy = hasBusinessCapability(access, "EDIT_LEAVE_POLICY");
  const canAdjust = hasBusinessCapability(access, "ADJUST_LEAVE_BALANCE");
  const canViewTeamDirectory = hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const canViewAttendance = hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canViewPayroll = hasBusinessCapability(access, "VIEW_PAYROLL_RUN");
  const filteredRequests = data.requests.filter((request) => {
    const employee = params.employee?.trim().toLowerCase();
    return (!employee || request.employee.fullName.toLowerCase().includes(employee) || request.employee.employeeCode.toLowerCase().includes(employee))
      && (!params.branch || request.branch.id === params.branch)
      && (!params.status || request.status === params.status)
      && (!params.policy || request.policyId === params.policy)
      && (!params.date || (request.startsOn <= params.date && request.endsOn >= params.date));
  });
  const branches = [...new Map(data.requests.map((request) => [request.branch.id, request.branch])).values()];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>HR / Leave</p><h1>Leave management</h1><p>Employee-selected Leave, immutable policy snapshots and ledger-backed balances.</p></div>
        <nav>
          {canViewTeamDirectory ? <Link href="/team?section=people">People</Link> : null}
          {canViewAttendance ? <Link href="/team/attendance">Attendance</Link> : null}
          {canViewPayroll ? <Link href="/team/payroll/workspace">Payroll</Link> : null}
        </nav>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success} role="status">{params.message}</div> : null}

      <section className={styles.summary}>
        <article><span>Pending approval</span><strong>{data.summary.pending}</strong></article>
        <article><span>Approved in {year}</span><strong>{data.summary.approved}</strong></article>
        <article><span>Active employees</span><strong>{data.summary.employees}</strong></article>
        <form><label>Leave year<input type="number" name="year" min="2000" max="2200" defaultValue={year} /></label><button type="submit">View</button></form>
      </section>

      {data.policies.length === 0 ? (
        <section className={styles.setup}>
          <div><p className={styles.eyebrow}>Setup required</p><h2>Install company-policy starters</h2><p>No Malaysia statutory entitlement is guessed. Starters begin with zero paid entitlement and must be deliberately configured.</p></div>
          {canEditPolicy ? <form action={installLeaveStarterAction}><button type="submit">Install company starters</button></form> : null}
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Approval inbox</p><h2>Leave applications</h2></div><span>{filteredRequests.length} record(s)</span></div>
        <form className={styles.balanceForm}>
          <input type="hidden" name="year" value={year} />
          <label>Employee<input name="employee" defaultValue={params.employee} placeholder="Name or employee code" /></label>
          <label>Branch<select name="branch" defaultValue={params.branch ?? ""}><option value="">All authorized branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>Status<select name="status" defaultValue={params.status ?? ""}><option value="">All</option>{["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Leave type<select name="policy" defaultValue={params.policy ?? ""}><option value="">All</option>{data.policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
          <label>Date<input type="date" name="date" defaultValue={params.date} /></label>
          <button type="submit">Filter</button>
        </form>
        <div className={styles.requestList}>
          {filteredRequests.length === 0 ? <p className={styles.empty}>No Leave applications match this view.</p> : filteredRequests.map((request) => (
            <article className={styles.request} key={request.id}>
              <div className={styles.requestMain}>
                <div className={styles.avatar}>{request.employee.fullName.split(/\s+/).map((value) => value[0]).join("").slice(0, 2).toUpperCase()}</div>
                <div>
                  {canViewTeamDirectory ? <Link className={styles.employeeLink} href={`/team/people/${request.employee.id}?section=leave`}>{request.employee.fullName}</Link> : <strong>{request.employee.fullName}</strong>}
                  <span>{request.employee.employeeCode} · {request.branch.name}</span>
                  <p>{request.policyName} · {request.startsOn} — {request.endsOn} · {request.requestedDays} day(s) · {request.leaveUnit.replaceAll("_", " ")}</p>
                  <small>{request.reason}</small>
                  <small>Employee-selected type · {request.payTreatment} · current balance {formatBalance(request.currentBalance)} · {request.status === "PENDING" ? "after approval" : "balance after decision"} {formatBalance(request.resultingBalance)}</small>
                  <small>Attendance impact: {request.payTreatment === "PAID" ? "APPROVED_PAID_LEAVE" : "APPROVED_UNPAID_LEAVE"}; manager cannot change this treatment.</small>
                </div>
              </div>
              <div className={styles.requestSide}><span className={`${styles.badge} ${styles[request.status.toLowerCase()]}`}>{request.status}</span>{request.documentReference ? <span className={styles.documentReference}>Supporting evidence recorded</span> : null}</div>
              {canApprove && request.status === "PENDING" ? (
                <form action={reviewLeaveRequestAction} className={styles.reviewForm}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="expectedRevision" value={request.revision} />
                  <input name="reviewNote" placeholder="Reason required for rejection" maxLength={500} />
                  <button name="decision" value="APPROVED" type="submit">Approve frozen treatment</button>
                  <button className={styles.reject} name="decision" value="REJECTED" type="submit">Reject</button>
                </form>
              ) : null}
              {canApprove && request.status === "APPROVED" ? (
                <form action={cancelApprovedLeaveAction} className={styles.reviewForm}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input type="hidden" name="expectedRevision" value={request.revision} />
                  <input name="reason" required minLength={3} maxLength={500} placeholder="Cancellation reason" />
                  <button className={styles.reject} type="submit">Cancel approved Leave</button>
                </form>
              ) : null}
              {request.reviewNote ? <p className={styles.reviewNote}>Decision reason: {request.reviewNote}</p> : null}
              {request.cancellationReason ? <p className={styles.reviewNote}>Cancellation reason: {request.cancellationReason}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Effective-dated policy</p><h2>Leave types</h2></div></div>
          <div className={styles.policyList}>{data.policies.map((policy) => {
            const version = policy.latestVersion;
            return <article key={policy.id}><div><strong>{version?.nameSnapshot ?? policy.name}</strong><span>{policy.code.replaceAll("_", " ")} · revision {version?.revision ?? "missing"}</span></div><div><b>{version?.payTreatment ?? policy.payTreatment}</b><small>{version?.legalStatus ?? "LEAVE_POLICY_NOT_READY"}</small></div></article>;
          })}</div>
          <p className={styles.empty}>Company Policy ≠ Statutory Minimum. Unverified legal policies remain blocked as `LEAVE_LEGAL_RULE_NOT_READY` or `LEGACY_LEAVE_REVIEW_REQUIRED`.</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Immutable ledger</p><h2>Adjust balance</h2></div></div>
          {canAdjust && data.policies.length && data.employees.length ? (
            <form action={updateLeaveBalanceAction} className={styles.balanceForm}>
              <input type="hidden" name="sourceKey" value={randomUUID()} />
              <label>Employee<select name="membershipId" required>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeCode})</option>)}</select></label>
              <label>Leave type<select name="policyId" required>{data.policies.filter((policy) => policy.latestVersion?.balanceTracked).map((policy) => <option key={policy.id} value={policy.id}>{policy.latestVersion?.nameSnapshot ?? policy.name}</option>)}</select></label>
              <label>Year<input name="year" type="number" min="2000" max="2200" defaultValue={year} required /></label>
              <label>Adjustment (+/-)<input name="units" type="number" min="-366" max="366" step="0.5" required /></label>
              <label className={styles.full}>Reason<input name="reason" required minLength={3} maxLength={500} placeholder="Mandatory adjustment reason" /></label>
              <button className={styles.full} type="submit">Append adjustment</button>
            </form>
          ) : <p className={styles.empty}>A dedicated balance-adjustment permission and an effective tracked policy are required.</p>}
        </section>
      </div>

      {canEditPolicy && data.policies.length ? (
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Company policy revision</p><h2>Create effective revision</h2></div></div>
          <form action={createLeavePolicyVersionAction} className={styles.balanceForm}>
            <label>Leave type<select name="policyId" required>{data.policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
            <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={`${year}-01-01`} /></label>
            <label>Name<input name="name" required minLength={2} maxLength={120} /></label>
            <label>Pay treatment<select name="payTreatment"><option value="PAID">Paid company benefit</option><option value="UNPAID">Unpaid</option></select></label>
            <label>Counting rule<select name="countMode"><option value="WEEKDAYS">Expected workdays only</option><option value="CALENDAR_DAYS">Calendar days</option></select></label>
            <label>Default entitlement<input name="defaultEntitlementDays" type="number" min="0" max="366" step="0.5" /></label>
            <label>Under 2 years<input name="underTwoYearsDays" type="number" min="0" max="366" step="0.5" /></label>
            <label>2 to under 5 years<input name="twoToFiveYearsDays" type="number" min="0" max="366" step="0.5" /></label>
            <label>5+ years<input name="fiveYearsPlusDays" type="number" min="0" max="366" step="0.5" /></label>
            <label><input name="balanceTracked" type="checkbox" /> Track balance</label>
            <label><input name="requiresDocument" type="checkbox" /> Require supporting evidence</label>
            <label><input name="allowNegativeBalance" type="checkbox" /> Explicitly allow negative balance</label>
            <label className={styles.full}>Reason<input name="reason" required minLength={3} maxLength={500} placeholder="Why this company policy changes" /></label>
            <button className={styles.full} type="submit">Create immutable revision</button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function formatBalance(value: number | null) {
  return value === null ? "not tracked" : `${value.toFixed(1)} day(s)`;
}
