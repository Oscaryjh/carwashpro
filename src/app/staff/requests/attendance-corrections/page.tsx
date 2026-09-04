import type { Metadata } from "next";
import Link from "next/link";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { StaffApprovalSheet } from "@/components/staff-pwa/staff-approval-sheet";
import {
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { formatBranchLocalDateTime } from "@/lib/attendance/work-date";
import { getStaffAttendanceCorrectionQueue } from "@/lib/staff-pwa/team-approvals";
import {
  reviewMobileAttendanceCorrectionAction,
  reviewMobilePendingAttendanceExceptionAction,
  reviewMobileP2AttendanceCorrectionAction,
} from "./actions";

export const metadata: Metadata = { title: "Attendance Review" };
export const dynamic = "force-dynamic";

export default async function StaffAttendanceCorrectionQueuePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const requestedPage = Math.max(1, Number(query.page) || 1);
  const queue = await getStaffAttendanceCorrectionQueue({ auth, page: requestedPage });
  const message = typeof query.message === "string" ? query.message : null;

  if (!queue) {
    return (
      <section className={`${staffV2Styles.scope} ${styles.page}`}>
        <Link className={styles.backLink} href="/staff/requests">← Requests</Link>
        <StaffV2EmptyState title="Manager access required" description="Attendance review is available only to an authorized manager in this workplace." />
      </section>
    );
  }

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`} aria-labelledby="attendance-review-heading">
      <Link className={styles.backLink} href="/staff/approvals">← Approvals</Link>
      <StaffV2PageHeader title="Attendance" meta="Review missing punches and submitted time corrections." />
      {message ? <div className={`${styles.alert} ${query.type === "error" ? styles.alertDanger : styles.alertSuccess}`} role="status">{message}</div> : null}
      <p className={styles.queueScope}>
        {queue.totalActionable} waiting · {queue.access.wholeBusinessScope ? "All active branches" : `${queue.access.allowedBranchIds.length} authorized branch${queue.access.allowedBranchIds.length === 1 ? "" : "es"}`}
      </p>
      {queue.items.length ? (
        <div className={styles.queueList} role="list" aria-label="Pending attendance approvals">
          {queue.items.map((source) => {
            if (source.sourceType === "P2_CORRECTION_REQUEST") {
              const item = source.item;
              const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
              const requestedTime = item.exceptionType === "MISSING_CLOCK_IN" ? item.requestedClockInAt : item.requestedClockOutAt;
              return (
                <QueueItem
                  branch={item.branch.name}
                  employee={item.employee.fullName}
                  key={source.sourceId}
                  meta={`${formatReason(item.exceptionType)} · ${formatWorkDate(item.workDate)}`}
                >
                  <StaffV2DetailSection title="Attendance">
                    <dl className={styles.detailFacts}>
                      <Fact label="Employee" value={`${item.employee.fullName} · ${item.employee.employeeCode}`} />
                      <Fact label="Work date" value={formatWorkDate(item.workDate)} />
                      <Fact label="Recorded clock-in" value={item.actualClockInAt ? formatLocal(item.actualClockInAt, timezone) : "Missing"} />
                      <Fact label="Recorded clock-out" value={item.actualClockOutAt ? formatLocal(item.actualClockOutAt, timezone) : "Missing"} />
                    </dl>
                  </StaffV2DetailSection>
                  <RequestCopy reason={item.reason} requested={`${item.exceptionType === "MISSING_CLOCK_IN" ? "Clock in" : "Clock out"}: ${requestedTime ? formatLocal(requestedTime, timezone) : "Not provided"}`} />
                  <div className={styles.inlineActions}>
                    {requestedTime ? (
                      <form action={reviewMobileP2AttendanceCorrectionAction}>
                        <P2HiddenFields item={item} />
                        <input name="decision" type="hidden" value="APPROVED" />
                        <input name="reason" type="hidden" value="Approved employee attendance correction." />
                        <button className={styles.primaryButton} type="submit">Approve</button>
                      </form>
                    ) : <div className={styles.alert}>The missing time was not provided, so this request cannot be approved.</div>}
                    <StaffApprovalSheet title="Reject attendance request" description="Tell the employee why this correction was not accepted." tone="danger" trigger="Reject">
                      <form action={reviewMobileP2AttendanceCorrectionAction}>
                        <P2HiddenFields item={item} />
                        <input name="decision" type="hidden" value="REJECTED" />
                        <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reason" placeholder="Add a clear, helpful reason" required rows={4} /></label>
                        <button className={styles.dangerButton} type="submit">Reject request</button>
                      </form>
                    </StaffApprovalSheet>
                  </div>
                </QueueItem>
              );
            }

            if (source.sourceType === "STANDALONE_EXCEPTION") {
              const item = source.item;
              const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
              const workDate = item.attendanceSession?.workDate ?? item.createdAt;
              return (
                <QueueItem branch={item.branch.name} employee={item.employee.fullName} key={source.sourceId} meta={`${formatReason(item.type)} · ${formatWorkDate(workDate)}`}>
                  <StaffV2DetailSection title="Attendance">
                    <dl className={styles.detailFacts}>
                      <Fact label="Employee" value={`${item.employee.fullName} · ${item.employee.employeeCode}`} />
                      <Fact label="Work date" value={formatWorkDate(workDate)} />
                      <Fact label="Recorded clock-in" value={item.attendanceSession?.clockInAt ? formatLocal(item.attendanceSession.clockInAt, timezone) : "Not recorded"} />
                      <Fact label="Recorded clock-out" value={item.attendanceSession?.clockOutAt ? formatLocal(item.attendanceSession.clockOutAt, timezone) : "Missing"} />
                    </dl>
                  </StaffV2DetailSection>
                  <RequestCopy
                    reason={item.reason}
                    requested={item.requestedClockInAt || item.requestedClockOutAt ? `${item.requestedClockInAt ? formatLocal(item.requestedClockInAt, timezone) : "—"} → ${item.requestedClockOutAt ? formatLocal(item.requestedClockOutAt, timezone) : "—"}` : undefined}
                  />
                  <div className={styles.inlineActions}>
                    <form action={reviewMobilePendingAttendanceExceptionAction}>
                      <input name="exceptionId" type="hidden" value={item.id} />
                      <input name="decision" type="hidden" value="APPROVED" />
                      <button className={styles.primaryButton} type="submit">Approve</button>
                    </form>
                    <StaffApprovalSheet title="Reject attendance request" description="Tell the employee why this correction was not accepted." tone="danger" trigger="Reject">
                      <form action={reviewMobilePendingAttendanceExceptionAction}>
                        <input name="exceptionId" type="hidden" value={item.id} />
                        <input name="decision" type="hidden" value="REJECTED" />
                        <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reviewNote" placeholder="Add a clear, helpful reason" required rows={4} /></label>
                        <button className={styles.dangerButton} type="submit">Reject request</button>
                      </form>
                    </StaffApprovalSheet>
                  </div>
                </QueueItem>
              );
            }

            const item = source.item;
            const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
            const submission = item.events.find((event) => event.type === "EMPLOYEE_SUBMITTED");
            const correctionClockIn = submission?.proposedClockInAt ?? item.attendanceSession.clockInAt;
            const correctionClockOut = submission?.proposedClockOutAt ?? item.attendanceSession.clockOutAt;
            const breakNeedsVerification = Boolean(submission?.proposedClockInAt && submission.proposedBreakMinutes === null);
            const correctionBreak = breakNeedsVerification ? "" : submission?.proposedBreakMinutes ?? item.attendanceSession.totalBreakMinutes;
            const canApproveCorrection = Boolean(correctionClockIn && correctionClockOut);
            return (
              <QueueItem branch={item.branch.name} employee={item.employee.fullName} key={source.sourceId} meta={`${formatReason(item.openedReason)} · ${formatWorkDate(item.attendanceSession.workDate)}`}>
                <StaffV2DetailSection title="Attendance">
                  <dl className={styles.detailFacts}>
                    <Fact label="Employee" value={`${item.employee.fullName} · ${item.employee.employeeCode}`} />
                    <Fact label="Work date" value={formatWorkDate(item.attendanceSession.workDate)} />
                    <Fact label="Recorded clock-in" value={formatLocal(item.attendanceSession.clockInAt, timezone)} />
                    <Fact label="Recorded clock-out" value={item.attendanceSession.clockOutAt ? formatLocal(item.attendanceSession.clockOutAt, timezone) : "Missing"} />
                  </dl>
                </StaffV2DetailSection>
                <RequestCopy
                  reason={submission?.reason ?? "Review the submitted attendance correction."}
                  requested={submission?.proposedClockInAt || submission?.proposedClockOutAt ? `${submission.proposedClockInAt ? formatLocal(submission.proposedClockInAt, timezone) : "—"} → ${submission.proposedClockOutAt ? formatLocal(submission.proposedClockOutAt, timezone) : "—"}` : undefined}
                />
                {canApproveCorrection ? (
                  <form action={reviewMobileAttendanceCorrectionAction} className={styles.inlineForm}>
                    <HiddenCaseFields item={item} />
                    <input name="action" type="hidden" value="APPLY_CORRECTION" />
                    <div className={styles.durationGrid}>
                      <label><span>Clock in</span><input defaultValue={toLocalInput(correctionClockIn!, timezone)} name="correctedClockInLocal" required type="datetime-local" /></label>
                      <label><span>Clock out</span><input defaultValue={toLocalInput(correctionClockOut!, timezone)} name="correctedClockOutLocal" required type="datetime-local" /></label>
                    </div>
                    <label><span>Verified break minutes</span><input defaultValue={correctionBreak} min="0" name="correctedBreakMinutes" placeholder="Enter verified minutes" required type="number" /></label>
                    {breakNeedsVerification ? (
                      <small>No break time was declared. Verify it before approving the correction.</small>
                    ) : <small>Review the proposed break time before approval.</small>}
                    <input name="reason" type="hidden" value="Approved employee attendance correction." />
                    <button className={styles.primaryButton} type="submit">Approve corrected time</button>
                  </form>
                ) : <div className={styles.alert}>A complete corrected time is required before approval.</div>}
                <StaffApprovalSheet title="Return attendance request" description="Explain what the employee needs to update." trigger="Return for update">
                  <form action={reviewMobileAttendanceCorrectionAction}>
                    <HiddenCaseFields item={item} />
                    <input name="action" type="hidden" value="RETURN_TO_EMPLOYEE" />
                    <label><span>Reason</span><textarea maxLength={500} minLength={3} name="reason" placeholder="Explain what is missing" required rows={4} /></label>
                    <button className={styles.secondaryButton} type="submit">Return to employee</button>
                  </form>
                </StaffApprovalSheet>
              </QueueItem>
            );
          })}
        </div>
      ) : <StaffV2EmptyState title="No approvals waiting" description="New Attendance requests in your authorized branches will appear here." />}
      {queue.totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Attendance correction pages">
          {queue.currentPage > 1 ? <Link href={`?page=${queue.currentPage - 1}`}>Previous</Link> : <span />}
          <small>Page {queue.currentPage} of {queue.totalPages}</small>
          {queue.currentPage < queue.totalPages ? <Link href={`?page=${queue.currentPage + 1}`}>Next</Link> : <span />}
        </nav>
      ) : null}
    </section>
  );
}

function QueueItem({ employee, branch, meta, children }: { employee: string; branch: string; meta: string; children: React.ReactNode }) {
  return (
    <article className={styles.queueItem} role="listitem">
      <div className={styles.queueSummary}>
        <span className={styles.domainMark}>AT</span>
        <span className={styles.queueCopy}><small>Attendance · {branch}</small><strong>{employee}</strong><span>{meta}</span></span>
        <span aria-hidden="true">›</span>
      </div>
      <details className={styles.queueDisclosure}>
        <summary>Review details and decide <span aria-hidden="true">⌄</span></summary>
        <div className={styles.queueDisclosureBody}>{children}</div>
      </details>
    </article>
  );
}

function RequestCopy({ reason, requested }: { reason: string; requested?: string }) {
  return <div className={styles.requestCopy}><small>Employee request</small><p>{reason}</p>{requested ? <span>Requested time: {requested}</span> : null}</div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function P2HiddenFields({ item }: { item: { id: string; exceptionRevision: number } }) { return <><input name="correctionRequestId" type="hidden" value={item.id} /><input name="expectedRevision" type="hidden" value={item.exceptionRevision} /></>; }
function HiddenCaseFields({ item }: { item: { id: string; updatedAt: Date; currentFinalResultId: string | null } }) { return <><input name="resolutionCaseId" type="hidden" value={item.id} /><input name="expectedUpdatedAt" type="hidden" value={item.updatedAt.toISOString()} /><input name="expectedCurrentResultId" type="hidden" value={item.currentFinalResultId ?? ""} /></>; }
function toLocalInput(value: Date, timezone: string) { return formatBranchLocalDateTime(value, timezone).slice(0, 16); }
function formatLocal(value: Date, timezone: string) { return value.toLocaleString("en-MY", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }); }
function formatWorkDate(value: Date) { return value.toLocaleDateString("en-MY", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }); }
function formatReason(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
