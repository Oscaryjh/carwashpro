import type { Metadata } from "next";
import Link from "next/link";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { prisma } from "@/lib/prisma";
import { addDays, dateValue, startOfIsoWeek } from "@/lib/roster/domain";
import { getEmployeePublishedRoster } from "@/lib/roster/service";

type Props = { searchParams: Promise<{ week?: string }> };

export const metadata: Metadata = { title: "My schedule" };
export const dynamic = "force-dynamic";

export default async function StaffRosterPage({ searchParams }: Props) {
  const [auth, params] = await Promise.all([requireEmployeeModulePage("HR"), searchParams]);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: auth.businessId }, select: { timezone: true } });
  const today = localDate(new Date(), business.timezone);
  const selected = parseDate(params.week) ?? today;
  const weekStart = startOfIsoWeek(selected);
  const weekEnd = addDays(weekStart, 6);
  const schedule = await getEmployeePublishedRoster({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
    from: weekStart,
    to: weekEnd,
  });
  const byDate = new Map(schedule.map((item) => [dateValue(item.workDate), item]));
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const todayAssignment = byDate.get(dateValue(today));

  return (
    <section className="staff-roster-page" aria-labelledby="staff-roster-heading">
      <header className="staff-page-title">
        <p>Published roster</p>
        <h1 id="staff-roster-heading">My schedule</h1>
        <span>Only your latest published revision appears here. Draft changes remain private.</span>
      </header>
      <section className="staff-page-card staff-roster-today">
        <small>Today</small>
        {todayAssignment ? <Assignment assignment={todayAssignment} prominent /> : <div><strong>No published schedule available</strong><span>No roster record does not mean Off Day.</span></div>}
      </section>
      <nav className="staff-roster-nav" aria-label="Schedule week">
        <Link href={`/staff/roster?week=${dateValue(addDays(weekStart, -7))}`}>Previous</Link>
        <span>{dateValue(weekStart)} – {dateValue(weekEnd)}</span>
        <Link href={`/staff/roster?week=${dateValue(addDays(weekStart, 7))}`}>Next</Link>
      </nav>
      <div className="staff-roster-list">
        {days.map((day) => {
          const assignment = byDate.get(dateValue(day));
          return <article className="staff-page-card staff-roster-day" key={dateValue(day)}><div className="staff-roster-date"><strong>{day.toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" })}</strong><small>{day.toLocaleDateString("en-MY", { day: "2-digit", month: "short", timeZone: "UTC" })}</small></div>{assignment ? <Assignment assignment={assignment} /> : <div className="staff-roster-empty"><strong>No published schedule available</strong><small>Unspecified · not an Off Day</small></div>}</article>;
        })}
      </div>
      <p className="staff-roster-note">Scheduled hours are planning evidence only. Actual work comes from Attendance; payable outcomes come from locked Timesheet and Payroll.</p>
    </section>
  );
}

type AssignmentRow = Awaited<ReturnType<typeof getEmployeePublishedRoster>>[number];
function Assignment({ assignment, prominent = false }: { assignment: AssignmentRow; prominent?: boolean }) {
  const label = assignment.kind === "WORK_SHIFT" ? "Work shift" : assignment.kind === "REST_DAY" ? "Rest Day" : "Not Scheduled";
  return <div className={prominent ? "staff-roster-assignment prominent" : "staff-roster-assignment"}><strong>{label}</strong>{assignment.startAt && assignment.endAt ? <span>{time(assignment.startAt, assignment.timezoneSnapshot)} – {time(assignment.endAt, assignment.timezoneSnapshot)}</span> : null}<small>{assignment.branch.name}{assignment.breakMinutes ? ` · ${assignment.breakMinutes} min break` : ""}</small><em>Published revision {assignment.publication.revision}</em></div>;
}
function localDate(now: Date, timezone: string) { const value = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); return new Date(`${value}T00:00:00.000Z`); }
function parseDate(value?: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null; }
function time(value: Date, timezone: string) { return value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }); }
