import type { Metadata } from "next";
import { StaffP2CorrectionForm } from "@/components/staff-pwa/staff-p2-correction-form";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";

export const metadata: Metadata = { title: "My timesheet" };
export const dynamic = "force-dynamic";

export default async function StaffTimesheetPage() {
  const auth = await requireEmployeeModulePage("HR");
  const { latest, exceptions, overtime, lockedOvertime, timesheetStatus } = await getEmployeeTimesheetOverview(auth);
  return (
    <section className="staff-page-card" aria-labelledby="staff-timesheet-heading">
      <div className="staff-page-title">
        <p>Attendance results</p>
        <h1 id="staff-timesheet-heading">My timesheet</h1>
        <p>Raw punches, pending corrections and resolved day outcomes stay separate.</p>
      </div>
      {overtime.length || lockedOvertime.length ? (
        <div className="staff-history-list" aria-label="Overtime classification">
          <div className="staff-page-title">
            <p>Overtime classification</p>
            <h2>My overtime</h2>
            <p>Attendance reviews the minutes. Payroll can use only approved minutes from a locked monthly timesheet.</p>
          </div>
          {(timesheetStatus === "LOCKED" ? lockedOvertime : overtime).map((item) => {
            const locked = "otApprovalStatus" in item;
            const review = locked ? null : item.review;
            const status = locked ? item.otApprovalStatus : item.effectiveStatus;
            const potentialMinutes = item.potentialOtMinutes;
            const approvedMinutes = locked ? item.approvedOtMinutes : review?.approvedOtMinutes ?? 0;
            const context = locked ? item.otContext : item.context;
            return (
              <article className="staff-history-card" key={locked ? item.id : item.finalResultId}>
                <div className="staff-history-card-header">
                  <div>
                    <strong>{format(status)}</strong>
                    <small>{item.workDate.toISOString().slice(0, 10)} · {format(context ?? "NORMAL")}</small>
                  </div>
                </div>
                <div className="staff-history-times">
                  <span><small>Potential OT</small><strong>{minutes(potentialMinutes)}</strong></span>
                  <span><small>Approved OT</small><strong>{minutes(approvedMinutes)}</strong></span>
                </div>
                <p>{locked
                  ? "Final payroll classification frozen in the locked timesheet."
                  : status === "PENDING_REVIEW"
                    ? "Waiting for an authorised manager to review."
                    : "Decision recorded. It becomes final for payroll only after the monthly timesheet is locked."}</p>
                {!locked && review?.reason ? <small>Reason: {review.reason}</small> : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {exceptions.length ? (
        <div className="staff-history-list">
          {exceptions.map((issue) => (
            <article className="staff-history-card" key={issue.id}>
              <div className="staff-history-card-header"><div><strong>{format(issue.type)}</strong><small>{issue.workDate.toISOString().slice(0, 10)} · {format(issue.status)}</small></div></div>
              <p>This issue must be resolved before monthly Timesheet approval.</p>
              {(issue.type === "MISSING_CLOCK_IN" || issue.type === "MISSING_CLOCK_OUT") && issue.status !== "PENDING_MANAGER" ? (
                <StaffP2CorrectionForm exceptionId={issue.id} type={issue.type} workDate={issue.workDate.toISOString().slice(0, 10)} />
              ) : issue.status === "PENDING_MANAGER" ? <small>Waiting for manager review.</small> : null}
            </article>
          ))}
        </div>
      ) : null}
      <div className="staff-history-list">
        {latest.map((row) => (
          <article className="staff-history-card" key={row.id}>
            <div className="staff-history-card-header"><div><strong>{format(row.outcome)}</strong><small>{row.workDate.toISOString().slice(0, 10)} · Version {row.version}</small></div></div>
            <div className="staff-history-times"><span><small>Clock in</small><strong>{time(row.actualClockInAt)}</strong></span><span><small>Clock out</small><strong>{time(row.actualClockOutAt)}</strong></span></div>
          </article>
        ))}
        {!latest.length && !exceptions.length ? <p>No Attendance day results are available for this month.</p> : null}
      </div>
    </section>
  );
}

function format(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function time(value: Date | null) { return value ? value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—"; }
function minutes(value: number) { return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`; }
