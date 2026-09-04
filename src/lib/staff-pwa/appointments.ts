import type { AppointmentStatus, PrismaClient } from "@prisma/client";
import { addDaysToDateValue, dateValueToUtcDate } from "@/lib/business-time";
import { businessWallClockToUtc } from "@/lib/business-day";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { getBranchLocalDateKey } from "@/lib/attendance/work-date";
import { canDirectStaff } from "@/lib/business-groups/capabilities";
import { prisma } from "@/lib/prisma";

const TERMINAL_STATUSES = new Set<AppointmentStatus>([
  "COMPLETED",
  "CONVERTED_TO_JOB",
  "CANCELLED",
  "NO_SHOW",
]);

export type StaffAppointmentStatusView = Readonly<{
  value: AppointmentStatus;
  label: string;
  tone: "scheduled" | "confirmed" | "arrived" | "service" | "complete" | "cancelled" | "no-show";
  terminal: boolean;
}>;

export type StaffAppointmentConflict = Readonly<{
  code: "OUTSIDE_SHIFT" | "REST_DAY" | "APPROVED_LEAVE";
  label: string;
}>;

export type StaffAppointmentScope = "MINE" | "COMPANY";

export type StaffAppointmentView = Readonly<{
  id: string;
  scheduledAt: string;
  endAt: string;
  dateKey: string;
  timeLabel: string;
  customerName: string;
  services: readonly Readonly<{ id: string; name: string; durationMinutes: number | null }>[];
  serviceSummary: string;
  durationMinutes: number;
  durationLabel: string;
  branchName: string;
  assignedStaffName: string;
  isOwnAppointment: boolean;
  timezone: string;
  status: StaffAppointmentStatusView;
  conflicts: readonly StaffAppointmentConflict[];
}>;

export type StaffAppointmentDay = Readonly<{
  date: string;
  dateLabel: string;
  timezone: string;
  isToday: boolean;
  previousDate: string;
  nextDate: string;
  staffMapping: "LINKED" | "MISSING";
  scope: StaffAppointmentScope;
  canViewCompanyAppointments: boolean;
  appointments: readonly StaffAppointmentView[];
  remainingCount: number;
  nextAppointment: StaffAppointmentView | null;
}>;

export type StaffAppointmentCalendarDay = Readonly<{
  date: string;
  dayLabel: string;
  weekdayLabel: string;
  selected: boolean;
}>;

export function getStaffAppointmentCalendarWeek(date: string): readonly StaffAppointmentCalendarDay[] {
  const selected = isDateValue(date) ? date : getBranchLocalDateKey(new Date(), "UTC");
  const selectedDate = dateValueToUtcDate(selected);
  const mondayOffset = (selectedDate.getUTCDay() + 6) % 7;
  const monday = addDaysToDateValue(selected, -mondayOffset);

  return Array.from({ length: 7 }, (_, index) => {
    const itemDate = addDaysToDateValue(monday, index);
    const utcDate = dateValueToUtcDate(itemDate);
    return {
      date: itemDate,
      dayLabel: String(utcDate.getUTCDate()),
      weekdayLabel: new Intl.DateTimeFormat("en-MY", {
        weekday: "short",
        timeZone: "UTC",
      }).format(utcDate),
      selected: itemDate === selected,
    };
  });
}

export async function getStaffAppointmentDay(input: {
  auth: EmployeeAuthContext;
  date?: string;
  scope?: StaffAppointmentScope;
  now?: Date;
  database?: PrismaClient;
}): Promise<StaffAppointmentDay> {
  const database = input.database ?? prisma;
  const now = input.now ?? new Date();
  const [business, staffUser] = await Promise.all([
    database.business.findFirstOrThrow({
      where: { id: input.auth.businessId },
      select: { timezone: true },
    }),
    database.user.findFirst({
      where: {
        businessId: input.auth.businessId,
        employeeBusinessMembershipId: input.auth.membershipId,
        status: "active",
      },
      select: {
        id: true,
        branchId: true,
        role: true,
        permissions: true,
      },
    }),
  ]);
  const today = getBranchLocalDateKey(now, business.timezone);
  const date = isDateValue(input.date) ? input.date! : today;
  const common = {
    date,
    dateLabel: formatDate(date),
    timezone: business.timezone,
    isToday: date === today,
    previousDate: addDaysToDateValue(date, -1),
    nextDate: addDaysToDateValue(date, 1),
  } as const;

  if (!staffUser) {
    return {
      ...common,
      staffMapping: "MISSING",
      scope: "MINE",
      canViewCompanyAppointments: false,
      appointments: [],
      remainingCount: 0,
      nextAppointment: null,
    };
  }

  const canViewCompanyAppointments = staffUser.role === "BUSINESS_OWNER"
    || (staffUser.role === "STAFF" && canDirectStaff(staffUser.permissions, "VIEW_APPOINTMENTS"));
  const requestedCompanyScope = input.scope === "COMPANY" && canViewCompanyAppointments;
  const wholeBusinessScope = staffUser.role === "BUSINESS_OWNER"
    || staffUser.permissions.includes("ALL_BRANCHES");
  const activeBranches = requestedCompanyScope
    ? await database.branch.findMany({
        where: { businessId: input.auth.businessId, status: "ACTIVE" },
        select: { id: true },
        orderBy: { id: "asc" },
      })
    : [];
  const activeBranchIds = activeBranches.map((branch) => branch.id);
  const currentBranchId = [staffUser.branchId, input.auth.attendanceBranchId, input.auth.primaryBranchId]
    .find((branchId): branchId is string => Boolean(branchId && activeBranchIds.includes(branchId)));
  const allowedCompanyBranchIds = wholeBusinessScope
    ? activeBranchIds
    : currentBranchId ? [currentBranchId] : [];
  const scope: StaffAppointmentScope = requestedCompanyScope ? "COMPANY" : "MINE";

  // Fetch a deliberately wider UTC window, then select each appointment by
  // its canonical branch timezone. This remains correct when one employee is
  // bookable at branches in different timezones.
  const rangeStart = businessWallClockToUtc(addDaysToDateValue(date, -1), "00:00", business.timezone);
  const rangeEnd = businessWallClockToUtc(addDaysToDateValue(date, 2), "00:00", business.timezone);
  const rows = await database.appointment.findMany({
    where: {
      businessId: input.auth.businessId,
      ...(scope === "MINE"
        ? { assignedStaffId: staffUser.id }
        : wholeBusinessScope
          ? {
              OR: [
                { branchId: { in: allowedCompanyBranchIds } },
                { branchId: null },
              ],
            }
          : { branchId: { in: allowedCompanyBranchIds } }),
      scheduledAt: { gte: rangeStart, lt: rangeEnd },
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      branchId: true,
      serviceId: true,
      serviceIds: true,
      scheduledAt: true,
      durationMinutes: true,
      status: true,
      customer: { select: { name: true } },
      assignedStaff: { select: { id: true, name: true } },
      branch: {
        select: {
          name: true,
          attendanceSetting: { select: { timezone: true } },
        },
      },
    },
  });
  const scopedRows = rows.filter((row) => {
    const timezone = row.branch?.attendanceSetting?.timezone ?? business.timezone;
    return getBranchLocalDateKey(row.scheduledAt, timezone) === date;
  });
  const serviceIds = [...new Set(scopedRows.flatMap((row) =>
    row.serviceIds.length ? row.serviceIds : row.serviceId ? [row.serviceId] : [],
  ))];
  const [services, expectedDays, approvedLeaveDays] = await Promise.all([
    serviceIds.length
      ? database.service.findMany({
          where: { businessId: input.auth.businessId, id: { in: serviceIds } },
          select: { id: true, name: true, durationMinutes: true },
        })
      : [],
    database.attendanceExpectedDay.findMany({
      where: {
        businessId: input.auth.businessId,
        membershipId: input.auth.membershipId,
        workDate: dateValueToUtcDate(date),
        status: "CURRENT",
      },
      select: { branchId: true, kind: true, expectedStartAt: true, expectedEndAt: true },
    }),
    database.leaveRequestDay.findMany({
      where: {
        businessId: input.auth.businessId,
        membershipId: input.auth.membershipId,
        leaveDate: dateValueToUtcDate(date),
        leaveRequest: { status: "APPROVED" },
      },
      select: { id: true },
    }),
  ]);
  const servicesById = new Map(services.map((service) => [service.id, service]));
  const appointments = scopedRows.map((row): StaffAppointmentView => {
    const timezone = row.branch?.attendanceSetting?.timezone ?? business.timezone;
    const ids = row.serviceIds.length ? row.serviceIds : row.serviceId ? [row.serviceId] : [];
    const selectedServices = ids.map((id) => servicesById.get(id)).filter(Boolean) as typeof services;
    const endAt = new Date(row.scheduledAt.getTime() + row.durationMinutes * 60_000);
    const expected = row.branchId
      ? expectedDays.find((day) => day.branchId === row.branchId)
      : expectedDays[0];
    const isOwnAppointment = row.assignedStaff?.id === staffUser.id;
    const conflicts: StaffAppointmentConflict[] = [];
    if (isOwnAppointment && approvedLeaveDays.length) {
      conflicts.push({ code: "APPROVED_LEAVE", label: "Overlaps approved leave" });
    }
    if (isOwnAppointment && expected?.kind === "REST_DAY") {
      conflicts.push({ code: "REST_DAY", label: "Scheduled on a rest day" });
    } else if (
      isOwnAppointment &&
      expected?.kind === "WORKDAY" &&
      expected.expectedStartAt &&
      expected.expectedEndAt &&
      (row.scheduledAt < expected.expectedStartAt || endAt > expected.expectedEndAt)
    ) {
      conflicts.push({ code: "OUTSIDE_SHIFT", label: "Outside published shift" });
    }
    return {
      id: row.id,
      scheduledAt: row.scheduledAt.toISOString(),
      endAt: endAt.toISOString(),
      dateKey: date,
      timeLabel: formatTime(row.scheduledAt, timezone),
      customerName: row.customer.name.trim() || "Customer",
      services: selectedServices,
      serviceSummary: selectedServices.length
        ? selectedServices.map((service) => service.name).join(" · ")
        : "Service not specified",
      durationMinutes: row.durationMinutes,
      durationLabel: formatDuration(row.durationMinutes),
      branchName: row.branch?.name ?? "Workplace",
      assignedStaffName: row.assignedStaff?.name.trim() || "Unassigned",
      isOwnAppointment,
      timezone,
      status: appointmentStatusView(row.status),
      conflicts,
    };
  });
  const remaining = appointments.filter((appointment) =>
    !appointment.status.terminal &&
    (new Date(appointment.endAt) > now || ["ARRIVED", "IN_SERVICE"].includes(appointment.status.value)),
  );

  return {
    ...common,
    staffMapping: "LINKED",
    scope,
    canViewCompanyAppointments,
    appointments,
    remainingCount: remaining.length,
    nextAppointment: scope === "MINE" && date === today ? remaining[0] ?? null : null,
  };
}

export function appointmentStatusView(status: AppointmentStatus): StaffAppointmentStatusView {
  const values: Record<AppointmentStatus, Omit<StaffAppointmentStatusView, "value" | "terminal">> = {
    SCHEDULED: { label: "Scheduled", tone: "scheduled" },
    CONFIRMED: { label: "Confirmed", tone: "confirmed" },
    ARRIVED: { label: "Arrived", tone: "arrived" },
    IN_SERVICE: { label: "In service", tone: "service" },
    COMPLETED: { label: "Completed", tone: "complete" },
    CONVERTED_TO_JOB: { label: "Converted to job", tone: "complete" },
    CANCELLED: { label: "Cancelled", tone: "cancelled" },
    NO_SHOW: { label: "No show", tone: "no-show" },
  };
  return { value: status, ...values[status], terminal: TERMINAL_STATUSES.has(status) };
}

function formatTime(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    weekday: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(dateValueToUtcDate(value));
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

function isDateValue(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return getBranchLocalDateKey(dateValueToUtcDate(value), "UTC") === value;
  } catch {
    return false;
  }
}
