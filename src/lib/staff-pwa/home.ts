import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getEmployeeAuthProfile } from "@/lib/attendance/employee-auth/session";
import { resolveBranchHolidays } from "@/lib/holidays/service";
import type { ModuleKey } from "@/lib/modules/registry";
import { prisma } from "@/lib/prisma";
import { addDays, dateValue } from "@/lib/roster/domain";
import { getEmployeePublishedRoster } from "@/lib/roster/service";
import {
  buildStaffScheduleDay,
  type StaffScheduleAssignment,
  type StaffScheduleHoliday,
  type StaffScheduleLeave,
} from "@/lib/staff-pwa/schedule";
import { loadStaffAppAppearance } from "./appearance";
import { getStaffAppointmentDay } from "./appointments";

export type StaffHomeQuickAccess = Readonly<{
  domain: "TIMESHEET" | "CLAIMS" | "COMMISSION" | "PAYSLIP";
  label: string;
  href: string;
}>;

export type StaffHomeUpNext = Readonly<{
  dateLabel: string;
  title: string;
  timeLabel: string | null;
  branchName: string | null;
  href: string;
  status: "READY" | "EMPTY" | "UNAVAILABLE";
}>;

export async function getStaffHomeOverview(
  auth: EmployeeAuthContext,
  enabledModules: readonly string[],
) {
  const modules = new Set(enabledModules as readonly ModuleKey[]);
  const [profile, appearance, business] = await Promise.all([
    getEmployeeAuthProfile(auth),
    loadStaffAppAppearance(auth.businessId),
    prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { timezone: true },
    }),
  ]);

  const [upNext, appointmentDay] = await Promise.all([
    modules.has("HR") ? loadUpNext(auth, business.timezone) : null,
    modules.has("SALON") ? getStaffAppointmentDay({ auth }).catch(() => null) : null,
  ]);

  return {
    profile,
    appearance,
    quickAccess: buildQuickAccess(modules),
    upNext,
    appointmentDay,
    showWelcome: true,
  };
}

function buildQuickAccess(modules: ReadonlySet<ModuleKey>): StaffHomeQuickAccess[] {
  const items: StaffHomeQuickAccess[] = [];
  if (modules.has("COMMISSION")) {
    items.push({ domain: "COMMISSION", label: "Commission", href: "/staff/commission" });
  }
  if (modules.has("CLAIMS")) {
    items.push({ domain: "CLAIMS", label: "Claims", href: "/staff/claims" });
  }
  if (modules.has("PAYROLL")) {
    items.push({ domain: "PAYSLIP", label: "Payslips", href: "/staff/payslips" });
  }
  if (modules.has("HR")) {
    items.push({ domain: "TIMESHEET", label: "Timesheets", href: "/staff/timesheet" });
  }
  return items;
}

async function loadUpNext(
  auth: EmployeeAuthContext,
  timezone: string,
): Promise<StaffHomeUpNext> {
  try {
    const today = localDate(new Date(), timezone);
    const from = addDays(today, 1);
    const to = addDays(today, 7);
    const branchId = auth.attendanceBranchId ?? auth.primaryBranchId;
    const [assignments, leaveDays, holidays, branch] = await Promise.all([
      getEmployeePublishedRoster({
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        branchId,
        from,
        to,
      }),
      prisma.leaveRequestDay.findMany({
        where: {
          businessId: auth.businessId,
          membershipId: auth.membershipId,
          leaveDate: { gte: from, lte: to },
          leaveRequest: { branchId, status: "APPROVED" },
        },
        include: { leaveRequest: { select: { policyNameSnapshot: true } } },
      }),
      resolveBranchHolidays({
        businessId: auth.businessId,
        branchId,
        from,
        to,
      }),
      prisma.branch.findFirst({
        where: { id: branchId, businessId: auth.businessId, status: "ACTIVE" },
        select: { name: true },
      }),
    ]);
    const nextDate = earliestDate([
      ...assignments.map((assignment) => assignment.workDate),
      ...leaveDays.map((leave) => leave.leaveDate),
      ...holidays.map((holiday) => holiday.workDate),
    ]);
    if (!nextDate) {
      return {
        dateLabel: "Upcoming",
        title: "No upcoming shift",
        timeLabel: null,
        branchName: null,
        href: "/staff/roster",
        status: "EMPTY",
      };
    }
    const key = dateValue(nextDate);
    const view = buildStaffScheduleDay({
      assignments: assignments.filter((assignment) => dateValue(assignment.workDate) === key) as StaffScheduleAssignment[],
      leaves: leaveDays
        .filter((leave) => dateValue(leave.leaveDate) === key)
        .map((leave): StaffScheduleLeave => ({ label: leave.leaveRequest.policyNameSnapshot })),
      holidays: holidays
        .filter((holiday) => dateValue(holiday.workDate) === key)
        .map((holiday): StaffScheduleHoliday => ({ name: holiday.name, branchName: branch?.name ?? "" })),
    });
    return {
      dateLabel: dateValue(nextDate) === dateValue(from)
        ? "Tomorrow"
        : nextDate.toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }),
      title: view.title,
      timeLabel: view.timeLabel,
      branchName: assignments.find((assignment) => dateValue(assignment.workDate) === key)?.branch.name ?? branch?.name ?? null,
      href: "/staff/roster",
      status: "READY",
    };
  } catch {
    return {
      dateLabel: "Upcoming",
      title: "Schedule temporarily unavailable",
      timeLabel: null,
      branchName: null,
      href: "/staff/roster",
      status: "UNAVAILABLE",
    };
  }
}

function earliestDate(values: readonly Date[]) {
  return values.length
    ? new Date(Math.min(...values.map((value) => value.getTime())))
    : null;
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
