import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { loadMonthlyAttendanceTimesheet } from "@/lib/attendance/timesheet-service";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import styles from "./time.module.css";

export default async function TimeOverviewPage() {
  const { access, businessId } = await requireBusinessUser();
  const canViewAttendance = hasBusinessCapability(access, "VIEW_ATTENDANCE_EMPLOYEES");
  const canViewRoster = hasBusinessCapability(access, "VIEW_ROSTER");
  const canViewSettings = hasBusinessCapability(access, "VIEW_ATTENDANCE_SETTINGS");
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const timesheet = canViewAttendance
    ? await resolveAttendanceScope(access).then((scope) => loadMonthlyAttendanceTimesheet({
        businessId,
        allowedBranchIds: scope.allowedBranchIds,
        month,
      }))
    : null;
  const isLocked = timesheet?.timesheet?.status === "LOCKED";
  const isApproved = timesheet?.timesheet?.status === "APPROVED";

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.header}>
        <p>TIME</p>
        <h1>Time</h1>
        <span>Attendance, schedules, timesheets and holidays in one workspace.</span>
      </header>
      {timesheet ? (
        <section className={styles.progressPanel} aria-label="Current month time progress">
          <div className={styles.progressHeader}>
            <div>
              <p>MONTHLY PROGRESS</p>
              <h2>{formatMonth(month)}</h2>
              <span>Follow the same attendance record through review, approval and the payroll handoff.</span>
            </div>
            <Link href={`/team/attendance/timesheets?month=${month}`}>Open monthly timesheet →</Link>
          </div>
          <div className={styles.progressGrid}>
            <ProgressStep
              href="/team/attendance"
              index="1"
              title="Attendance captured"
              value={`${timesheet.totals.sessions} records`}
              note="Clock activity and attendance records for this month."
              state={timesheet.totals.sessions > 0 ? "done" : "neutral"}
            />
            <ProgressStep
              href="/team/attendance/resolutions"
              index="2"
              title="Exceptions to resolve"
              value={`${timesheet.totals.blockers} open`}
              note={timesheet.totals.blockers > 0 ? "Fix these before the month can be approved." : "No blocking attendance issues."}
              state={timesheet.totals.blockers > 0 ? "attention" : "done"}
            />
            <ProgressStep
              href={`/team/attendance/timesheets?month=${month}`}
              index="3"
              title="Stores confirmed"
              value={`${timesheet.totals.readyBranches}/${timesheet.totals.totalBranches}`}
              note={timesheet.allBranchesReady ? "All stores are ready for approval." : "Store review is still in progress."}
              state={timesheet.allBranchesReady ? "done" : "neutral"}
            />
            <ProgressStep
              href={`/team/attendance/timesheets?month=${month}`}
              index="4"
              title="Payroll handoff"
              value={isLocked ? "Locked" : isApproved ? "Approved" : "Not ready"}
              note={isLocked ? "Attendance and approved OT are frozen for payroll." : "Lock the approved timesheet before payroll uses it."}
              state={isLocked ? "done" : isApproved ? "neutral" : "attention"}
            />
          </div>
        </section>
      ) : null}
      <section className={styles.grid} aria-label="Time workspace destinations">
        {canViewAttendance ? <Destination href="/team/attendance" title="Attendance" copy="Review clock activity, exceptions and daily records." /> : null}
        {canViewRoster ? <Destination href="/team/roster" title="Roster" copy="Plan and publish employee schedules." /> : null}
        {canViewAttendance ? <Destination href="/team/attendance/timesheets" title="Timesheets" copy="Review monthly hours and controlled revisions." /> : null}
        {canViewRoster ? <Destination href="/team/holidays" title="Holidays" copy="Maintain the public-holiday calendar used by scheduling." /> : null}
        {canViewSettings ? <Destination href="/team/attendance-settings" title="Settings" copy="Manage attendance rules and workplace controls." /> : null}
      </section>
    </main>
  );
}

function ProgressStep({ href, index, title, value, note, state }: {
  href: string;
  index: string;
  title: string;
  value: string;
  note: string;
  state: "done" | "attention" | "neutral";
}) {
  return (
    <Link className={styles.progressStep} data-state={state} href={href}>
      <span>{index}</span>
      <div><small>{title}</small><strong>{value}</strong><em>{note}</em></div>
    </Link>
  );
}

function formatMonth(month: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" })
    .format(new Date(`${month}-01T00:00:00+08:00`));
}

function Destination({ href, title, copy }: { href: string; title: string; copy: string }) {
  return <Link className={styles.card} href={href}><strong>{title}</strong><span>{copy}</span><em>Open →</em></Link>;
}
