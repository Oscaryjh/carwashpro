import type { Metadata } from "next";
import { StaffP2CorrectionForm } from "@/components/staff-pwa/staff-p2-correction-form";
import type { EmployeeTimesheetDay } from "@/lib/attendance/employee-timesheet";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My timesheet" };
export const dynamic = "force-dynamic";

export default async function StaffTimesheetPage() {
  const auth = await requireEmployeeModulePage("HR");
  const { monthStart, days, overtime, lockedOvertime, timesheetStatus } = await getEmployeeTimesheetOverview(auth);
  const attentionDays = days.filter((day) => day.status !== "FINAL");
  const finalDays = days.filter((day) => day.status === "FINAL");
  const actionCount = attentionDays.filter((day) => day.status === "ACTION_NEEDED").length;
  const waitingCount = attentionDays.length - actionCount;
  const monthState = actionCount
    ? "Action needed"
    : waitingCount
      ? "Waiting for manager"
      : timesheetStatus === "LOCKED"
        ? "Final"
        : "Up to date";

  return (
    <section className="staff-page-card staff-timesheet-page" aria-labelledby="staff-timesheet-heading">
      <header className="staff-page-title staff-timesheet-heading">
        <div>
          <p>MY TIMESHEET</p>
          <h1 id="staff-timesheet-heading">{formatMonth(monthStart)}</h1>
          <span>Check each workday and see what, if anything, happens next.</span>
        </div>
        <b className={`staff-timesheet-state ${stateClass(monthState)}`}>{monthState}</b>
      </header>

      {attentionDays.length ? (
        <section className="staff-history-list" aria-labelledby="staff-timesheet-attention-heading">
          <div className="staff-section-heading">
            <p className="staff-kicker">NEEDS ATTENTION</p>
            <h2 id="staff-timesheet-attention-heading">{actionCount ? "Check these days" : "Waiting for your manager"}</h2>
          </div>
          {attentionDays.map((day) => (
            <article className="staff-history-card staff-timesheet-day" key={day.key}>
              <header className="staff-history-card-header">
                <div><strong>{formatWorkDate(day.workDate)}</strong><small>{issueSummary(day)}</small></div>
                <b className={`staff-timesheet-state ${day.status === "ACTION_NEEDED" ? "action" : "waiting"}`}>
                  {day.status === "ACTION_NEEDED" ? "Action needed" : "Waiting for manager"}
                </b>
              </header>
              {day.actualClockInAt || day.actualClockOutAt ? (
                <div className="staff-history-times">
                  <span><small>Clock in</small><strong>{time(day.actualClockInAt)}</strong></span>
                  <span><small>Clock out</small><strong>{time(day.actualClockOutAt)}</strong></span>
                </div>
              ) : null}
              <div className="staff-timesheet-explanation">
                <span><small>RESULT</small><strong>{day.status === "ACTION_NEEDED" ? "Attendance needs a correction" : "Schedule review required"}</strong></span>
                <span><small>WHY</small><strong>{issueReason(day)}</strong></span>
                <span><small>NEXT ACTION</small><strong>{nextAction(day)}</strong></span>
              </div>
              {day.actionableException ? (
                <StaffP2CorrectionForm
                  exceptionId={day.actionableException.id}
                  type={day.actionableException.type}
                  workDate={day.workDate.toISOString().slice(0, 10)}
                />
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      {overtime.length || lockedOvertime.length ? (
        <section className="staff-history-list" aria-labelledby="staff-timesheet-overtime-heading">
          <div className="staff-section-heading">
            <p className="staff-kicker">OVERTIME</p>
            <h2 id="staff-timesheet-overtime-heading">Manager-reviewed overtime</h2>
            <span>Overtime comes from your attendance record. There is no separate employee submission.</span>
          </div>
          {(timesheetStatus === "LOCKED" ? lockedOvertime : overtime).map((item) => {
            const locked = "otApprovalStatus" in item;
            const review = locked ? null : item.review;
            const status = locked ? item.otApprovalStatus : item.effectiveStatus;
            const approvedMinutes = locked ? item.approvedOtMinutes : review?.approvedOtMinutes ?? 0;
            const waiting = status === "PENDING_REVIEW";
            return (
              <article className="staff-history-card staff-timesheet-day" key={locked ? item.id : item.finalResultId}>
                <header className="staff-history-card-header">
                  <div><strong>{formatWorkDate(item.workDate)}</strong><small>Overtime</small></div>
                  <b className={`staff-timesheet-state ${waiting ? "waiting" : "final"}`}>{waiting ? "Waiting for manager" : "Final"}</b>
                </header>
                <div className="staff-history-times">
                  <span><small>Recorded time</small><strong>{minutes(item.potentialOtMinutes)}</strong></span>
                  <span><small>Approved time</small><strong>{minutes(approvedMinutes)}</strong></span>
                </div>
                <div className="staff-timesheet-explanation">
                  <span><small>NEXT ACTION</small><strong>{waiting ? "No action — your manager is reviewing it" : "No action needed"}</strong></span>
                </div>
                {!locked && review?.reason ? <small>Manager note: {review.reason}</small> : null}
              </article>
            );
          })}
        </section>
      ) : null}

      <section className="staff-history-list" aria-labelledby="staff-timesheet-days-heading">
        <div className="staff-section-heading">
          <p className="staff-kicker">WORKDAYS</p>
          <h2 id="staff-timesheet-days-heading">Daily results</h2>
        </div>
        {finalDays.map((day) => (
          <article className="staff-history-card staff-timesheet-day" key={day.key}>
            <header className="staff-history-card-header">
              <div><strong>{formatWorkDate(day.workDate)}</strong><small>{formatLabel(day.outcome ?? "PRESENT")}</small></div>
              <b className="staff-timesheet-state final">Final</b>
            </header>
            <div className="staff-history-times">
              <span><small>Clock in</small><strong>{time(day.actualClockInAt)}</strong></span>
              <span><small>Clock out</small><strong>{time(day.actualClockOutAt)}</strong></span>
            </div>
            <div className="staff-timesheet-explanation">
              <span><small>RESULT</small><strong>{formatLabel(day.outcome ?? "PRESENT")}</strong></span>
              <span><small>NEXT ACTION</small><strong>No action needed</strong></span>
            </div>
          </article>
        ))}
        {!days.length ? (
          <div className="staff-empty-state" role="status">
            <strong>No workdays yet</strong>
            <span>Your attendance results for {formatMonth(monthStart)} will appear here.</span>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function formatLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}
function formatWorkDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}
function time(value: Date | null) {
  return value ? value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—";
}
function minutes(value: number) {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}
function stateClass(value: string) {
  return value === "Action needed" ? "action" : value === "Waiting for manager" ? "waiting" : value === "Final" ? "final" : "current";
}
function issueSummary(day: EmployeeTimesheetDay) {
  const types = new Set(day.issues.map((issue) => issue.type));
  if (types.has("MISSING_CLOCK_IN") && types.has("MISSING_CLOCK_OUT")) return "Missing clock in and clock out";
  if (types.has("MISSING_CLOCK_IN")) return "Missing clock in";
  if (types.has("MISSING_CLOCK_OUT")) return "Missing clock out";
  if (types.has("LATE_ARRIVAL") && types.has("EARLY_DEPARTURE")) return "Schedule difference";
  if (types.has("LATE_ARRIVAL")) return "Late arrival review";
  if (types.has("EARLY_DEPARTURE")) return "Early departure review";
  return "Attendance review";
}
function issueReason(day: EmployeeTimesheetDay) {
  const reasons = day.issues.map((issue) => {
    const duration = issue.exceptionMinutes > 0 ? ` by ${minutes(issue.exceptionMinutes)}` : "";
    if (issue.type === "MISSING_CLOCK_IN") return "A clock-in time is missing";
    if (issue.type === "MISSING_CLOCK_OUT") return "A clock-out time is missing";
    if (issue.type === "LATE_ARRIVAL") return `Clock in was after the published start${duration}`;
    if (issue.type === "EARLY_DEPARTURE") return `Clock out was before the published end${duration}`;
    if (issue.type === "NO_ATTENDANCE_RECORDED") return "No attendance was recorded for the published workday";
    if (issue.type === "SUSPECTED_NO_SHOW") return "The published workday has no completed attendance";
    if (issue.type === "LEAVE_ATTENDANCE_CONFLICT") return "Attendance and approved leave overlap";
    return "The recorded times need review";
  });
  return reasons.join("; ");
}
function nextAction(day: EmployeeTimesheetDay) {
  if (day.actionableException?.type === "MISSING_CLOCK_IN") return "Add the missing clock-in time";
  if (day.actionableException?.type === "MISSING_CLOCK_OUT") return "Add the missing clock-out time";
  return "No action — your manager needs to review this day";
}
