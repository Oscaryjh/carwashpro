import { getEmployeeAttendanceToday, getEmployeeAttendanceHistory } from "@/lib/attendance/read-service";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeTimesheetOverview } from "@/lib/attendance/employee-timesheet";
import { resolveBranchHolidays } from "@/lib/holidays/service";
import { prisma } from "@/lib/prisma";
import { getEmployeePublishedRoster } from "@/lib/roster/service";
import { getMissingClockOutCorrectionState } from "@/lib/staff-pwa/attendance-correction-eligibility";
import {
  buildStaffScheduleDay,
  type StaffScheduleAssignment,
  type StaffScheduleHoliday,
  type StaffScheduleLeave,
} from "@/lib/staff-pwa/schedule";

export type StaffTimeHubModel = Readonly<{
  today: Readonly<{
    title: string;
    meta: string | null;
    badge: string | null;
    tone: "neutral" | "success" | "warning";
  }> | null;
  todayError: boolean;
  attention: Readonly<{
    count: number;
    meta: string;
    href: string;
  }> | null;
  schedule: Readonly<{
    summary: string;
  }> | null;
  timesheet: Readonly<{
    month: string;
    summary: string;
  }> | null;
}>;

export async function getStaffTimeHub(
  auth: EmployeeAuthContext,
): Promise<StaffTimeHubModel> {
  const [todayResult, historyResult, scheduleResult, timesheetResult] = await Promise.allSettled([
    getEmployeeAttendanceToday({ auth }),
    getEmployeeAttendanceHistory({ auth, input: { page: 1, pageSize: 100 } }),
    getTodayScheduleSummary(auth),
    getEmployeeTimesheetOverview(auth),
  ]);

  const today = todayResult.status === "fulfilled"
    ? summarizeToday(todayResult.value)
    : null;
  const history = historyResult.status === "fulfilled"
    ? historyResult.value
    : null;
  const actionable = history?.items.filter(
    (item) => getMissingClockOutCorrectionState(item) === "ACTIONABLE",
  ) ?? [];
  const timesheet = timesheetResult.status === "fulfilled"
    ? summarizeTimesheet(timesheetResult.value)
    : null;

  return {
    today,
    todayError: todayResult.status === "rejected",
    attention: actionable.length
      ? {
          count: actionable.length,
          href: "/staff/history/records#attendance-correction",
          meta: actionable.length === 1
            ? `${formatShortDate(actionable[0]!.workDate)} · Missing clock out`
            : `${actionable.length} items to fix`,
        }
      : null,
    schedule: scheduleResult.status === "fulfilled"
      ? scheduleResult.value
      : null,
    timesheet,
  };
}

function summarizeToday(
  today: Awaited<ReturnType<typeof getEmployeeAttendanceToday>>,
): StaffTimeHubModel["today"] {
  const timezone = today.geofenceRequirements.timezone;
  if (today.status === "OPEN") {
    return {
      title: `Clocked in${today.clockInAt ? ` · since ${formatTime(today.clockInAt, timezone)}` : ""}`,
      meta: today.currentWorkedMinutes > 0 ? `Worked ${formatDuration(today.currentWorkedMinutes)}` : null,
      badge: "Working",
      tone: "success",
    };
  }
  if (today.status === "ON_BREAK") {
    return {
      title: `On break${today.breakStartedAt ? ` · since ${formatTime(today.breakStartedAt, timezone)}` : ""}`,
      meta: today.currentWorkedMinutes > 0 ? `Worked ${formatDuration(today.currentWorkedMinutes)}` : null,
      badge: "On break",
      tone: "warning",
    };
  }
  if (today.status === "COMPLETED") {
    const completedRange = today.sessionCount === 1
      && today.currentSession?.clockInAt
      && today.currentSession.clockOutAt
      ? `${formatCompactTime(today.currentSession.clockInAt, timezone)}–${formatCompactTime(today.currentSession.clockOutAt, timezone)}`
      : null;
    const worked = today.currentWorkedMinutes > 0
      ? `Worked ${formatDuration(today.currentWorkedMinutes)}`
      : null;
    return {
      title: "Shift completed",
      meta: [completedRange, worked].filter(Boolean).join(" · ") || null,
      badge: null,
      tone: "success",
    };
  }
  return {
    title: "Ready to clock in",
    meta: null,
    badge: "Ready",
    tone: "neutral",
  };
}

async function getTodayScheduleSummary(
  auth: EmployeeAuthContext,
): Promise<{ summary: string }> {
  const branchId = auth.attendanceBranchId ?? auth.primaryBranchId;
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: auth.businessId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), business.timezone);
  const [assignments, leaveDays, holidays, branch] = await Promise.all([
    getEmployeePublishedRoster({
      businessId: auth.businessId,
      branchId,
      membershipId: auth.membershipId,
      from: today,
      to: today,
    }),
    prisma.leaveRequestDay.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        leaveDate: today,
        leaveRequest: { branchId, status: "APPROVED" },
      },
      include: { leaveRequest: { select: { policyNameSnapshot: true } } },
    }),
    resolveBranchHolidays({
      businessId: auth.businessId,
      branchId,
      from: today,
      to: today,
    }),
    prisma.branch.findFirst({
      where: { id: branchId, businessId: auth.businessId, status: "ACTIVE" },
      select: { name: true },
    }),
  ]);
  const view = buildStaffScheduleDay({
    assignments: assignments as StaffScheduleAssignment[],
    leaves: leaveDays.map(
      (leave): StaffScheduleLeave => ({ label: leave.leaveRequest.policyNameSnapshot }),
    ),
    holidays: holidays.map(
      (holiday): StaffScheduleHoliday => ({
        name: holiday.name,
        branchName: branch?.name ?? "",
      }),
    ),
  });

  if (view.status === "NOT_SCHEDULED") return { summary: "No schedule today" };
  if (view.status === "REST_DAY") return { summary: "Rest day" };
  if (view.status === "APPROVED_LEAVE") return { summary: "Approved leave" };
  if (view.status === "PUBLIC_HOLIDAY") return { summary: "Public holiday" };
  return { summary: view.timeLabel ? `Today · ${view.timeLabel}` : view.title };
}

function summarizeTimesheet(
  overview: Awaited<ReturnType<typeof getEmployeeTimesheetOverview>>,
): { month: string; summary: string } {
  const actionCount = overview.days.filter((day) => day.status === "ACTION_NEEDED").length;
  const waitingDays = overview.days.filter((day) => day.status === "WAITING_FOR_MANAGER").length;
  const overtimeRows = overview.timesheetStatus === "LOCKED"
    ? overview.lockedOvertime
    : overview.overtime;
  const waitingOvertime = overtimeRows.filter((item) => (
    "otApprovalStatus" in item
      ? item.otApprovalStatus === "PENDING_REVIEW"
      : item.effectiveStatus === "PENDING_REVIEW"
  )).length;
  const waitingCount = waitingDays + waitingOvertime;
  return {
    month: formatMonth(overview.monthStart),
    summary: actionCount
      ? `${actionCount} ${actionCount === 1 ? "item needs" : "items need"} attention`
      : waitingCount
        ? `${waitingCount} ${waitingCount === 1 ? "item" : "items"} awaiting manager review`
        : overview.timesheetStatus === "LOCKED"
          ? "Final"
          : "Up to date",
  };
}

function localDate(value: Date, timezone: string) {
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(value);
  return new Date(`${date}T00:00:00.000Z`);
}

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatCompactTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining}m`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}
