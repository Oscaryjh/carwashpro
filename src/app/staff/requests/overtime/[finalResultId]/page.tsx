import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffOvertimeDetail } from "@/lib/staff-pwa/overtime-approvals";
import { decideMobileOvertimeAction } from "../actions";

export const metadata: Metadata = { title: "Review overtime" };
export const dynamic = "force-dynamic";

export default async function StaffOvertimeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ finalResultId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ finalResultId }, query] = await Promise.all([params, searchParams]);
  const auth = await requireEmployeeSelfServiceAuthContext();
  const detail = await getStaffOvertimeDetail(auth, finalResultId);
  if (!detail) notFound();
  const item = detail.item;
  const message = typeof query.message === "string" ? query.message : null;
  const messageType = query.type === "error" ? "error" : "success";
  const readOnly = detail.locked || item.blockedReason !== null;

  return (
    <section className="staff-overtime-page staff-overtime-detail">
      <Link className="staff-approval-back" href={`/staff/requests/overtime?month=${detail.month}`}>← Overtime</Link>
      <header className="staff-overtime-header">
        <div>
          <p className="staff-kicker">{item.branchName} · {displayDate(item.workDate)}</p>
          <h1>Review overtime</h1>
          <p>{item.employeeName} · {item.employeeCode}</p>
        </div>
        <span>{item.stale ? "Needs review" : humanize(item.effectiveStatus)}</span>
      </header>
      {message ? <div className={`staff-alert ${messageType}`} role="status">{message}</div> : null}
      {detail.locked ? <div className="staff-alert warning">This monthly Timesheet is locked. Reopen it on Desktop before changing overtime.</div> : null}
      {item.blockedReason ? <div className="staff-alert warning">Resolve the full-day Leave and Attendance conflict before reviewing overtime.</div> : null}
      <dl className="staff-overtime-facts">
        <Fact label="Expected day" value={humanize(item.expectedDayKindSnapshot ?? "Not scheduled")} />
        <Fact label="Attendance result" value={humanize(item.outcome)} />
        <Fact label="Scheduled shift" value={rangeLabel(item.expectedStartAt, item.expectedEndAt)} />
        <Fact label="Actual attendance" value={rangeLabel(item.actualClockInAt, item.actualClockOutAt)} />
        <Fact label="Worked time" value={durationLabel(item.totalWorkedMinutes)} />
        <Fact label="Break time" value={durationLabel(item.totalBreakMinutes)} />
        <Fact label="OT context" value={humanize(item.context)} />
        <Fact label="Potential overtime" value={durationLabel(item.potentialOtMinutes)} />
        <Fact label="Approved overtime" value={durationLabel(item.review?.approvedOtMinutes ?? 0)} />
        <Fact label="Review revision" value={String(item.review?.revision ?? 0)} />
        <Fact label="Timesheet" value={`${humanize(detail.timesheetStatus)} · revision ${detail.timesheetRevision}`} />
        <Fact label="Reason" value={item.review?.reason || "No decision note"} />
      </dl>
      <p className="staff-overtime-boundary">
        This review does not change clock records or generate overtime. It records the Manager decision against the latest final Attendance result.
      </p>
      {readOnly ? null : (
        <section className="staff-overtime-actions" aria-label="Overtime decisions">
          <form action={decideMobileOvertimeAction}>
            <DecisionFields item={item} month={detail.month} />
            <button className="staff-overtime-primary" name="decision" value="APPROVE">Approve {durationLabel(item.potentialOtMinutes)}</button>
          </form>
          <details>
            <summary>Adjust approved minutes</summary>
            <form action={decideMobileOvertimeAction}>
              <DecisionFields item={item} month={detail.month} />
              <label><span>Approved minutes</span><input inputMode="numeric" max={item.potentialOtMinutes} min="0" name="approvedMinutes" required type="number" /></label>
              <label><span>Reason for adjustment</span><textarea maxLength={500} minLength={3} name="reason" required /></label>
              <button className="staff-overtime-secondary" name="decision" value="ADJUST">Save adjustment</button>
            </form>
          </details>
          <details>
            <summary>Reject potential overtime</summary>
            <form action={decideMobileOvertimeAction}>
              <DecisionFields item={item} month={detail.month} />
              <label><span>Reason for rejection</span><textarea maxLength={500} minLength={3} name="reason" required /></label>
              <button className="staff-overtime-danger" name="decision" value="REJECT">Reject overtime</button>
            </form>
          </details>
        </section>
      )}
    </section>
  );
}

function DecisionFields({ item, month }: { item: { finalResultId: string; review: { revision: number } | null }; month: string }) {
  return <><input name="finalResultId" type="hidden" value={item.finalResultId} /><input name="expectedRevision" type="hidden" value={item.review?.revision ?? 0} /><input name="month" type="hidden" value={month} /></>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function displayDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function displayTime(value: Date | null) { return value ? new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(value) : "—"; }
function rangeLabel(start: Date | null, end: Date | null) { return start || end ? `${displayTime(start)}–${displayTime(end)}` : "Not recorded"; }
function durationLabel(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours}h${rest ? ` ${rest}m` : ""}` : `${rest}m`; }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
