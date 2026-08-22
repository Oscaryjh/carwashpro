import type { Metadata } from "next";
import Link from "next/link";
import { StaffP2CorrectionForm } from "@/components/staff-pwa/staff-p2-correction-form";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import {
  buildStaffTimesheetDayView,
  formatStaffTimesheetDuration,
  formatStaffTimesheetTime,
  staffTimesheetAttention,
  summarizeStaffTimesheet,
  type StaffTimesheetDay,
} from "@/lib/staff-pwa/timesheet";

type Props = { searchParams: Promise<{ month?: string }> };

export const metadata: Metadata = { title: "Timesheet" };
export const dynamic = "force-dynamic";

export default async function StaffTimesheetPage({ searchParams }: Props) {
  const [auth, params] = await Promise.all([
    requireEmployeeModulePage("HR"),
    searchParams,
  ]);
  const overview = await getEmployeeTimesheetOverview(auth, { month: params.month });
  const summary = summarizeStaffTimesheet(overview.latest);
  const status = overview.timesheetStatus === "LOCKED"
    ? { label: "LOCKED", message: "Your monthly work record has been finalized.", tone: "locked" }
    : overview.exceptions.length
      ? { label: "REVIEW REQUIRED", message: "Some attendance items still need attention.", tone: "review" }
      : { label: "IN PROGRESS", message: "Records may change while attendance is being reviewed.", tone: "open" };
  const previousMonth = addMonth(overview.monthStart, -1);
  const nextMonth = addMonth(overview.monthStart, 1);

  return (
    <section className="staff-timesheet-page" aria-labelledby="staff-timesheet-heading">
      <header className="staff-page-title staff-section-hero">
        <p>Timesheet</p>
        <h1 id="staff-timesheet-heading">Monthly work record</h1>
        <span>Review your confirmed work results before payroll.</span>
      </header>

      <section className="staff-timesheet-overview" aria-labelledby="staff-timesheet-month">
        <header className="staff-timesheet-month-nav">
          <Link aria-label={`View ${monthLabel(previousMonth)}`} href={`/staff/timesheet?month=${monthKey(previousMonth)}`}>
            <span aria-hidden="true">‹</span><small>{shortMonth(previousMonth)}</small>
          </Link>
          <h2 id="staff-timesheet-month">{monthLabel(overview.monthStart)}</h2>
          <Link aria-label={`View ${monthLabel(nextMonth)}`} href={`/staff/timesheet?month=${monthKey(nextMonth)}`}>
            <small>{shortMonth(nextMonth)}</small><span aria-hidden="true">›</span>
          </Link>
        </header>

        <div className={`staff-timesheet-status status-${status.tone}`}>
          <div><small>Status</small><strong>{status.label}</strong></div>
          <p>{status.message}</p>
        </div>

        <div className="staff-timesheet-summary" aria-label="Monthly work summary">
          <SummaryMetric label="Workdays" value={String(summary.workedDays)} />
          <SummaryMetric label="Regular hours" value={formatStaffTimesheetDuration(summary.regularMinutes)} />
          <SummaryMetric label="Approved OT" value={formatStaffTimesheetDuration(summary.approvedOtMinutes)} />
          <SummaryMetric label="Leave" value={formatDayCount(summary.leaveDays)} />
          <SummaryMetric attention={overview.exceptions.length > 0} label="Issues" value={String(overview.exceptions.length)} />
        </div>

        {summary.restDayWorked || summary.publicHolidayWorked ? (
          <div className="staff-timesheet-context-summary">
            {summary.restDayWorked ? <span><b>{summary.restDayWorked}</b> Rest day worked</span> : null}
            {summary.publicHolidayWorked ? <span><b>{summary.publicHolidayWorked}</b> Public holiday worked</span> : null}
          </div>
        ) : null}

        {!overview.exceptions.length ? <p className="staff-timesheet-clear">✓ No items need attention</p> : null}
      </section>

      {overview.exceptions.length ? (
        <section className="staff-timesheet-attention" aria-labelledby="staff-timesheet-attention-heading">
          <header>
            <div><small>Needs attention</small><h2 id="staff-timesheet-attention-heading">Review these items</h2></div>
            <strong>{overview.exceptions.length}</strong>
          </header>
          <div>
            {overview.exceptions.map((issue) => {
              const copy = staffTimesheetAttention(issue.type);
              return (
                <details className="staff-timesheet-issue" key={issue.id}>
                  <summary>
                    <span>{compactDate(issue.workDate)}</span>
                    <span><strong>{copy.label}</strong><small>Review required</small></span>
                    <b aria-hidden="true">⌄</b>
                  </summary>
                  <div>
                    <p>{copy.description}</p>
                    {(issue.type === "MISSING_CLOCK_IN" || issue.type === "MISSING_CLOCK_OUT") && issue.status !== "PENDING_MANAGER" ? (
                      <StaffP2CorrectionForm
                        exceptionId={issue.id}
                        type={issue.type}
                        workDate={issue.workDate.toISOString().slice(0, 10)}
                      />
                    ) : <small>{issue.status === "PENDING_MANAGER" ? "Waiting for manager review." : "Your manager will review this attendance item."}</small>}
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="staff-timesheet-records" aria-labelledby="staff-timesheet-records-heading">
        <header>
          <div><small>Daily records</small><h2 id="staff-timesheet-records-heading">Confirmed days</h2></div>
          <span>{overview.latest.length}</span>
        </header>
        {overview.latest.length ? (
          <div className="staff-timesheet-list">
            {overview.latest.map((day) => <TimesheetDay day={day} key={day.id} />)}
          </div>
        ) : (
          <div className="staff-timesheet-empty">
            <strong>{overview.isFutureMonth ? "No records for this month yet" : "No work records yet"}</strong>
            <p>{overview.isFutureMonth
              ? "Confirmed work results will appear here when this month begins."
              : "Your confirmed attendance results will appear here once they are available."}</p>
          </div>
        )}
      </section>
      <p className="staff-timesheet-note">Timesheet shows confirmed work results. Payroll uses only the locked monthly record and its own payroll rules.</p>
    </section>
  );
}

function SummaryMetric({
  attention = false,
  label,
  value,
}: {
  attention?: boolean;
  label: string;
  value: string;
}) {
  return <div className={attention ? "attention" : ""}><strong>{value}</strong><small>{label}</small></div>;
}

function TimesheetDay({ day }: { day: StaffTimesheetDay }) {
  const view = buildStaffTimesheetDayView(day);
  const regularMinutes = Math.max(0, day.totalWorkedMinutes - day.approvedOtMinutes);
  return (
    <details className={`staff-timesheet-day tone-${view.tone}`}>
      <summary>
        <span className="staff-timesheet-date"><strong>{day.workDate.getUTCDate()}</strong><small>{weekday(day.workDate)}</small></span>
        <span className="staff-timesheet-result">
          <strong>{view.label}</strong>
          {view.supportingLabel ? <small>{view.supportingLabel}</small> : null}
          {view.approvedOtLabel ? <em>{view.approvedOtLabel}</em> : null}
        </span>
        <span className="staff-timesheet-time">{view.timeLabel ?? "—"}</span>
        <b className="staff-timesheet-disclosure" aria-hidden="true">⌄</b>
      </summary>
      <div className="staff-timesheet-day-detail">
        <h3>{fullDate(day.workDate)}</h3>
        <dl>
          <Detail label="Final result" value={view.label} />
          <Detail label="Scheduled" value={timeRange(day.expectedStartAt, day.expectedEndAt, day.timezone)} />
          <Detail label="Clock in" value={formatStaffTimesheetTime(day.actualClockInAt, day.timezone)} />
          <Detail label="Clock out" value={formatStaffTimesheetTime(day.actualClockOutAt, day.timezone)} />
          <Detail label="Regular hours" value={formatStaffTimesheetDuration(regularMinutes)} />
          <Detail label="Approved OT" value={formatStaffTimesheetDuration(day.approvedOtMinutes)} />
          <Detail label="Break" value={day.totalBreakMinutes ? formatStaffTimesheetDuration(day.totalBreakMinutes) : "—"} />
          <Detail label="Record version" value={String(day.version)} />
        </dl>
      </div>
    </details>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function timeRange(start: Date | null, end: Date | null, timezone: string) {
  return start || end
    ? `${formatStaffTimesheetTime(start, timezone)} – ${formatStaffTimesheetTime(end, timezone)}`
    : "—";
}

function addMonth(value: Date, offset: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
}

function monthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: Date) {
  return value.toLocaleDateString("en-MY", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shortMonth(value: Date) {
  return value.toLocaleDateString("en-MY", { month: "short", timeZone: "UTC" });
}

function compactDate(value: Date) {
  return value.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fullDate(value: Date) {
  return value.toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function weekday(value: Date) {
  return value.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" }).toUpperCase();
}

function formatDayCount(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
