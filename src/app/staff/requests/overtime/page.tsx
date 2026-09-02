import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import {
  StaffV2EmptyState,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2PeriodNavigator,
  StaffV2RowGroup,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getStaffOvertimeQueue } from "@/lib/staff-pwa/overtime-approvals";

export const metadata: Metadata = { title: "Overtime review" };
export const dynamic = "force-dynamic";

export default async function StaffOvertimeQueuePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const auth = await requireEmployeeSelfServiceAuthContext();
  const month = typeof query.month === "string" ? query.month : undefined;
  const queue = await getStaffOvertimeQueue({ auth, month });
  if (!queue) redirect("/staff/requests");
  const message = typeof query.message === "string" ? query.message : null;
  const previousMonth = shiftMonth(queue.month, -1);
  const nextMonth = shiftMonth(queue.month, 1);

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`}>
      <Link className={styles.backLink} href="/staff/approvals">← Approvals</Link>
      <StaffV2PageHeader title="Overtime" meta="Review potential overtime that needs your decision." />
      {message ? <div className={`${styles.alert} ${query.type === "error" ? styles.alertDanger : styles.alertSuccess}`} role="status">{message}</div> : null}
      <StaffV2PeriodNavigator
        ariaLabel="Overtime month"
        label={monthLabel(queue.month)}
        previousHref={`/staff/requests/overtime?month=${previousMonth}`}
        previousLabel="Previous month"
        nextHref={`/staff/requests/overtime?month=${nextMonth}`}
        nextLabel="Next month"
      />
      <p className={styles.scopeCopy}>{queue.pending} waiting · Only approved time can flow into a locked Timesheet and Payroll.</p>
      {queue.items.length ? (
        <StaffV2RowGroup ariaLabel="Pending overtime approvals">
          {queue.items.map((item) => (
            <StaffV2ListRow
              ariaLabel={`Review ${durationLabel(item.potentialOtMinutes)} overtime for ${item.employeeName}`}
              href={`/staff/requests/overtime/${item.finalResultId}`}
              key={item.finalResultId}
              kicker={`OT · ${item.branchName} · ${displayDate(item.workDate)}`}
              leading={<span className={styles.domainMark}>OT</span>}
              meta={`${durationLabel(item.potentialOtMinutes)} · ${scheduleSummary(item.expectedStartAt, item.expectedEndAt)} · ${attendanceSummary(item.actualClockInAt, item.actualClockOutAt)}`}
              title={item.employeeName}
            />
          ))}
        </StaffV2RowGroup>
      ) : (
        <StaffV2EmptyState title="No overtime to review" description="Potential overtime will appear after Attendance produces a final result in your authorized branch scope." />
      )}
    </section>
  );
}

function shiftMonth(month: string, amount: number) { const [year, monthNumber] = month.split("-").map(Number); const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthLabel(month: string) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`)); }
function displayDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value); }
function displayTime(value: Date | null) { return value ? new Intl.DateTimeFormat("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" }).format(value) : "—"; }
function scheduleSummary(start: Date | null, end: Date | null) { return start && end ? `Scheduled ${displayTime(start)}–${displayTime(end)}` : "No scheduled shift"; }
function attendanceSummary(start: Date | null, end: Date | null) { return start || end ? `Recorded ${displayTime(start)}–${displayTime(end)}` : "No completed attendance"; }
function durationLabel(minutes: number) { const hours = Math.floor(minutes / 60); const rest = minutes % 60; if (!hours) return `${rest} min`; return `${hours} hr${hours === 1 ? "" : "s"}${rest ? ` ${rest} min` : ""}`; }
