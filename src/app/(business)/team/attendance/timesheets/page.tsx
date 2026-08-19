import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { loadMonthlyAttendanceTimesheet } from "@/lib/attendance/timesheet-service";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import {
  approveTimesheetAction,
  beginTimesheetRevisionAction,
  decideOvertimeAction,
  lockTimesheetAction,
  markTimesheetBranchReadyAction,
} from "./actions";
import styles from "./timesheets.module.css";

type Props = {
  searchParams: Promise<{ month?: string; type?: string; message?: string }>;
};

export default async function AttendanceTimesheetsPage({ searchParams }: Props) {
  const { access, businessId, user } = await requireBusinessUser("VIEW_ATTENDANCE_EMPLOYEES");
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
  const approved = data.timesheet?.status === "APPROVED";
  const changedAfterLock = Boolean(
    locked && data.timesheet?.approvalSourceDigest !== data.currentSourceDigest,
  );
  const monthLabel = formatMonth(month);
  const statusLabel = locked
    ? `Locked · Revision ${data.timesheet?.currentRevision?.revision}`
    : approved
      ? `Approved · Version ${data.timesheet?.approvalRevision}`
      : "In progress";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span>Attendance</span>
          <div className={styles.titleRow}>
            <h1>Monthly timesheets</h1>
            <strong className={`${styles.statusPill} ${locked || approved ? styles.locked : styles.draft}`}>{statusLabel}</strong>
          </div>
          <p>Check final attendance hours and approve the month when every store is complete.</p>
        </div>
        <Link className={styles.issueLink} href="/team/attendance/resolutions">
          <span>Attendance issues</span>
          {data.totals.blockers > 0 ? <strong>{data.totals.blockers}</strong> : null}
        </Link>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}

      <section className={styles.periodBar}>
        <div className={styles.periodSummary}>
          <span>Timesheet period</span>
          <strong>{monthLabel}</strong>
          <small>Malaysia time</small>
        </div>
        <form action="/team/attendance/timesheets">
          <label><span>Choose another month</span><input defaultValue={month} name="month" type="month" /></label>
          <button type="submit">View</button>
        </form>
      </section>

      <section className={styles.metrics} aria-label="Timesheet summary">
        <Metric label="Attendance records" value={String(data.totals.sessions)} note="Recorded this month" />
        <Metric label="Finalised" value={String(data.totals.included + data.totals.excluded)} note={`${data.totals.included} counted · ${data.totals.excluded} not counted`} />
        <Metric label="Needs attention" value={String(data.totals.blockers)} note={data.totals.blockers ? "Resolve before approval" : "No attendance issues"} tone={data.totals.blockers ? "warning" : "good"} />
        <Metric label="Stores confirmed" value={`${data.totals.readyBranches}/${data.totals.totalBranches}`} note={data.allBranchesReady ? "Ready for approval" : "Review still in progress"} tone={data.allBranchesReady ? "good" : "neutral"} />
      </section>

      {data.branches.some((branch) => branch.overtimeCandidates.length > 0) ? (
        <section className={styles.overtimeSection} id="overtime-review">
          <div className={styles.sectionHeading}>
            <div><span>Overtime review</span><h2>Classify potential OT before locking</h2></div>
            <p>Attendance owns this decision. Payroll receives only the approved minutes after the monthly timesheet is locked.</p>
          </div>
          <div className={styles.overtimeList}>
            {data.branches.flatMap((branch) => branch.overtimeCandidates).map((candidate) => {
              const pending = candidate.effectiveStatus === "PENDING_REVIEW";
              const blocked = Boolean(candidate.blockedReason);
              const canReview = candidate.employeeUserId !== user.userId;
              return (
                <article className={styles.overtimeCard} key={candidate.finalResultId}>
                  <div className={styles.overtimeFacts}>
                    <div>
                      <strong>{candidate.employeeName}</strong>
                      <span>{candidate.employeeCode} · {candidate.branchName}</span>
                    </div>
                    <div><span>Work date</span><strong>{formatDate(candidate.workDate)}</strong></div>
                    <div><span>Potential OT</span><strong>{formatMinutes(candidate.potentialOtMinutes)}</strong></div>
                    <div><span>Context</span><strong>{formatStatus(candidate.context)}</strong></div>
                    <strong className={`${styles.otStatus} ${pending ? styles.otPending : styles.otResolved}`}>
                      {candidate.stale ? "Review again" : formatStatus(candidate.effectiveStatus)}
                    </strong>
                  </div>
                  {blocked ? (
                    <p className={styles.otBlocked}>
                      Resolve the full-day Leave and Attendance conflict before reviewing OT.
                    </p>
                  ) : pending && !canReview ? (
                    <p className={styles.otBlocked}>You cannot approve your own overtime. Another authorised manager must review it.</p>
                  ) : pending && !locked && !approved && canModify ? (
                    <div className={styles.otActions}>
                      <form action={decideOvertimeAction}>
                        <OvertimeHiddenFields candidate={candidate} month={month} />
                        <input name="decision" type="hidden" value="APPROVE" />
                        <button type="submit">Approve full OT</button>
                      </form>
                      <form action={decideOvertimeAction} className={styles.otDecisionForm}>
                        <OvertimeHiddenFields candidate={candidate} month={month} />
                        <input name="decision" type="hidden" value="ADJUST" />
                        <label><span>Approved minutes</span><input max={candidate.potentialOtMinutes} min={0} name="approvedMinutes" required type="number" /></label>
                        <label><span>Adjustment reason</span><input maxLength={500} minLength={3} name="reason" required /></label>
                        <button type="submit">Approve adjusted</button>
                      </form>
                      <form action={decideOvertimeAction} className={styles.otDecisionForm}>
                        <OvertimeHiddenFields candidate={candidate} month={month} />
                        <input name="decision" type="hidden" value="REJECT" />
                        <label><span>Rejection reason</span><input maxLength={500} minLength={3} name="reason" required /></label>
                        <button className={styles.rejectButton} type="submit">Reject OT</button>
                      </form>
                    </div>
                  ) : (
                    <p className={styles.otOutcome}>
                      Approved: <strong>{formatMinutes(candidate.review?.approvedOtMinutes ?? 0)}</strong>
                      {candidate.review?.reason ? ` · ${candidate.review.reason}` : ""}
                      {locked ? " · Reopen the monthly timesheet to change this decision." : ""}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {locked ? (
        <section className={styles.lockPanel}>
          <div>
            <span>Calculations boundary</span>
            <h2>Attendance Timesheet revision {data.timesheet?.currentRevision?.revision} is locked</h2>
            <p>Attendance and approved OT minutes are frozen by local date for Payroll. Monetary OT calculation remains deferred to Payroll P6C.</p>
            {data.timesheet?.currentRevision?.p2SegmentSnapshots.length ? (
              <details>
                <summary>View overnight breakdown</summary>
                <div className={styles.segmentList}>
                  {data.timesheet.currentRevision.p2SegmentSnapshots.map((segment, index) => (
                    <article key={`${segment.localDate.toISOString()}-${segment.startAt.toISOString()}-${index}`}>
                      <div>
                        <strong>{formatDate(segment.localDate)} · {segmentContextLabel(segment.context)}</strong>
                        <small>
                          {formatLocalTime(segment.startAt, segment.timezoneSnapshot)}–{formatLocalTime(segment.endAt, segment.timezoneSnapshot)}
                          {segment.isRestDay && segment.isPublicHoliday
                            ? " · Public holiday overlapping a Rest Day"
                            : ""}
                        </small>
                      </div>
                      <span>
                        {formatMinutes(segment.workedMinutes)} worked
                        {segment.breakMinutes > 0 ? ` · ${formatMinutes(segment.breakMinutes)} break` : ""}
                        {segment.approvedOtMinutes > 0 ? ` · ${formatMinutes(segment.approvedOtMinutes)} approved OT` : ""}
                      </span>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
            {changedAfterLock ? <strong className={styles.changed}>Final Attendance Results changed after this lock. Start a controlled revision to include them.</strong> : <strong>No source changes detected after lock.</strong>}
          </div>
          {canModify && wholeBusinessScope ? (
            <form action={beginTimesheetRevisionAction} className={styles.reasonForm}>
              <input name="month" type="hidden" value={month} />
              <input name="expectedUpdatedAt" type="hidden" value={data.timesheet?.updatedAt.toISOString()} />
              <label><span>Revision reason</span><textarea minLength={3} maxLength={500} name="reason" required rows={2} /></label>
              <button type="submit">Reopen Timesheet</button>
            </form>
          ) : null}
        </section>
      ) : null}

      <section className={styles.branchSection}>
        <div className={styles.sectionHeading}>
          <div><span>Store review</span><h2>Confirm attendance for each store</h2></div>
          <p>A confirmed store automatically returns to review if its final attendance changes.</p>
        </div>
        <div className={styles.branchGrid}>
          {data.branches.map((branch) => (
            <article className={styles.branchCard} key={branch.branchId}>
              <div className={styles.branchTitle}>
                <div><h3>{branch.branchName}</h3><span>{branch.sessionCount} attendance {branch.sessionCount === 1 ? "record" : "records"}</span></div>
                <strong className={branch.readinessStatus === "READY" ? styles.ready : styles.notReady}>
                  {branch.readinessStatus === "READY" ? "Ready for approval" : branch.stale ? "Review again" : "Needs review"}
                </strong>
              </div>
              <div className={styles.branchFacts}>
                <span><strong>{branch.includedCount}</strong>Counted</span>
                <span><strong>{branch.excludedCount}</strong>Not counted</span>
                <span><strong>{branch.blockerCount}</strong>Needs attention</span>
                <span><strong>{formatMinutes(branch.workedMinutes)}</strong>Total hours</span>
              </div>
              {branch.blockers.length ? (
                <div className={styles.blockers}>
                  <strong>Fix these attendance issues first</strong>
                  {branch.blockers.slice(0, 5).map((blocker) => (
                    <Link href={`/team/attendance/resolutions?employee=${encodeURIComponent(blocker.employeeName)}`} key={blocker.attendanceSessionId}>
                      <span>{blocker.employeeName} · {blocker.employeeCode}</span>
                      <small>{formatDate(blocker.workDate)} · {formatStatus(blocker.resolutionStatus ?? blocker.sessionStatus)}</small>
                    </Link>
                  ))}
                  {branch.blockers.length > 5 ? <small>+ {branch.blockers.length - 5} more issues</small> : null}
                </div>
              ) : (
                <p className={styles.clear}>All attendance records for this store have a current Final Attendance Result.</p>
              )}
              {!locked && !approved && canModify && branch.readinessStatus !== "READY" && branch.blockerCount === 0 ? (
                <form action={markTimesheetBranchReadyAction}>
                  <input name="month" type="hidden" value={month} />
                  <input name="branchId" type="hidden" value={branch.branchId} />
                  <button type="submit">Confirm this store</button>
                </form>
              ) : null}
            </article>
          ))}
          {!data.branches.length ? <div className={styles.empty}>No active branches are available in your Attendance scope.</div> : null}
        </div>
      </section>

      {!locked && !approved ? (
        <section className={styles.approval}>
          <div>
            <span>Final approval</span>
            <h2>Approve {monthLabel}</h2>
            <p>Approve only after every store is confirmed and there are no attendance issues. This records manager approval; it does not run Payroll.</p>
          </div>
          {!wholeBusinessScope ? <div className={styles.scopeNotice}>You can prepare your assigned store, but company-wide access is required to approve the month.</div> : canModify ? (
            <form action={approveTimesheetAction} className={styles.reasonForm}>
              <input name="month" type="hidden" value={month} />
              {data.timesheet ? <input name="expectedUpdatedAt" type="hidden" value={data.timesheet.updatedAt.toISOString()} /> : null}
              <label><span>Approval note</span><textarea minLength={3} maxLength={500} name="reason" placeholder="Why is this month ready for approval?" required rows={2} /></label>
              <button disabled={!data.allBranchesReady || data.totals.blockers > 0} type="submit">Approve monthly timesheet</button>
            </form>
          ) : <div className={styles.scopeNotice}>You have read-only Attendance access.</div>}
        </section>
      ) : null}

      {approved ? (
        <section className={styles.approval}>
          <div>
            <span>Immutable snapshot boundary</span>
            <h2>Lock approved Timesheet</h2>
            <p>The approval digest must still match current Attendance evidence. Locking creates a new immutable revision and does not generate Payroll.</p>
          </div>
          {canModify && wholeBusinessScope ? (
            <div>
              <form action={lockTimesheetAction} className={styles.reasonForm}>
                <input name="month" type="hidden" value={month} />
                <input name="expectedUpdatedAt" type="hidden" value={data.timesheet?.updatedAt.toISOString()} />
                <label><span>Lock reason</span><textarea minLength={3} maxLength={500} name="reason" required rows={2} /></label>
                <button type="submit">Lock approved Timesheet</button>
              </form>
              <form action={beginTimesheetRevisionAction} className={styles.reasonForm}>
                <input name="month" type="hidden" value={month} />
                <input name="expectedUpdatedAt" type="hidden" value={data.timesheet?.updatedAt.toISOString()} />
                <label><span>Reopen reason</span><textarea minLength={3} maxLength={500} name="reason" required rows={2} /></label>
                <button type="submit">Reopen approval</button>
              </form>
            </div>
          ) : <div className={styles.scopeNotice}>Whole-business modify permission is required to lock.</div>}
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
  const className = tone === "neutral" ? styles.metric : `${styles.metric} ${styles[tone]}`;
  return <article className={className}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function OvertimeHiddenFields({ candidate, month }: {
  candidate: { finalResultId: string; review: { revision: number } | null };
  month: string;
}) {
  return <>
    <input name="month" type="hidden" value={month} />
    <input name="finalResultId" type="hidden" value={candidate.finalResultId} />
    <input name="expectedRevision" type="hidden" value={candidate.review?.revision ?? 0} />
  </>;
}
function formatMinutes(value: number) { const hours = Math.floor(value / 60); const minutes = value % 60; return `${hours}h ${String(minutes).padStart(2, "0")}m`; }
function formatStatus(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function formatMonth(value: string) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(`${value}-01T00:00:00.000Z`)); }
function formatDate(value: Date) { return value.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }); }
function formatLocalTime(value: Date, timeZone: string) {
  return value.toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}
function segmentContextLabel(value: string) {
  if (value === "REST_DAY") return "Rest day";
  if (value === "PUBLIC_HOLIDAY") return "Public holiday";
  return "Normal workday";
}
