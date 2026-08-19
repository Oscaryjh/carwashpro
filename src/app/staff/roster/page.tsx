import type { Metadata } from "next";
import Link from "next/link";
import { resolveBranchHolidays } from "@/lib/holidays/service";
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
  const activeBranchId = auth.attendanceBranchId ?? auth.primaryBranchId;
  const [schedule, leaveDays, holidays] = await Promise.all([
    getEmployeePublishedRoster({ businessId: auth.businessId, membershipId: auth.membershipId, branchId: activeBranchId, from: weekStart, to: weekEnd }),
    prisma.leaveRequestDay.findMany({ where: { businessId: auth.businessId, membershipId: auth.membershipId, leaveDate: { gte: weekStart, lte: weekEnd }, leaveRequest: { branchId: activeBranchId, status: "APPROVED" } }, include: { leaveRequest: { select: { policyNameSnapshot: true } } } }),
    resolveBranchHolidays({ businessId: auth.businessId, branchId: activeBranchId, from: weekStart, to: weekEnd }),
  ]);
  const byDate = new Map(schedule.map((item) => [dateValue(item.workDate), item]));
  const leaveByDate = new Map(leaveDays.map((item) => [dateValue(item.leaveDate), item]));
  const holidayByDate = new Map(holidays.map((item) => [dateValue(item.workDate), item]));
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const todayAssignment = byDate.get(dateValue(today));
  const todayLeave = leaveByDate.get(dateValue(today));
  const todayHoliday = holidayByDate.get(dateValue(today));

  return (
    <section className="staff-roster-page" aria-labelledby="staff-roster-heading">
      <header className="staff-page-title">
        <p>My roster</p>
        <h1 id="staff-roster-heading">My schedule</h1>
        <span>See when you work, rest, or have approved leave.</span>
      </header>
      <section className="staff-page-card staff-roster-today">
        <small>Today</small>
        {todayLeave ? <Leave label={todayLeave.leaveRequest.policyNameSnapshot} /> : todayAssignment ? <Assignment assignment={todayAssignment} holiday={todayHoliday?.name} prominent /> : <div title="No effective schedule available · Unspecified · not an Off Day">{todayHoliday ? <span className="staff-roster-holiday">Public holiday · {todayHoliday.name}</span> : null}<strong>No work shift scheduled</strong><span>This is not automatically an Off Day.</span></div>}
      </section>
      <nav className="staff-roster-nav" aria-label="Schedule week">
        <Link href={`/staff/roster?week=${dateValue(addDays(weekStart, -7))}`}>Previous</Link>
        <span>{weekLabel(weekStart, weekEnd)}</span>
        <Link href={`/staff/roster?week=${dateValue(addDays(weekStart, 7))}`}>Next</Link>
      </nav>
      <div className="staff-roster-list">
        {days.map((day) => {
          const assignment = byDate.get(dateValue(day));
          const leave = leaveByDate.get(dateValue(day));
          const holiday = holidayByDate.get(dateValue(day));
          return <article className="staff-page-card staff-roster-day" key={dateValue(day)}><div className="staff-roster-date"><strong>{day.toLocaleDateString("en-MY", { weekday: "long", timeZone: "UTC" })}</strong><small>{day.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</small></div>{leave ? <Leave label={leave.leaveRequest.policyNameSnapshot} /> : assignment ? <Assignment assignment={assignment} holiday={holiday?.name} /> : <div className="staff-roster-empty" title="No effective schedule available · Unspecified · not an Off Day">{holiday ? <span className="staff-roster-holiday">Public holiday · {holiday.name}</span> : null}<strong>No work shift scheduled</strong><small>Not automatically an Off Day</small></div>}</article>;
        })}
      </div>
      <p className="staff-roster-note">This is your planned schedule. Use Attendance to record the hours you actually work.</p>
    </section>
  );
}

type AssignmentRow = Awaited<ReturnType<typeof getEmployeePublishedRoster>>[number];
function Assignment({ assignment, holiday, prominent = false }: { assignment: AssignmentRow; holiday?: string; prominent?: boolean }) {
  const label = assignment.kind === "WORK_SHIFT" ? assignment.shiftNameSnapshot ?? "Custom Shift" : assignment.kind === "REST_DAY" ? "Rest Day" : "Not Scheduled";
  const overnight = assignment.startAt && assignment.endAt
    ? localDayKey(assignment.startAt, assignment.timezoneSnapshot) !== localDayKey(assignment.endAt, assignment.timezoneSnapshot)
    : false;
  return <div className={prominent ? "staff-roster-assignment prominent" : "staff-roster-assignment"}>{holiday ? <span className="staff-roster-holiday">PH · {holiday}</span> : null}<strong>{label}</strong>{assignment.startAt && assignment.endAt ? <span>{time(assignment.startAt, assignment.timezoneSnapshot)} – {time(assignment.endAt, assignment.timezoneSnapshot)}</span> : null}{overnight && assignment.startAt && assignment.endAt ? <span>Overnight shift · {shortDate(assignment.startAt, assignment.timezoneSnapshot)}–{shortDate(assignment.endAt, assignment.timezoneSnapshot)}</span> : null}<small>{assignment.branch.name}{assignment.breakMinutes ? ` · ${humanDuration(assignment.breakMinutes)} ${assignment.breakPaidSnapshot ? "paid" : "unpaid"} break` : ""}</small></div>;
}
function Leave({ label }: { label: string }) { return <div className="staff-roster-assignment staff-roster-leave"><span>Approved Leave</span><strong>{label}</strong><small>Your manager approved this leave.</small></div>; }
function localDate(now: Date, timezone: string) { const value = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); return new Date(`${value}T00:00:00.000Z`); }
function parseDate(value?: string) { return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null; }
function time(value: Date, timezone: string) { return value.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }); }
function localDayKey(value: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: timezone }).format(value); }
function shortDate(value: Date, timezone: string) { return value.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: timezone }); }
function humanDuration(minutes: number) { return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`; }
function weekLabel(from: Date, to: Date) { const sameMonth = from.getUTCMonth() === to.getUTCMonth(); return sameMonth ? `${from.getUTCDate()}–${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : `${from.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" })} – ${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`; }
