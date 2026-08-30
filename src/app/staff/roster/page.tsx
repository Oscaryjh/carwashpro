import type { Metadata } from "next";
import Link from "next/link";
import { resolveBranchHolidays } from "@/lib/holidays/service";
import { requireEmployeeModulePage } from "@/lib/modules/employee-access";
import { prisma } from "@/lib/prisma";
import { addDays, dateValue, startOfIsoWeek } from "@/lib/roster/domain";
import { getEmployeePublishedRoster } from "@/lib/roster/service";
import {
  buildStaffScheduleDay,
  type StaffScheduleAssignment,
  type StaffScheduleHoliday,
  type StaffScheduleLeave,
} from "@/lib/staff-pwa/schedule";

type Props = { searchParams: Promise<{ week?: string }> };
type AssignmentRow = Awaited<ReturnType<typeof getEmployeePublishedRoster>>[number];

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function StaffRosterPage({ searchParams }: Props) {
  const [auth, params] = await Promise.all([
    requireEmployeeModulePage("HR"),
    searchParams,
  ]);
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: auth.businessId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), business.timezone);
  const selected = parseDate(params.week) ?? today;
  const weekStart = startOfIsoWeek(selected);
  const weekEnd = addDays(weekStart, 6);
  const todayInWeek = today >= weekStart && today <= weekEnd;
  const assignmentRangeStart = today < weekStart ? today : weekStart;
  const assignmentRangeEnd = today > weekEnd ? today : weekEnd;
  const activeBranchId = auth.attendanceBranchId ?? auth.primaryBranchId;
  const assignedBranches = await prisma.employeeBranchAssignment.findMany({
    where: {
      businessId: auth.businessId,
      membershipId: auth.membershipId,
      status: "ACTIVE",
      effectiveFrom: { lt: addDays(assignmentRangeEnd, 1) },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: assignmentRangeStart } }],
      branch: { status: "ACTIVE" },
    },
    select: { branch: { select: { id: true, name: true } } },
  });
  const branches = uniqueBranches([
    { id: activeBranchId, name: "" },
    ...assignedBranches.map((assignment) => assignment.branch),
  ]);
  const selectedWeekData = await loadScheduleRange({
    businessId: auth.businessId,
    membershipId: auth.membershipId,
    branchIds: branches.map((branch) => branch.id),
    from: weekStart,
    to: weekEnd,
  });
  const todayData = todayInWeek
    ? selectedWeekData
    : await loadScheduleRange({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        branchIds: branches.map((branch) => branch.id),
        from: today,
        to: today,
      });
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const todayView = dayView(today, todayData);
  const hasWeekFacts = selectedWeekData.assignments.length > 0 ||
    selectedWeekData.leaves.length > 0 ||
    selectedWeekData.holidays.length > 0;

  return (
    <section className="staff-roster-page" aria-labelledby="staff-roster-heading">
      <header className="staff-page-title staff-section-hero">
        <p>My roster</p>
        <h1 id="staff-roster-heading">Schedule</h1>
        <span>Your published shifts and approved time away.</span>
      </header>

      <TodayCard view={todayView} />

      <section className="staff-roster-week" aria-labelledby="staff-roster-week-heading">
        <header className="staff-roster-week-header">
          <div>
            <small>This week</small>
            <h2 id="staff-roster-week-heading">{weekLabel(weekStart, weekEnd)}</h2>
          </div>
          <nav className="staff-roster-nav" aria-label="Schedule week">
            <Link aria-label="Previous week" href={`/staff/roster?week=${dateValue(addDays(weekStart, -7))}`}>
              <span aria-hidden="true">‹</span> Previous
            </Link>
            <Link aria-label="Next week" href={`/staff/roster?week=${dateValue(addDays(weekStart, 7))}`}>
              Next <span aria-hidden="true">›</span>
            </Link>
          </nav>
        </header>

        {hasWeekFacts ? (
          <div className="staff-roster-list">
            {days.map((day) => {
              const isToday = dateValue(day) === dateValue(today);
              return (
                <ScheduleDay
                  day={day}
                  isToday={isToday}
                  key={dateValue(day)}
                  view={dayView(day, selectedWeekData)}
                />
              );
            })}
          </div>
        ) : (
          <div className="staff-roster-empty-week">
            <span aria-hidden="true">○</span>
            <strong>No schedule yet</strong>
            <p>Your upcoming shifts will appear here once your manager publishes the roster.</p>
          </div>
        )}
      </section>
      <p className="staff-roster-note">Schedule shows planned work only. Attendance records the hours you actually work.</p>
    </section>
  );
}
function TodayCard({ view }: { view: ReturnType<typeof buildStaffScheduleDay> }) {
  const singleShift = view.status === "SHIFT" && view.shifts.length === 1
    ? view.shifts[0]
    : null;
  return (
    <section className={`staff-page-card staff-roster-today status-${view.status.toLowerCase()}`} aria-labelledby="staff-roster-today-heading">
      <small>Today</small>
      <div>
        <h2 id="staff-roster-today-heading">{view.title}</h2>
        {view.timeLabel ? <strong className="staff-roster-time">{view.timeLabel}</strong> : null}
        {view.holidayLabel && view.status !== "PUBLIC_HOLIDAY" ? (
          <span className="staff-roster-holiday">Public holiday · {view.holidayLabel}</span>
        ) : null}
        {view.supportingLabel ? <p>{view.supportingLabel}</p> : null}
        {singleShift?.breakLabel ? <p>{singleShift.breakLabel} break</p> : null}
      </div>
    </section>
  );
}

function ScheduleDay({
  day,
  isToday,
  view,
}: {
  day: Date;
  isToday: boolean;
  view: ReturnType<typeof buildStaffScheduleDay>;
}) {
  return (
    <details className={`staff-roster-day status-${view.status.toLowerCase()}${isToday ? " is-today" : ""}`}>
      <summary aria-current={isToday ? "date" : undefined}>
        <span className="staff-roster-date">
          <strong>{day.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" }).toUpperCase()}</strong>
          <b>{day.getUTCDate()}</b>
          {isToday ? <em>Today</em> : null}
        </span>
        <span className="staff-roster-row-copy">
          {view.timeLabel ? <strong className="staff-roster-time">{view.timeLabel}</strong> : <strong>{view.title}</strong>}
          {view.timeLabel ? <small>{view.title}</small> : view.supportingLabel ? <small>{view.supportingLabel}</small> : null}
          {view.holidayLabel && view.status !== "PUBLIC_HOLIDAY" ? <small>Public holiday · {view.holidayLabel}</small> : null}
          {view.supportingLabel && view.status === "SHIFT" ? <small className="staff-roster-branch">{view.supportingLabel}</small> : null}
        </span>
        <span className="staff-roster-disclosure" aria-hidden="true">⌄</span>
      </summary>
      <DayDetail day={day} view={view} />
    </details>
  );
}

function DayDetail({ day, view }: { day: Date; view: ReturnType<typeof buildStaffScheduleDay> }) {
  return (
    <div className="staff-roster-detail">
      <h3>{day.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}</h3>
      {view.status === "SHIFT" && view.shifts.length ? view.shifts.map((shift) => (
        <section key={shift.id}>
          <div className="staff-roster-detail-shift">
            <strong>{shift.label}</strong>
            <span>{shift.timeLabel}</span>
            {shift.overnight ? <small>Overnight shift</small> : null}
          </div>
          <dl>
            <div><dt>Branch</dt><dd>{shift.branchName}</dd></div>
            <div><dt>Break</dt><dd>{shift.breakLabel ? `${shift.breakLabel} break` : "No scheduled break"}</dd></div>
            <div><dt>Expected Working Time</dt><dd>{shift.expectedWorkingTime}</dd></div>
          </dl>
        </section>
      )) : (
        <div className="staff-roster-detail-status">
          <strong>{view.title}</strong>
          {view.supportingLabel ? <span>{view.supportingLabel}</span> : null}
        </div>
      )}
      {view.holidayLabel ? <p className="staff-roster-detail-holiday">Public Holiday · {view.holidayLabel}</p> : null}
    </div>
  );
}

type ScheduleRangeData = {
  assignments: AssignmentRow[];
  leaves: Array<{ leaveDate: Date; label: string }>;
  holidays: Array<{ workDate: Date; name: string; branchName: string }>;
};

async function loadScheduleRange(input: {
  businessId: string;
  membershipId: string;
  branchIds: string[];
  from: Date;
  to: Date;
}): Promise<ScheduleRangeData> {
  const [scheduleByBranch, leaveDays, holidayByBranch] = await Promise.all([
    Promise.all(input.branchIds.map((branchId) => getEmployeePublishedRoster({
      businessId: input.businessId,
      membershipId: input.membershipId,
      branchId,
      from: input.from,
      to: input.to,
    }))),
    prisma.leaveRequestDay.findMany({
      where: {
        businessId: input.businessId,
        membershipId: input.membershipId,
        leaveDate: { gte: input.from, lte: input.to },
        leaveRequest: { branchId: { in: input.branchIds }, status: "APPROVED" },
      },
      include: { leaveRequest: { select: { policyNameSnapshot: true } } },
    }),
    Promise.all(input.branchIds.map(async (branchId) => {
      const [branch, holidays] = await Promise.all([
        prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }),
        resolveBranchHolidays({
          businessId: input.businessId,
          branchId,
          from: input.from,
          to: input.to,
        }),
      ]);
      return holidays.map((holiday) => ({
        workDate: holiday.workDate,
        name: holiday.name,
        branchName: branch?.name ?? "",
      }));
    })),
  ]);
  return {
    assignments: uniqueAssignments(scheduleByBranch.flat()),
    leaves: leaveDays.map((leave) => ({
      leaveDate: leave.leaveDate,
      label: leave.leaveRequest.policyNameSnapshot,
    })),
    holidays: uniqueHolidays(holidayByBranch.flat()),
  };
}

function dayView(day: Date, data: ScheduleRangeData) {
  const key = dateValue(day);
  return buildStaffScheduleDay({
    assignments: data.assignments.filter((assignment) => dateValue(assignment.workDate) === key) as StaffScheduleAssignment[],
    leaves: data.leaves.filter((leave) => dateValue(leave.leaveDate) === key).map((leave): StaffScheduleLeave => ({ label: leave.label })),
    holidays: data.holidays.filter((holiday) => dateValue(holiday.workDate) === key).map((holiday): StaffScheduleHoliday => ({ name: holiday.name, branchName: holiday.branchName })),
  });
}

function uniqueAssignments(assignments: AssignmentRow[]) {
  return [...new Map(assignments.map((assignment) => [assignment.id, assignment])).values()];
}

function uniqueHolidays(holidays: ScheduleRangeData["holidays"]) {
  return [...new Map(holidays.map((holiday) => [
    `${dateValue(holiday.workDate)}:${holiday.name.toLocaleLowerCase()}:${holiday.branchName}`,
    holiday,
  ])).values()];
}

function uniqueBranches(branches: Array<{ id: string; name: string }>) {
  return [...new Map(branches.map((branch) => [branch.id, branch])).values()];
}

function localDate(now: Date, timezone: string) {
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${value}T00:00:00.000Z`);
}

function parseDate(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
}

function weekLabel(from: Date, to: Date) {
  const sameMonth = from.getUTCMonth() === to.getUTCMonth();
  return sameMonth
    ? `${from.getUTCDate()} – ${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
    : `${from.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" })} – ${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}
