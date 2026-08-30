import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffOvertimeQueue } from "@/lib/staff-pwa/overtime-approvals";

export const metadata: Metadata = { title: "Overtime review" };
export const dynamic = "force-dynamic";

export default async function StaffOvertimeQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const month = typeof query.month === "string" ? query.month : undefined;
  const queue = await getStaffOvertimeQueue({ auth, month });
  if (!queue) redirect("/staff/requests");
  const message = typeof query.message === "string" ? query.message : null;
  const messageType = query.type === "error" ? "error" : "success";
  const previousMonth = shiftMonth(queue.month, -1);
  const nextMonth = shiftMonth(queue.month, 1);

  return (
    <section className="staff-overtime-page" aria-labelledby="overtime-queue-heading">
      <Link className="staff-approval-back" href="/staff/requests">← Requests</Link>
      <header className="staff-overtime-header">
        <div>
          <p className="staff-kicker">MANAGER REVIEW</p>
          <h1 id="overtime-queue-heading">Overtime</h1>
          <p>Review potential overtime derived from final Attendance results.</p>
        </div>
        <span>{queue.pending} waiting</span>
      </header>
      {message ? <div className={`staff-alert ${messageType}`} role="status">{message}</div> : null}
      <nav className="staff-overtime-month-nav" aria-label="Overtime month">
        <Link href={`/staff/requests/overtime?month=${previousMonth}`} aria-label="Previous month">‹</Link>
        <strong>{monthLabel(queue.month)}</strong>
        <Link href={`/staff/requests/overtime?month=${nextMonth}`} aria-label="Next month">›</Link>
      </nav>
      <p className="staff-overtime-boundary">
        Potential overtime is calculated by Attendance. Only approved minutes flow into a locked Timesheet and Payroll.
      </p>
      <div className="staff-overtime-list">
        {queue.items.length ? queue.items.map((item) => (
          <Link className="staff-overtime-row" href={`/staff/requests/overtime/${item.finalResultId}`} key={item.finalResultId}>
            <span className="staff-overtime-avatar" aria-hidden="true">OT</span>
            <span className="staff-overtime-copy">
              <small>{item.branchName} · {displayDate(item.workDate)}</small>
              <strong>{item.employeeName}</strong>
              <span>{scheduleSummary(item.expectedStartAt, item.expectedEndAt)} · {attendanceSummary(item.actualClockInAt, item.actualClockOutAt)}</span>
              <b>{durationLabel(item.potentialOtMinutes)} potential · {humanize(item.context)}</b>
            </span>
            <span className={`staff-overtime-status ${item.effectiveStatus.toLowerCase()}`}>
              {item.stale ? "Needs review" : humanize(item.effectiveStatus)}
            </span>
          </Link>
        )) : (
          <div className="staff-page-card staff-overtime-empty" role="status">
            <strong>No overtime to review</strong>
            <span>Potential overtime will appear after Attendance produces a final result in your authorized branch scope.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function shiftMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(month: string) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)); }
function displayDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function displayTime(value: Date | null) { return value ? new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(value) : "—"; }
function scheduleSummary(start: Date | null, end: Date | null) { return start && end ? `Scheduled ${displayTime(start)}–${displayTime(end)}` : "No scheduled shift"; }
function attendanceSummary(start: Date | null, end: Date | null) { return start || end ? `Actual ${displayTime(start)}–${displayTime(end)}` : "No completed attendance"; }
function durationLabel(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
