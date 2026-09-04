import Link from "next/link";
import type { EmployeeTimesheetDay } from "@/lib/attendance/employee-timesheet";
import {
  staffTimesheetDuration,
  staffTimesheetNextAction,
  staffTimesheetOvertimeLine,
  staffTimesheetStatusLabel,
  staffTimesheetSummaryItems,
  type StaffTimesheetV2Row,
  type StaffTimesheetV2Summary,
} from "@/lib/staff-pwa/timesheet-v2";
import {
  StaffV2CompactSummary,
  StaffV2DetailSection,
  StaffV2EmptyState,
  StaffV2PageHeader,
  StaffV2PeriodNavigator,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles,
} from "./staff-v2-primitives";
import styles from "./staff-timesheet-v2.module.css";

export function StaffTimesheetV2({
  monthStart,
  nextHref,
  previousHref,
  rows,
  summary,
  timesheetStatus,
}: {
  monthStart: Date;
  nextHref: string;
  previousHref: string;
  rows: readonly StaffTimesheetV2Row[];
  summary: StaffTimesheetV2Summary;
  timesheetStatus: string;
}) {
  const monthLabel = formatMonth(monthStart);
  return (
    <section
      aria-label="Timesheet and overtime"
      className={`${staffV2Styles.scope} ${styles.page}`}
    >
      <StaffV2PageHeader
        title="Timesheet & overtime"
        meta="Monthly work results used for review and payroll."
      />

      <StaffV2PeriodNavigator
        ariaLabel="Timesheet month"
        label={monthLabel}
        nextHref={nextHref}
        nextLabel={`View ${formatMonth(monthStart, 1)}`}
        previousHref={previousHref}
        previousLabel={`View ${formatMonth(monthStart, -1)}`}
      />

      <StaffV2CompactSummary items={staffTimesheetSummaryItems(summary)} />

      <section aria-labelledby="timesheet-workdays-heading" className={styles.results}>
        <StaffV2SectionLabel id="timesheet-workdays-heading">Workdays</StaffV2SectionLabel>
        {rows.length ? (
          <StaffV2RowGroup ariaLabel={`${monthLabel} work results`} className={styles.group}>
            {rows.map((row) => (
              <TimesheetRow
                key={row.key}
                locked={timesheetStatus === "LOCKED"}
                row={row}
              />
            ))}
          </StaffV2RowGroup>
        ) : (
          <StaffV2EmptyState
            title={`No workdays yet for ${monthLabel}.`}
            description="Your processed attendance results will appear here."
          />
        )}
      </section>
    </section>
  );
}

function TimesheetRow({
  locked,
  row,
}: {
  locked: boolean;
  row: StaffTimesheetV2Row;
}) {
  const statusLabel = staffTimesheetStatusLabel(row.status);
  const result = rowResult(row);
  const range = row.day ? attendanceRange(row.day) : null;
  const overtimeLine = staffTimesheetOvertimeLine(row.overtime);
  const nextActionCopy = staffTimesheetNextAction(row);
  const meta = [result, range].filter(Boolean).join(" · ");
  const tone = row.status === "ACTION_NEEDED"
    ? "danger"
    : row.status === "WAITING_FOR_MANAGER"
      ? "warning"
      : "success";

  return (
    <article className={styles.row} role="listitem">
      <details>
        <summary
          aria-label={`${formatFullDate(row.workDate)}. ${statusLabel}. ${meta || "Overtime result"}${overtimeLine ? `. ${overtimeLine}` : ""}. Open workday details.`}
        >
          <time dateTime={row.workDate.toISOString().slice(0, 10)}>
            <strong>{formatDay(row.workDate)}</strong>
            <span>{formatWeekday(row.workDate)}</span>
          </time>
          <span className={styles.rowCopy}>
            <StaffV2StatusBadge tone={tone}>{statusLabel}</StaffV2StatusBadge>
            {meta ? <span>{meta}</span> : null}
            {overtimeLine ? <small>{overtimeLine}</small> : null}
          </span>
          <span aria-hidden="true" className={styles.chevron}>›</span>
        </summary>

        <div className={styles.detail}>
          <header>
            <strong>{formatFullDate(row.workDate)}</strong>
            {row.status !== "FINAL" ? (
              <StaffV2StatusBadge tone={tone}>{statusLabel}</StaffV2StatusBadge>
            ) : null}
          </header>

          {row.day && hasAttendanceFacts(row.day) ? (
            <StaffV2DetailSection title="Attendance">
              <dl className={styles.facts}>
                {row.day.actualClockInAt ? <Fact label="Clock in" value={formatTime(row.day.actualClockInAt)} /> : null}
                {row.day.actualClockOutAt ? <Fact label="Clock out" value={formatTime(row.day.actualClockOutAt)} /> : null}
                {row.day.totalBreakMinutes > 0 ? <Fact label="Break" value={staffTimesheetDuration(row.day.totalBreakMinutes)} /> : null}
                {row.day.totalWorkedMinutes > 0 ? <Fact label="Worked" value={staffTimesheetDuration(row.day.totalWorkedMinutes)} /> : null}
              </dl>
            </StaffV2DetailSection>
          ) : null}

          <StaffV2DetailSection title="Result">
            <dl className={styles.facts}>
              <Fact label="Outcome" value={result || "Overtime result"} />
            </dl>
          </StaffV2DetailSection>

          {locked ? (
            <StaffV2DetailSection title="Payroll">
              <p className={styles.payrollMessage}>This record will be used for payroll.</p>
            </StaffV2DetailSection>
          ) : null}

          {row.day?.issues.length ? (
            <StaffV2DetailSection title="Why">
              <ul className={styles.reasons}>
                {row.day.issues.map((issue) => <li key={issue.id}>{issueReason(issue)}</li>)}
              </ul>
            </StaffV2DetailSection>
          ) : null}

          {row.overtime && row.overtime.status !== "NOT_APPLICABLE" ? (
            <StaffV2DetailSection title="Overtime">
              <dl className={styles.facts}>
                <Fact label="Potential" value={staffTimesheetDuration(row.overtime.potentialMinutes)} />
                {row.overtime.status === "APPROVED" || row.overtime.status === "ADJUSTED" ? (
                  <Fact label="Approved" value={staffTimesheetDuration(row.overtime.approvedMinutes)} />
                ) : null}
                <Fact label="Status" value={overtimeStatus(row.overtime.status)} />
                {row.overtime.managerReason ? <Fact label="Manager reason" value={row.overtime.managerReason} /> : null}
              </dl>
            </StaffV2DetailSection>
          ) : null}

          {nextActionCopy ? (
            <StaffV2DetailSection title="Next action">
              <p className={styles.nextAction}>{nextActionCopy}</p>
            </StaffV2DetailSection>
          ) : null}
        </div>
      </details>

      {row.status === "ACTION_NEEDED" &&
      (row.day?.actionableException || row.day?.resolutionCase) ? (
        <div className={styles.action}>
          <span>
            <strong>{issueSummary(row.day)}</strong>
            <small>Add the correct time for manager review.</small>
          </span>
          <Link href={row.day.resolutionCase
            ? "/staff#attendance-issues"
            : "/staff/history/records#attendance-correction"}
          >Fix attendance</Link>
        </div>
      ) : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function rowResult(row: StaffTimesheetV2Row) {
  if (row.day?.issues.length) return issueSummary(row.day);
  if (row.day?.outcome) return outcomeLabel(row.day.outcome);
  if (row.overtime) return "Overtime";
  return "";
}

function issueSummary(day: EmployeeTimesheetDay) {
  const types = new Set(day.issues.map((issue) => issue.type));
  if (types.has("MISSING_CLOCK_IN") && types.has("MISSING_CLOCK_OUT")) return "Missing clock in and clock out";
  if (types.has("MISSING_CLOCK_IN")) return "Missing clock in";
  if (types.has("MISSING_CLOCK_OUT")) return "Missing clock out";
  if (types.has("LATE_ARRIVAL") && types.has("EARLY_DEPARTURE")) return "Schedule difference";
  if (types.has("LATE_ARRIVAL")) return "Late arrival review";
  if (types.has("EARLY_DEPARTURE")) return "Early departure review";
  if (types.has("NO_ATTENDANCE_RECORDED")) return "No attendance recorded";
  if (types.has("SUSPECTED_NO_SHOW")) return "Attendance review";
  if (types.has("LEAVE_ATTENDANCE_CONFLICT")) return "Leave and attendance review";
  return "Attendance review";
}

function issueReason(issue: EmployeeTimesheetDay["issues"][number]) {
  const duration = issue.exceptionMinutes > 0 ? ` by ${staffTimesheetDuration(issue.exceptionMinutes)}` : "";
  if (issue.type === "MISSING_CLOCK_IN") return "A clock-in time is missing.";
  if (issue.type === "MISSING_CLOCK_OUT") return "A clock-out time is missing.";
  if (issue.type === "LATE_ARRIVAL") return `Clocked in after the scheduled start${duration}.`;
  if (issue.type === "EARLY_DEPARTURE") return `Clocked out before the scheduled end${duration}.`;
  if (issue.type === "NO_ATTENDANCE_RECORDED") return "No attendance was recorded for the scheduled workday.";
  if (issue.type === "SUSPECTED_NO_SHOW") return "The scheduled workday has no completed attendance.";
  if (issue.type === "LEAVE_ATTENDANCE_CONFLICT") return "Attendance and approved leave overlap.";
  return "The recorded attendance needs review.";
}

function overtimeStatus(status: string) {
  if (status === "PENDING_REVIEW") return "Waiting for manager";
  if (status === "APPROVED") return "Approved overtime";
  if (status === "ADJUSTED") return "Adjusted overtime";
  if (status === "REJECTED") return "Overtime not approved";
  return "Final";
}

function outcomeLabel(value: string) {
  const labels: Record<string, string> = {
    PRESENT: "Present",
    PRESENT_LATE_AUTHORIZED: "Present · Late arrival approved",
    PRESENT_LATE_UNAUTHORIZED: "Present · Late arrival recorded",
    PRESENT_EARLY_AUTHORIZED: "Present · Early departure approved",
    PRESENT_EARLY_UNAUTHORIZED: "Present · Early departure recorded",
    AUTHORIZED_ABSENCE: "Authorized absence",
    UNAUTHORIZED_ABSENCE: "Unauthorized absence",
    APPROVED_PAID_LEAVE: "Approved paid leave",
    APPROVED_UNPAID_LEAVE: "Approved unpaid leave",
    AUTHORIZED_EMERGENCY_LEAVE: "Authorized emergency leave",
    NOT_SCHEDULED: "Not scheduled",
    REST_DAY: "Rest day",
    PUBLIC_HOLIDAY: "Public holiday",
    EXCLUDED: "Excluded from attendance",
  };
  return labels[value] ?? "Final attendance result";
}

function hasAttendanceFacts(day: EmployeeTimesheetDay) {
  return Boolean(
    day.actualClockInAt
      || day.actualClockOutAt
      || day.totalBreakMinutes
      || day.totalWorkedMinutes,
  );
}

function attendanceRange(day: EmployeeTimesheetDay) {
  if (day.actualClockInAt && day.actualClockOutAt) {
    return `${formatTime(day.actualClockInAt)} – ${formatTime(day.actualClockOutAt)}`;
  }
  if (day.actualClockInAt) return `Clocked in ${formatTime(day.actualClockInAt)}`;
  if (day.actualClockOutAt) return `Clocked out ${formatTime(day.actualClockOutAt)}`;
  return null;
}

function formatMonth(value: Date, offset = 0) {
  const shifted = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(shifted);
}

function formatDay(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", timeZone: "UTC" }).format(value);
}

function formatWeekday(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { weekday: "short", timeZone: "UTC" }).format(value);
}

function formatFullDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
