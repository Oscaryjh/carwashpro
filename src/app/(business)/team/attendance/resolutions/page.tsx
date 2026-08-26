import Link from "next/link";
import { reviewAttendanceExceptionAction } from "../actions";
import { decideAttendanceP2ResolutionAction, decideAttendanceResolutionAction } from "./actions";
import { loadAttendanceResolutionQueue } from "@/lib/attendance/resolution-read-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { formatBranchLocalDateTime } from "@/lib/attendance/work-date";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import styles from "./resolution.module.css";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    branchId?: string;
    employee?: string;
    page?: string;
    type?: string;
    message?: string;
    focus?: string;
  }>;
};

const supportedStatuses = new Set([
  "ACTION_REQUIRED",
  "OPEN",
  "UNDER_REVIEW",
  "RETURNED_FOR_CORRECTION",
  "RESOLVED",
]);

export default async function AttendanceResolutionQueuePage({ searchParams }: PageProps) {
  const { access, user, businessId } = await requireBusinessUser(
    "VIEW_ATTENDANCE_EMPLOYEES",
  );
  const params = await searchParams;
  const scope = await resolveAttendanceScope(access);
  const canModify = hasBusinessCapability(access, "MODIFY_ATTENDANCE_EMPLOYEES");
  const canViewPeople = hasBusinessCapability(access, "VIEW_TEAM_DIRECTORY");
  const branches = (await getOperationalBranches(businessId, user)).filter((branch) =>
    scope.allowedBranchIds.includes(branch.id),
  );
  const status = supportedStatuses.has(params.status ?? "")
    ? params.status as
        | "ACTION_REQUIRED"
        | "OPEN"
        | "UNDER_REVIEW"
        | "RETURNED_FOR_CORRECTION"
        | "RESOLVED"
    : "ACTION_REQUIRED";
  const branchId = branches.some((branch) => branch.id === params.branchId)
    ? params.branchId
    : undefined;
  const result = await loadAttendanceResolutionQueue({
    scope,
    page: Number.parseInt(params.page ?? "1", 10) || 1,
    status,
    branchId,
    employeeQuery: params.employee,
  });
  const p2Issues = await prisma.attendanceP2Exception.findMany({
    where: {
      businessId,
      branchId: { in: branchId ? [branchId] : [...scope.allowedBranchIds] },
      status: status === "RESOLVED" ? "RESOLVED" : { in: ["OPEN", "PENDING_EMPLOYEE", "PENDING_MANAGER"] },
    },
    orderBy: [{ workDate: "asc" }, { detectedAt: "asc" }],
    take: 100,
  });
  const pendingExceptions = status === "ACTION_REQUIRED"
    ? await prisma.attendanceException.findMany({
        where: {
          businessId,
          branchId: { in: branchId ? [branchId] : [...scope.allowedBranchIds] },
          status: "PENDING",
          ...(params.employee
            ? {
                employee: {
                  OR: [
                    { fullName: { contains: params.employee, mode: "insensitive" } },
                    { employeeCode: { contains: params.employee, mode: "insensitive" } },
                  ],
                },
              }
            : {}),
        },
        include: {
          employee: { select: { id: true, fullName: true, employeeCode: true } },
          branch: {
            select: {
              name: true,
              attendanceSetting: { select: { timezone: true } },
            },
          },
          attendanceSession: {
            select: {
              id: true,
              status: true,
              resolutionCase: { select: { id: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      }).then((items) => items.filter((item) => !item.attendanceSession?.resolutionCase))
    : [];
  const [p2Members, p2Corrections] = await Promise.all([
    prisma.employeeBusinessMembership.findMany({
      where: { businessId, id: { in: p2Issues.map((item) => item.membershipId) } },
      select: { id: true, fullName: true, employeeCode: true },
    }),
    prisma.attendanceCorrectionRequest.findMany({
      where: { businessId, exceptionId: { in: p2Issues.map((item) => item.id) }, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const p2MemberById = new Map(p2Members.map((item) => [item.id, item]));
  const p2CorrectionByIssue = new Map(p2Corrections.map((item) => [item.exceptionId, item]));

  function pageHref(page: number) {
    const query = new URLSearchParams();
    if (status !== "ACTION_REQUIRED") query.set("status", status);
    if (branchId) query.set("branchId", branchId);
    if (params.employee) query.set("employee", params.employee);
    if (page > 1) query.set("page", String(page));
    const value = query.toString();
    return `/team/attendance/resolutions${value ? `?${value}` : ""}`;
  }

  return (
    <section className={`content hr-module-page ${styles.page}`}>
      <header className={`page-header hr-module-header ${styles.header}`}>
        <div>
          <span className="hr-module-eyebrow">HR &amp; PAYROLL</span>
          <h1>Attendance Issues</h1>
          <p>Review attendance exceptions, employee responses and required corrections.</p>
        </div>
      </header>

      {params.message ? (
        <div className={`${styles.notice} ${params.type === "error" ? styles.error : styles.success}`} role="status">
          {params.message}
        </div>
      ) : null}

      <form action="/team/attendance/resolutions" className={styles.filters}>
        {branchId ? <input name="branchId" type="hidden" value={branchId} /> : null}
        <label>
          <span>Status</span>
          <select defaultValue={status} name="status">
            <option value="ACTION_REQUIRED">Action required</option>
            <option value="OPEN">Awaiting employee</option>
            <option value="UNDER_REVIEW">Ready for review</option>
            <option value="RETURNED_FOR_CORRECTION">Returned</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <label>
          <span>Employee</span>
          <input defaultValue={params.employee ?? ""} name="employee" placeholder="Name or employee code" />
        </label>
        <button type="submit">Apply filters</button>
      </form>

      <div className={styles.queueHeading}>
        <div>
          <h2>{status === "ACTION_REQUIRED" ? "Cases requiring attention" : formatStatus(status)}</h2>
          <p>Final Results are immutable; corrections create a new version.</p>
        </div>
        <span>{result.pagination.total + p2Issues.length + pendingExceptions.length} cases</span>
      </div>

      {pendingExceptions.length ? (
        <div className={styles.caseList}>
          {pendingExceptions.map((exception) => {
            const timezone = exception.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
            return (
              <article className={styles.caseCard} id={`attendance-exception-${exception.id}`} key={exception.id}>
                <div className={styles.caseHeader}>
                  <div>
                    {canViewPeople ? (
                      <Link href={`/team/people/${exception.employee.id}`}>
                        {exception.employee.fullName}
                      </Link>
                    ) : (
                      <strong>{exception.employee.fullName}</strong>
                    )}
                    <small>{exception.employee.employeeCode} · {exception.branch.name}</small>
                  </div>
                  <div className={styles.badges}>
                    <span className={`${styles.payrollState} ${styles.blocked}`}>Attendance incomplete</span>
                    <span className={styles.status}>Pending review</span>
                  </div>
                </div>

                <div className={styles.facts}>
                  <Fact label="Issue" value={formatStatus(exception.type)} />
                  <Fact label="Requested clock-in" value={exception.requestedClockInAt ? formatLocal(exception.requestedClockInAt, timezone) : "Not provided"} />
                  <Fact label="Requested clock-out" value={exception.requestedClockOutAt ? formatLocal(exception.requestedClockOutAt, timezone) : "Not provided"} />
                  <Fact label="Submitted" value={formatLocal(exception.createdAt, timezone)} />
                  <Fact label="Shift" value={exception.attendanceSession ? formatStatus(exception.attendanceSession.status) : "Will be created"} />
                </div>

                <div className={styles.submission}>
                  <span>Employee correction request</span>
                  <p>{exception.reason}</p>
                  <small>{exception.attendanceSession ? "Approving completes the existing Attendance session through the controlled workflow." : "Approving creates the missing Attendance session through the controlled workflow."}</small>
                </div>

                {canModify ? (
                  <div className={styles.actions}>
                    <form action={reviewAttendanceExceptionAction} className={styles.decisionForm}>
                      <input name="exceptionId" type="hidden" value={exception.id} />
                      <label>
                        <span>Review note (optional)</span>
                        <textarea maxLength={500} name="reviewNote" rows={2} />
                      </label>
                      <div className={styles.actionButtons}>
                        <button name="decision" type="submit" value="APPROVED">Approve correction</button>
                        <button className={styles.danger} name="decision" type="submit" value="REJECTED">Reject request</button>
                      </div>
                    </form>
                  </div>
                ) : (
                  <div className={styles.readOnly}>Read-only access</div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      {p2Issues.length ? (
        <div className={styles.caseList}>
          {p2Issues.map((issue) => {
            const member = p2MemberById.get(issue.membershipId);
            const correction = p2CorrectionByIssue.get(issue.id);
            const resolutionOptions = p2ResolutionOptions(issue.type);
            return (
              <article className={styles.caseCard} id={`attendance-p2-${issue.id}`} key={issue.id}>
                <div className={styles.caseHeader}>
                  <div><strong>{member?.fullName ?? "Scoped employee"}</strong><small>{member?.employeeCode ?? ""} · {issue.workDate.toISOString().slice(0, 10)}</small></div>
                  <div className={styles.badges}><span className={`${styles.payrollState} ${styles.blocked}`}>Timesheet blocked</span><span className={styles.status}>{formatStatus(issue.type)}</span></div>
                </div>
                <div className={styles.facts}>
                  <Fact label="Expected" value={`${issue.expectedStartAt?.toISOString() ?? "No schedule evidence"} → ${issue.expectedEndAt?.toISOString() ?? "—"}`} />
                  <Fact label="Recorded" value={`${issue.actualClockInAt?.toISOString() ?? "No clock-in"} → ${issue.actualClockOutAt?.toISOString() ?? "No clock-out"}`} />
                  <Fact label="Variance" value={`${issue.exceptionMinutes} min`} />
                  <Fact label="Evidence" value={issue.reasonCode} />
                </div>
                {correction ? <div className={styles.submission}><span>Employee correction request</span><p>{correction.reason}</p><small>Proposed: {correction.requestedClockInAt?.toISOString() ?? "—"} → {correction.requestedClockOutAt?.toISOString() ?? "—"}</small></div> : null}
                {canModify && issue.status !== "RESOLVED" ? (
                  <form action={decideAttendanceP2ResolutionAction} className={styles.decisionForm}>
                    <input name="exceptionId" type="hidden" value={issue.id} />
                    <input name="expectedRevision" type="hidden" value={issue.revision} />
                    <label><span>Resolution</span><select name="resolutionType" required>{resolutionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    <label><span>Corrected clock-in (optional)</span><input name="correctedClockInAt" type="datetime-local" /></label>
                    <label><span>Corrected clock-out (optional)</span><input name="correctedClockOutAt" type="datetime-local" /></label>
                    <label><span>Corrected break minutes</span><input min={0} name="correctedBreakMinutes" type="number" /></label>
                    <label><span>Decision reason</span><textarea maxLength={500} minLength={3} name="reason" required rows={2} /></label>
                    <button type="submit">Resolve exception</button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {result.items.length ? (
        <div className={styles.caseList}>
          {result.items.map((item) => {
            const timezone = item.branch.attendanceSetting?.timezone ?? "Asia/Kuala_Lumpur";
            const latestEmployeeSubmission = item.events.find(
              (event) => event.type === "EMPLOYEE_SUBMITTED",
            );
            const canDecide = canModify && item.status === "UNDER_REVIEW";
            const canRevise =
              canModify && item.status === "RESOLVED" && Boolean(item.currentFinalResult);
            const correctionBaseline =
              item.currentFinalResult ?? item.attendanceSession;
            return (
              <article className={styles.caseCard} id={`attendance-case-${item.id}`} key={item.id}>
                <div className={styles.caseHeader}>
                  <div>
                    {canViewPeople ? (
                      <Link href={`/team/people/${item.employee.id}`}>
                        {item.employee.fullName}
                      </Link>
                    ) : (
                      <strong>{item.employee.fullName}</strong>
                    )}
                    <small>{item.employee.employeeCode} · {item.branch.name}</small>
                  </div>
                  <div className={styles.badges}>
                    <span className={`${styles.payrollState} ${item.status === "RESOLVED" ? styles.complete : styles.blocked}`}>
                      {item.status === "RESOLVED" ? "Resolution complete" : "Payroll blocked"}
                    </span>
                    <span className={`${styles.status} ${styles[item.status.toLowerCase()]}`}>
                      {formatStatus(item.status)}
                    </span>
                  </div>
                </div>

                <div className={styles.facts}>
                  <Fact label="Issue" value={formatStatus(item.openedReason)} />
                  <Fact label="Work date" value={item.attendanceSession.workDate.toISOString().slice(0, 10)} />
                  <Fact label="Recorded in" value={formatLocal(item.attendanceSession.clockInAt, timezone)} />
                  <Fact label="Recorded out" value={item.attendanceSession.clockOutAt ? formatLocal(item.attendanceSession.clockOutAt, timezone) : "Not recorded"} />
                  <Fact label="Break" value={`${item.attendanceSession.totalBreakMinutes} min`} />
                  <Fact label="Operational state" value={`${formatStatus(item.attendanceSession.status)} · ${formatStatus(item.attendanceSession.approvalStatus)}`} />
                </div>

                {latestEmployeeSubmission ? (
                  <div className={styles.submission}>
                    <span>Employee response</span>
                    <p>{latestEmployeeSubmission.reason}</p>
                    {latestEmployeeSubmission.proposedClockInAt ? (
                      <small>
                        Proposed: {formatLocal(latestEmployeeSubmission.proposedClockInAt, timezone)} → {latestEmployeeSubmission.proposedClockOutAt ? formatLocal(latestEmployeeSubmission.proposedClockOutAt, timezone) : "No clock-out"} · {latestEmployeeSubmission.proposedBreakMinutes ?? 0} min break
                      </small>
                    ) : null}
                  </div>
                ) : item.attendanceSession.exceptions[0] ? (
                  <div className={styles.submission}>
                    <span>Existing exception request</span>
                    <p>{item.attendanceSession.exceptions[0].reason}</p>
                    <small>{formatStatus(item.attendanceSession.exceptions[0].type)}</small>
                  </div>
                ) : (
                  <div className={styles.waiting}>Waiting for the employee to submit an explanation.</div>
                )}

                {item.events.length ? (
                  <details className={styles.history}>
                    <summary>Case history ({item.events.length})</summary>
                    <ol>
                      {[...item.events].reverse().map((event) => (
                        <li key={event.id}>
                          <strong>{formatStatus(event.type)}</strong>
                          <span>{event.reason}</span>
                          <small>{formatLocal(event.createdAt, timezone)}</small>
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}

                {canDecide || canRevise ? (
                  <div className={styles.actions}>
                    {canDecide ? (
                      <form action={decideAttendanceResolutionAction} className={styles.decisionForm}>
                        <CaseHiddenFields item={item} />
                        <label>
                          <span>Decision reason</span>
                          <textarea maxLength={500} minLength={3} name="reason" required rows={2} />
                        </label>
                        <div className={styles.actionButtons}>
                          <button name="action" type="submit" value="ACCEPT_AS_RECORDED">Accept as recorded</button>
                          <button className={styles.secondary} name="action" type="submit" value="RETURN_TO_EMPLOYEE">Return to employee</button>
                          <button className={styles.danger} name="action" type="submit" value="EXCLUDE">Exclude</button>
                        </div>
                      </form>
                    ) : (
                      <div className={styles.resolvedState}>
                        Final Attendance Result v{item.currentFinalResult?.version} is retained. A correction creates a new immutable version.
                      </div>
                    )}
                    <form action={decideAttendanceResolutionAction} className={styles.correctionForm}>
                      <CaseHiddenFields item={item} />
                      <h3>{canRevise ? "Create corrected result" : "Apply correction"}</h3>
                      <div className={styles.correctionFields}>
                        <label>
                          <span>Clock in ({timezone})</span>
                          <input defaultValue={correctionBaseline.clockInAt ? formatBranchLocalDateTime(correctionBaseline.clockInAt, timezone).slice(0, 16) : ""} name="correctedClockInLocal" required type="datetime-local" />
                        </label>
                        <label>
                          <span>Clock out</span>
                          <input defaultValue={correctionBaseline.clockOutAt ? formatBranchLocalDateTime(correctionBaseline.clockOutAt, timezone).slice(0, 16) : ""} name="correctedClockOutLocal" required type="datetime-local" />
                        </label>
                        <label>
                          <span>Break minutes</span>
                          <input defaultValue={correctionBaseline.totalBreakMinutes} min="0" name="correctedBreakMinutes" required type="number" />
                        </label>
                        <label className={styles.correctionReason}>
                          <span>Correction reason</span>
                          <input maxLength={500} minLength={3} name="reason" required />
                        </label>
                      </div>
                      <button name="action" type="submit" value="APPLY_CORRECTION">
                        {canRevise ? "Create correction version" : "Apply correction and resolve"}
                      </button>
                    </form>
                  </div>
                ) : item.status === "RESOLVED" ? (
                  <div className={styles.resolvedState}>Final Attendance Result created.</div>
                ) : item.status !== "UNDER_REVIEW" ? (
                  <div className={styles.readOnly}>Waiting for the employee response.</div>
                ) : (
                  <div className={styles.readOnly}>Read-only access</div>
                )}
              </article>
            );
          })}
        </div>
      ) : p2Issues.length || pendingExceptions.length ? null : (
        <div className={styles.empty}>
          <strong>No attendance issues found</strong>
          <span>Try another status or employee filter.</span>
        </div>
      )}

      <nav aria-label="Attendance issue pages" className={styles.pagination}>
        {result.pagination.page > 1 ? <Link href={pageHref(result.pagination.page - 1)}>Previous</Link> : <span>Previous</span>}
        <strong>Page {result.pagination.page} of {result.pagination.totalPages}</strong>
        {result.pagination.page < result.pagination.totalPages ? <Link href={pageHref(result.pagination.page + 1)}>Next</Link> : <span>Next</span>}
      </nav>
    </section>
  );
}

function CaseHiddenFields({ item }: { item: { id: string; updatedAt: Date; currentFinalResultId: string | null } }) {
  return (
    <>
      <input name="resolutionCaseId" type="hidden" value={item.id} />
      <input name="expectedUpdatedAt" type="hidden" value={item.updatedAt.toISOString()} />
      <input name="expectedCurrentResultId" type="hidden" value={item.currentFinalResultId ?? ""} />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><strong>{value}</strong></span>;
}

function formatLocal(value: Date, timezone: string) {
  return value.toLocaleString("en-MY", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

function formatStatus(value: string) {
  return value.toLocaleLowerCase().replaceAll("_", " ").replace(/^./, (character) => character.toLocaleUpperCase());
}

const p2OptionLabels = {
  AUTHORIZED: "Authorized",
  UNAUTHORIZED: "Unauthorized",
  CORRECTED: "Approve correction",
  SCHEDULE_ERROR: "Schedule error",
  NOT_SCHEDULED: "Not scheduled",
  APPROVED_LEAVE: "Use approved Leave record",
  EXCLUDED: "Exclude",
} as const;

function p2ResolutionOptions(exceptionType: string) {
  const allowed: Record<string, readonly (keyof typeof p2OptionLabels)[]> = {
    MISSING_CLOCK_IN: ["CORRECTED", "AUTHORIZED", "EXCLUDED"],
    MISSING_CLOCK_OUT: ["CORRECTED", "AUTHORIZED", "EXCLUDED"],
    LATE_ARRIVAL: ["AUTHORIZED", "UNAUTHORIZED", "CORRECTED", "SCHEDULE_ERROR", "EXCLUDED"],
    EARLY_DEPARTURE: ["AUTHORIZED", "UNAUTHORIZED", "CORRECTED", "SCHEDULE_ERROR", "EXCLUDED"],
    NO_ATTENDANCE_RECORDED: ["AUTHORIZED", "UNAUTHORIZED", "NOT_SCHEDULED", "SCHEDULE_ERROR", "APPROVED_LEAVE", "EXCLUDED"],
    SUSPECTED_NO_SHOW: ["AUTHORIZED", "UNAUTHORIZED", "NOT_SCHEDULED", "SCHEDULE_ERROR", "APPROVED_LEAVE", "EXCLUDED"],
    LEAVE_ATTENDANCE_CONFLICT: ["CORRECTED", "APPROVED_LEAVE", "EXCLUDED"],
  };
  return (allowed[exceptionType] ?? []).map((value) => ({ value, label: p2OptionLabels[value] }));
}
