import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { formatBranchLocalDateTime } from "@/lib/attendance/work-date";
import { getStaffAttendanceCorrectionQueue } from "@/lib/staff-pwa/team-approvals";
import {
  reviewMobileAttendanceCorrectionAction,
  reviewMobilePendingAttendanceExceptionAction,
} from "./actions";

export const metadata: Metadata = { title: "Attendance Corrections" };
export const dynamic = "force-dynamic";

export default async function StaffAttendanceCorrectionQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const requestedPage = Math.max(1, Number(query.page) || 1);
  const queue = await getStaffAttendanceCorrectionQueue({ auth, page: requestedPage });
  const message = typeof query.message === "string" ? query.message : null;
  const messageType = query.type === "error" ? "error" : "success";

  if (!queue) {
    return (
      <section className="staff-attendance-approval-page">
        <Link className="staff-page-back" href="/staff/requests">← Requests</Link>
        <div className="staff-page-card staff-approval-empty" role="alert">
          <strong>Manager access required</strong>
          <span>Attendance corrections are available only to an authorized manager in this workplace.</span>
          <Link className="staff-secondary-button" href="/staff/requests">Back to my requests</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="staff-attendance-approval-page" aria-labelledby="attendance-corrections-heading">
      <Link className="staff-page-back" href="/staff/requests">← Requests</Link>
      <header className="staff-approval-header">
        <div>
          <p className="staff-kicker">TEAM ATTENDANCE</p>
          <h1 id="attendance-corrections-heading">Attendance corrections</h1>
          <p>Review employee-submitted time corrections in your authorized branch.</p>
        </div>
        <span>{queue.totalWaiting} waiting</span>
      </header>

      {message ? <div className={`staff-alert ${messageType}`} role="status">{message}</div> : null}
      <div className="staff-attendance-approval-scope">
        <span>Authorized branches</span>
        <strong>{queue.access.wholeBusinessScope ? "All active branches" : `${queue.access.allowedBranchIds.length} branch`}</strong>
      </div>

      <div className="staff-attendance-approval-list">
        {queue.pendingExceptions.map((item) => {
          const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
          const workDate = item.attendanceSession?.workDate ?? item.createdAt;
          return (
            <article className="staff-attendance-approval-card" id={`correction-${item.id}`} key={item.id}>
              <header>
                <span className="staff-approval-domain attendance">AT</span>
                <div>
                  <small>{item.branch.name} · {formatWorkDate(workDate)}</small>
                  <strong>{item.employee.fullName}</strong>
                  <span>{item.employee.employeeCode} · {formatReason(item.type)}</span>
                </div>
                <b>Pending review</b>
              </header>
              <dl>
                <div><dt>Recorded clock-in</dt><dd>{item.attendanceSession?.clockInAt ? formatLocal(item.attendanceSession.clockInAt, timezone) : "Not recorded"}</dd></div>
                <div><dt>Recorded clock-out</dt><dd>{item.attendanceSession?.clockOutAt ? formatLocal(item.attendanceSession.clockOutAt, timezone) : "Missing"}</dd></div>
                <div><dt>Submitted</dt><dd>{formatLocal(item.createdAt, timezone)}</dd></div>
              </dl>
              <div className="staff-attendance-approval-request">
                <small>EMPLOYEE REQUEST</small>
                <p>{item.reason}</p>
                {item.requestedClockInAt || item.requestedClockOutAt ? (
                  <span>Requested time: {item.requestedClockInAt ? formatLocal(item.requestedClockInAt, timezone) : "—"} → {item.requestedClockOutAt ? formatLocal(item.requestedClockOutAt, timezone) : "—"}</span>
                ) : null}
              </div>
              <details className="staff-attendance-approval-actions">
                <summary>Review and decide <span aria-hidden="true">⌄</span></summary>
                <form action={reviewMobilePendingAttendanceExceptionAction}>
                  <input name="exceptionId" type="hidden" value={item.id} />
                  <input name="decision" type="hidden" value="APPROVED" />
                  <label><span>Decision note (optional)</span><input maxLength={500} name="reviewNote" placeholder="Add context for the attendance record" /></label>
                  <p className="staff-form-hint">Approving applies the employee&apos;s requested time through the canonical Attendance workflow. It does not run Payroll.</p>
                  <button className="staff-primary-button" type="submit">Approve correction</button>
                </form>
                <form action={reviewMobilePendingAttendanceExceptionAction} className="staff-attendance-return-form">
                  <input name="exceptionId" type="hidden" value={item.id} />
                  <input name="decision" type="hidden" value="REJECTED" />
                  <label><span>Why is this request rejected?</span><textarea maxLength={500} name="reviewNote" placeholder="Optional review note" rows={2} /></label>
                  <button className="staff-secondary-button" type="submit">Reject request</button>
                </form>
              </details>
            </article>
          );
        })}
        {queue.items.map((item) => {
          const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
          const submission = item.events.find((event) => event.type === "EMPLOYEE_SUBMITTED");
          const correctionClockIn = submission?.proposedClockInAt ?? item.attendanceSession.clockInAt;
          const correctionClockOut = submission?.proposedClockOutAt ?? item.attendanceSession.clockOutAt;
          const correctionBreak = submission?.proposedBreakMinutes ?? item.attendanceSession.totalBreakMinutes;
          const canApproveCorrection = Boolean(correctionClockIn && correctionClockOut);
          return (
            <article className="staff-attendance-approval-card" id={`correction-${item.id}`} key={item.id}>
              <header>
                <span className="staff-approval-domain attendance">AT</span>
                <div>
                  <small>{item.branch.name} · {formatWorkDate(item.attendanceSession.workDate)}</small>
                  <strong>{item.employee.fullName}</strong>
                  <span>{item.employee.employeeCode} · {formatReason(item.openedReason)}</span>
                </div>
                <b>Pending review</b>
              </header>
              <dl>
                <div><dt>Recorded clock-in</dt><dd>{formatLocal(item.attendanceSession.clockInAt, timezone)}</dd></div>
                <div><dt>Recorded clock-out</dt><dd>{item.attendanceSession.clockOutAt ? formatLocal(item.attendanceSession.clockOutAt, timezone) : "Missing"}</dd></div>
                <div><dt>Requested</dt><dd>{submission ? formatLocal(submission.createdAt, timezone) : "Employee response recorded"}</dd></div>
              </dl>
              <div className="staff-attendance-approval-request">
                <small>EMPLOYEE REQUEST</small>
                <p>{submission?.reason ?? "Review the submitted attendance correction."}</p>
                {submission?.proposedClockInAt || submission?.proposedClockOutAt ? (
                  <span>Requested time: {submission.proposedClockInAt ? formatLocal(submission.proposedClockInAt, timezone) : "—"} → {submission.proposedClockOutAt ? formatLocal(submission.proposedClockOutAt, timezone) : "—"}</span>
                ) : null}
              </div>
              <details className="staff-attendance-approval-actions">
                <summary>Review and decide <span aria-hidden="true">⌄</span></summary>
                {canApproveCorrection ? (
                  <form action={reviewMobileAttendanceCorrectionAction}>
                    <HiddenCaseFields item={item} />
                    <input name="action" type="hidden" value="APPLY_CORRECTION" />
                    <div className="staff-attendance-correction-fields">
                      <label><span>Clock in</span><input defaultValue={toLocalInput(correctionClockIn!, timezone)} name="correctedClockInLocal" required type="datetime-local" /></label>
                      <label><span>Clock out</span><input defaultValue={toLocalInput(correctionClockOut!, timezone)} name="correctedClockOutLocal" required type="datetime-local" /></label>
                      <label><span>Break minutes</span><input defaultValue={correctionBreak} min="0" name="correctedBreakMinutes" required type="number" /></label>
                    </div>
                    <label><span>Decision note</span><input defaultValue="Approved employee attendance correction." maxLength={500} minLength={3} name="reason" required /></label>
                    <p className="staff-form-hint">This creates the canonical corrected attendance result. It does not run Payroll.</p>
                    <button className="staff-primary-button" type="submit">Approve corrected time</button>
                  </form>
                ) : (
                  <div className="staff-alert warning">The employee did not provide a complete corrected time. Return the request for more information.</div>
                )}
                <form action={reviewMobileAttendanceCorrectionAction} className="staff-attendance-return-form">
                  <HiddenCaseFields item={item} />
                  <input name="action" type="hidden" value="RETURN_TO_EMPLOYEE" />
                  <label><span>What should the employee correct?</span><textarea maxLength={500} minLength={3} name="reason" placeholder="Explain what is missing" required rows={2} /></label>
                  <button className="staff-secondary-button" type="submit">Return to employee</button>
                </form>
              </details>
            </article>
          );
        })}
        {!queue.totalWaiting ? (
          <div className="staff-page-card staff-approval-empty">
            <strong>No attendance corrections waiting</strong>
            <span>New employee submissions in your authorized branch will appear here.</span>
          </div>
        ) : null}
      </div>

      {queue.totalPages > 1 ? (
        <nav className="staff-approval-pagination" aria-label="Attendance correction pages">
          {queue.currentPage > 1 ? <Link href={`?page=${queue.currentPage - 1}`}>Previous</Link> : <span />}
          <small>Page {queue.currentPage} of {queue.totalPages}</small>
          {queue.currentPage < queue.totalPages ? <Link href={`?page=${queue.currentPage + 1}`}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function HiddenCaseFields({ item }: { item: { id: string; updatedAt: Date; currentFinalResultId: string | null } }) {
  return (
    <>
      <input name="resolutionCaseId" type="hidden" value={item.id} />
      <input name="expectedUpdatedAt" type="hidden" value={item.updatedAt.toISOString()} />
      <input name="expectedCurrentResultId" type="hidden" value={item.currentFinalResultId ?? ""} />
    </>
  );
}

function toLocalInput(value: Date, timezone: string) {
  return formatBranchLocalDateTime(value, timezone).slice(0, 16);
}

function formatLocal(value: Date, timezone: string) {
  return value.toLocaleString("en-MY", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

function formatWorkDate(value: Date) {
  return value.toLocaleDateString("en-MY", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
}

function formatReason(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
