import Link from "next/link";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getManagerLeaveDashboard } from "@/lib/leave/service";
import { installLeavePresetAction, reviewLeaveRequestAction, updateLeaveBalanceAction } from "./actions";
import styles from "./leave.module.css";

type Props = { searchParams: Promise<{ year?: string; type?: string; message?: string }> };

export default async function LeavePage({ searchParams }: Props) {
  const { access } = await requireBusinessUser("VIEW_ATTENDANCE_EMPLOYEES");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const requestedYear = Number(params.year);
  const year = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= 2200 ? requestedYear : new Date().getUTCFullYear();
  const data = await getManagerLeaveDashboard({ businessId: scope.businessId, allowedBranchIds: scope.allowedBranchIds, year });
  const canModify = hasBusinessCapability(access, "MODIFY_ATTENDANCE_EMPLOYEES");
  const canViewTeamDirectory = hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const canViewPayroll = hasBusinessCapability(access, "VIEW_PAYROLL_RUN");

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>HR &amp; Payroll / Leave</p><h1>Leave management</h1><p>Employee requests, manager approval and auditable balances in one place.</p></div>
        <nav>
          {canViewTeamDirectory ? <Link href="/team?section=people">People</Link> : null}
          <Link href="/team/attendance">Attendance</Link>
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
          <div><p className={styles.eyebrow}>Setup required</p><h2>Choose the correct legal policy first</h2><p>The preset below is for Peninsular Malaysia and Labuan. Sabah and Sarawak businesses should use custom company rules because their labour ordinances differ.</p></div>
          {canModify ? <form action={installLeavePresetAction}><button type="submit">Install Peninsular / Labuan template</button></form> : null}
        </section>
      ) : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Approval queue</p><h2>Leave requests</h2></div><span>{data.requests.length} record(s)</span></div>
        <div className={styles.requestList}>
          {data.requests.length === 0 ? <p className={styles.empty}>No leave requests for {year}.</p> : data.requests.map((request) => (
            <article className={styles.request} key={request.id}>
              <div className={styles.requestMain}>
                <div className={styles.avatar}>{request.employee.fullName.split(/\s+/).map((v) => v[0]).join("").slice(0, 2).toUpperCase()}</div>
                <div>{canViewTeamDirectory ? <Link className={styles.employeeLink} href={`/team/people/${request.employee.id}`}>{request.employee.fullName}</Link> : <strong>{request.employee.fullName}</strong>}<span>{request.employee.employeeCode} · {request.branch.name}</span><p>{request.policyName} · {request.startsOn} — {request.endsOn} · {request.requestedDays} day(s)</p><small>{request.reason}</small></div>
              </div>
              <div className={styles.requestSide}><span className={`${styles.badge} ${styles[request.status.toLowerCase()]}`}>{request.status}</span>{request.documentReference ? isNavigableDocumentReference(request.documentReference) ? <a href={request.documentReference} rel="noreferrer" target="_blank">Supporting document</a> : <span className={styles.documentReference}>Document reference: {request.documentReference}</span> : null}</div>
              {canModify && request.status === "PENDING" ? (
                <form action={reviewLeaveRequestAction} className={styles.reviewForm}>
                  <input type="hidden" name="requestId" value={request.id} />
                  <input name="reviewNote" placeholder="Optional review note" maxLength={500} />
                  <button name="decision" value="APPROVED" type="submit">Approve</button>
                  <button className={styles.reject} name="decision" value="REJECTED" type="submit">Reject</button>
                </form>
              ) : request.reviewNote ? <p className={styles.reviewNote}>Review: {request.reviewNote}</p> : null}
            </article>
          ))}
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Company policy</p><h2>Leave types</h2></div></div>
          <div className={styles.policyList}>{data.policies.map((policy) => <article key={policy.id}><div><strong>{policy.name}</strong><span>{policy.code.replaceAll("_", " ")}</span></div><div><b>{policy.payTreatment}</b><small>{policy.countMode === "WEEKDAYS" ? "Working weekdays" : "Calendar days"}</small></div></article>)}</div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Employee override</p><h2>Adjust balance</h2></div></div>
          {canModify && data.policies.length && data.employees.length ? (
            <form action={updateLeaveBalanceAction} className={styles.balanceForm}>
              <label>Employee<select name="membershipId" required>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.fullName} ({employee.employeeCode})</option>)}</select></label>
              <label>Leave type<select name="policyId" required>{data.policies.filter((policy) => policy.balanceTracked).map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}</select></label>
              <label>Year<input name="year" type="number" min="2000" max="2200" defaultValue={year} required /></label>
              <label>Entitlement override<input name="entitlementOverrideDays" type="number" min="0" max="366" step="0.5" placeholder="Use policy default" /></label>
              <label>Carry forward<input name="carriedForwardDays" type="number" min="0" max="366" step="0.5" defaultValue="0" /></label>
              <label>Adjustment (+/-)<input name="adjustmentDays" type="number" min="-366" max="366" step="0.5" defaultValue="0" /></label>
              <label className={styles.full}>Note<input name="note" maxLength={500} placeholder="Reason for manual adjustment" /></label>
              <button className={styles.full} type="submit">Save balance</button>
            </form>
          ) : <p className={styles.empty}>Install policies and create active employees before adjusting balances.</p>}
        </section>
      </div>
    </main>
  );
}

function isNavigableDocumentReference(value: string) {
  return /^(https?:\/\/|\/)/i.test(value);
}
