import type { Metadata } from "next";
import { StaffScheduleV2 } from "@/components/staff-pwa/staff-schedule-v2";
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
import {
  buildStaffScheduleV2Week,
  type StaffScheduleV2SourceDay,
} from "@/lib/staff-pwa/schedule-v2";

type Props = { searchParams: Promise<{ week?: string }> };
type AssignmentRow = Awaited<ReturnType<typeof getEmployeePublishedRoster>>[number];

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

export default async function StaffSchedulePage({ searchParams }: Props) {
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
  const activeBranchId = auth.attendanceBranchId ?? auth.primaryBranchId;
  const assignedBranches = await prisma.employeeBranchAssignment.findMany({
    where: {
      businessId: auth.businessId,
      membershipId: auth.membershipId,
      status: "ACTIVE",
      effectiveFrom: { lt: addDays(weekEnd, 1) },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: weekStart } }],
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
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const week = buildStaffScheduleV2Week(days.map((day) => (
    scheduleDaySource(day, today, selectedWeekData)
  )));
  const hasWeekFacts = selectedWeekData.assignments.length > 0 ||
    selectedWeekData.leaves.length > 0 ||
    selectedWeekData.holidays.length > 0;
  const previousStart = addDays(weekStart, -7);
  const previousEnd = addDays(previousStart, 6);
  const nextStart = addDays(weekStart, 7);
  const nextEnd = addDays(nextStart, 6);
  const currentWeekStart = startOfIsoWeek(today);
  const selectedIsCurrentWeek = dateValue(currentWeekStart) === dateValue(weekStart);

  return (
    <StaffScheduleV2
      hasWeekFacts={hasWeekFacts}
      nextHref={`/staff/roster?week=${dateValue(nextStart)}`}
      nextLabel={`View next week, ${weekLabel(nextStart, nextEnd)}`}
      periodLabel={weekLabel(weekStart, weekEnd)}
      previousHref={`/staff/roster?week=${dateValue(previousStart)}`}
      previousLabel={`View previous week, ${weekLabel(previousStart, previousEnd)}`}
      todayHref={selectedIsCurrentWeek ? undefined : `/staff/roster?week=${dateValue(currentWeekStart)}`}
      todayLabel={selectedIsCurrentWeek ? undefined : `Return to current week, ${weekLabel(currentWeekStart, addDays(currentWeekStart, 6))}`}
      week={week}
    />
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

function scheduleDaySource(
  day: Date,
  today: Date,
  data: ScheduleRangeData,
): StaffScheduleV2SourceDay {
  const key = dateValue(day);
  const assignments = data.assignments.filter((assignment) => dateValue(assignment.workDate) === key);
  const leaves = data.leaves
    .filter((leave) => dateValue(leave.leaveDate) === key)
    .map((leave): StaffScheduleLeave => ({ label: leave.label }));
  const holidays = data.holidays.filter((holiday) => dateValue(holiday.workDate) === key);
  return {
    day,
    today,
    assignments: assignments as StaffScheduleAssignment[],
    holidayBranches: unique(holidays.map((holiday) => holiday.branchName).filter(Boolean)),
    view: buildStaffScheduleDay({
      assignments: assignments as StaffScheduleAssignment[],
      leaves,
      holidays: holidays.map((holiday): StaffScheduleHoliday => ({
        name: holiday.name,
        branchName: holiday.branchName,
      })),
    }),
  };
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
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function weekLabel(from: Date, to: Date) {
  const sameMonth = from.getUTCMonth() === to.getUTCMonth();
  return sameMonth
    ? `${from.getUTCDate()}–${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
    : `${from.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" })}–${to.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
