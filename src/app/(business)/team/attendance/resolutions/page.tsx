import Link from "next/link";
import { decideAttendanceResolutionAction } from "./actions";
import { loadAttendanceResolutionQueue } from "@/lib/attendance/resolution-read-service";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { formatBranchLocalDateTime } from "@/lib/attendance/work-date";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getOperationalBranches } from "@/lib/branches";
import styles from "./resolution.module.css";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    branchId?: string;
    employee?: string;
    page?: string;
    type?: string;
    message?: string;
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
          <h1>Attendance Resolution Queue</h1>
          <p>Review employee responses and create the final attendance result.</p>
        </div>
        <Link className="secondary-light-button" href="/team/attendance">
          Back to attendance
        </Link>
      </header>

      {params.message ? (
        <div className={`${styles.notice} ${params.type === "error" ? styles.error : styles.success}`} role="status">
          {params.message}
        </div>
      ) : null}

      <form action="/team/attendance/resolutions" className={styles.filters}>
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
          <span>Branch</span>
          <select defaultValue={branchId ?? ""} name="branchId">
            <option value="">All authorized branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
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
        <span>{result.pagination.total} cases</span>
      </div>

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
              <article className={styles.caseCard} key={item.id}>
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
      ) : (
        <div className={styles.empty}>
          <strong>No resolution cases found</strong>
          <span>Try another status, branch, or employee filter.</span>
        </div>
      )}

      <nav aria-label="Resolution queue pages" className={styles.pagination}>
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
