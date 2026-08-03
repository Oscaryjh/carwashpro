import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { loadMonthlyAttendanceTimesheet } from "@/lib/attendance/timesheet-service";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import {
  beginTimesheetRevisionAction,
  lockTimesheetAction,
  markTimesheetBranchReadyAction,
} from "./actions";
import styles from "./timesheets.module.css";

type Props = {
  searchParams: Promise<{ month?: string; type?: string; message?: string }>;
};

export default async function AttendanceTimesheetsPage({ searchParams }: Props) {
  const { access, businessId } = await requireBusinessUser("VIEW_ATTENDANCE_EMPLOYEES");
  const params = await searchParams;
  const scope = await resolveAttendanceScope(access);
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit" }).format(new Date());
  const [data, activeBranchCount] = await Promise.all([
    loadMonthlyAttendanceTimesheet({ businessId, allowedBranchIds: scope.allowedBranchIds, month }),
    prisma.branch.count({ where: { businessId, status: "ACTIVE" } }),
  ]);
  const canModify = hasBusinessCapability(access, "MODIFY_ATTENDANCE_EMPLOYEES");
  const wholeBusinessScope =
    scope.allowedBranchIds.length === activeBranchCount &&
    (access.effectiveBusinessRole !== "STAFF" || access.permissions.includes("ALL_BRANCHES"));
  const locked = data.timesheet?.status === "LOCKED";
  const changedAfterLock = Boolean(
    locked && data.timesheet?.currentRevision?.sourceDigest !== data.currentSourceDigest,
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>HR &amp; Payroll / Attendance</span>
          <h1>Monthly Timesheets</h1>
          <p>Review resolved attendance by branch, then approve an immutable monthly revision.</p>
        </div>
        <nav aria-label="Attendance navigation">
          <Link href="/team/attendance">Attendance</Link>
          <Link href="/team/attendance/resolutions">Resolution queue</Link>
        </nav>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}

      <section className={styles.periodBar}>
        <form action="/team/attendance/timesheets">
          <label><span>Timesheet month</span><input defaultValue={month} name="month" type="month" /></label>
          <button type="submit">View month</button>
        </form>
        <div className={styles.statusBlock}>
          <span>Monthly status</span>
          <strong className={locked ? styles.locked : styles.draft}>{locked ? `Locked · Revision ${data.timesheet?.currentRevision?.revision}` : "Draft"}</strong>
        </div>
      </section>

      <section className={styles.metrics} aria-label="Timesheet summary">
        <Metric label="Attendance sessions" value={String(data.totals.sessions)} note="Operational records in month" />
        <Metric label="Resolved results" value={String(data.totals.included + data.totals.excluded)} note={`${data.totals.included} included · ${data.totals.excluded} excluded`} />
        <Metric label="Blockers" value={String(data.totals.blockers)} note={data.totals.blockers ? "Resolution required" : "No unresolved attendance"} tone={data.totals.blockers ? "warning" : "good"} />
        <Metric label="Branch readiness" value={`${data.totals.readyBranches}/${data.totals.totalBranches}`} note="Uses current Final Results" tone={data.allBranchesReady ? "good" : "neutral"} />
      </section>

      {locked ? (
        <section className={styles.lockPanel}>
          <div>
            <span>Calculations boundary</span>
            <h2>Attendance Timesheet revision {data.timesheet?.currentRevision?.revision} is locked</h2>
            <p>This immutable snapshot is ready for future A4 Payroll Bridge work. Payroll calculation is not connected in A3.</p>
            {changedAfterLock ? <strong className={styles.changed}>Final Attendance Results changed after this lock. Start a controlled revision to include them.</strong> : <strong>No source changes detected after lock.</strong>}
          </div>
          {canModify && wholeBusinessScope && changedAfterLock ? (
            <form action={beginTimesheetRevisionAction} className={styles.reasonForm}>
              <input name="month" type="hidden" value={month} />
              <input name="expectedUpdatedAt" type="hidden" value={data.timesheet?.updatedAt.toISOString()} />
              <label><span>Revision reason</span><textarea minLength={3} maxLength={500} name="reason" required rows={2} /></label>
              <button type="submit">Start controlled revision</button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className={styles.branchSection}>
        <div className={styles.sectionHeading}>
          <div><span>Branch review</span><h2>Readiness by branch</h2></div>
          <p>Ready becomes stale automatically when a current Final Attendance Result changes.</p>
        </div>
        <div className={styles.branchGrid}>
          {data.branches.map((branch) => (
            <article className={styles.branchCard} key={branch.branchId}>
              <div className={styles.branchTitle}>
                <div><h3>{branch.branchName}</h3><span>{branch.sessionCount} sessions</span></div>
                <strong className={branch.readinessStatus === "READY" ? styles.ready : styles.notReady}>
                  {branch.readinessStatus === "READY" ? "Branch ready" : branch.stale ? "Ready is stale" : "Not ready"}
                </strong>
              </div>
              <div className={styles.branchFacts}>
                <span><strong>{branch.includedCount}</strong>Included</span>
                <span><strong>{branch.excludedCount}</strong>Excluded</span>
                <span><strong>{branch.blockerCount}</strong>Blockers</span>
                <span><strong>{formatMinutes(branch.workedMinutes)}</strong>Worked</span>
              </div>
              {branch.blockers.length ? (
                <div className={styles.blockers}>
                  <strong>Resolve before branch readiness</strong>
                  {branch.blockers.slice(0, 5).map((blocker) => (
                    <Link href={`/team/attendance/resolutions?employee=${encodeURIComponent(blocker.employeeName)}`} key={blocker.attendanceSessionId}>
                      <span>{blocker.employeeName} · {blocker.employeeCode}</span>
                      <small>{blocker.workDate.toISOString().slice(0, 10)} · {formatStatus(blocker.resolutionStatus ?? blocker.sessionStatus)}</small>
                    </Link>
                  ))}
                  {branch.blockers.length > 5 ? <small>+ {branch.blockers.length - 5} more blockers</small> : null}
                </div>
              ) : (
                <p className={styles.clear}>All sessions have a current Final Attendance Result.</p>
              )}
              {!locked && canModify && branch.readinessStatus !== "READY" && branch.blockerCount === 0 ? (
                <form action={markTimesheetBranchReadyAction}>
                  <input name="month" type="hidden" value={month} />
                  <input name="branchId" type="hidden" value={branch.branchId} />
                  <button type="submit">Mark branch ready</button>
                </form>
              ) : null}
            </article>
          ))}
          {!data.branches.length ? <div className={styles.empty}>No active branches are available in your Attendance scope.</div> : null}
        </div>
      </section>

      {!locked ? (
        <section className={styles.approval}>
          <div>
            <span>Whole-business approval</span>
            <h2>Lock the monthly Timesheet</h2>
            <p>Creates a new immutable revision from the exact current Final Attendance Results. It does not generate or refresh Payroll.</p>
          </div>
          {!wholeBusinessScope ? <div className={styles.scopeNotice}>Whole-business Attendance scope is required. Branch managers can prepare their branches but cannot lock the company month.</div> : canModify ? (
            <form action={lockTimesheetAction} className={styles.reasonForm}>
              <input name="month" type="hidden" value={month} />
              {data.timesheet ? <input name="expectedUpdatedAt" type="hidden" value={data.timesheet.updatedAt.toISOString()} /> : null}
              <label><span>Approval reason</span><textarea minLength={3} maxLength={500} name="reason" required rows={2} /></label>
              <button disabled={!data.allBranchesReady || data.totals.blockers > 0} type="submit">Approve and lock Timesheet</button>
            </form>
          ) : <div className={styles.scopeNotice}>You have read-only Attendance access.</div>}
        </section>
      ) : null}

      {data.timesheet?.revisions.length ? (
        <section className={styles.history}>
          <div className={styles.sectionHeading}><div><span>Audit trail</span><h2>Locked revisions</h2></div></div>
          <div className={styles.historyList}>
            {data.timesheet.revisions.map((revision) => (
              <article key={revision.id}>
                <strong>Revision {revision.revision}</strong>
                <span>{revision._count.entries} immutable attendance results</span>
                <span>{revision.lockedAt.toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" })}</span>
                <small>{revision.lockedBy.name} · {revision.reason}</small>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function Metric({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "good" | "warning" }) {
  return <article className={`${styles.metric} ${styles[tone]}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function formatMinutes(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return `${hours}h ${String(minutes).padStart(2, "0")}m`; }
function formatStatus(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
