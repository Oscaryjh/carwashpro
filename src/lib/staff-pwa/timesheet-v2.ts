import type { AttendanceOvertimeApprovalStatus } from "@prisma/client";
import type { EmployeeTimesheetDay } from "@/lib/attendance/employee-timesheet";

export type StaffTimesheetV2Overtime = Readonly<{
  key: string;
  membershipId: string;
  workDate: Date;
  finalResultId: string;
  status: AttendanceOvertimeApprovalStatus;
  potentialMinutes: number;
  approvedMinutes: number;
  managerReason: string | null;
  locked: boolean;
}>;

export type StaffTimesheetV2Row = Readonly<{
  key: string;
  workDate: Date;
  day: EmployeeTimesheetDay | null;
  overtime: StaffTimesheetV2Overtime | null;
  status: "ACTION_NEEDED" | "WAITING_FOR_MANAGER" | "FINAL";
}>;

export type StaffTimesheetV2Summary = Readonly<{
  action: number;
  waiting: number;
  final: number;
  rows: number;
  state: "ACTION_NEEDED" | "WAITING_FOR_MANAGER" | "FINAL" | "UP_TO_DATE";
}>;

export type StaffTimesheetV2SummaryItem = Readonly<{
  label: string;
  value: string;
}>;

export function buildStaffTimesheetV2Rows(input: {
  days: readonly EmployeeTimesheetDay[];
  overtime: readonly StaffTimesheetV2Overtime[];
}): StaffTimesheetV2Row[] {
  const rows = new Map<string, StaffTimesheetV2Row>();

  for (const day of input.days) {
    const key = employeeDateKey(day.membershipId, day.workDate);
    rows.set(key, {
      key,
      workDate: day.workDate,
      day,
      overtime: null,
      status: day.status,
    });
  }

  for (const overtime of input.overtime) {
    const key = employeeDateKey(overtime.membershipId, overtime.workDate);
    const current = rows.get(key);
    rows.set(key, {
      key,
      workDate: current?.workDate ?? overtime.workDate,
      day: current?.day ?? null,
      overtime,
      status: primaryStatus(current?.day ?? null, overtime),
    });
  }

  return [...rows.values()].sort(
    (left, right) => right.workDate.getTime() - left.workDate.getTime(),
  );
}

export function summarizeStaffTimesheetV2(
  rows: readonly StaffTimesheetV2Row[],
  timesheetStatus: string,
): StaffTimesheetV2Summary {
  const action = rows.filter((row) => row.status === "ACTION_NEEDED").length;
  const waiting = rows.filter((row) => row.status === "WAITING_FOR_MANAGER").length;
  const final = rows.filter((row) => row.status === "FINAL").length;
  return {
    action,
    waiting,
    final,
    rows: rows.length,
    state: action
      ? "ACTION_NEEDED"
      : waiting
        ? "WAITING_FOR_MANAGER"
        : timesheetStatus === "LOCKED"
          ? "FINAL"
          : "UP_TO_DATE",
  };
}

export function staffTimesheetSummaryItems(
  summary: StaffTimesheetV2Summary,
): StaffTimesheetV2SummaryItem[] {
  if (!summary.action && !summary.waiting) {
    return [{
      label: summary.state === "FINAL" ? "Final" : "Up to date",
      value: workdayCount(summary.rows),
    }];
  }

  return [
    ...(summary.action ? [{
      label: "Attention",
      value: `${itemCount(summary.action)} ${summary.action === 1 ? "needs" : "need"} attention`,
    }] : []),
    ...(summary.waiting ? [{
      label: "Manager review",
      value: `${itemCount(summary.waiting)} awaiting manager review`,
    }] : []),
    ...(summary.final ? [{
      label: "Final",
      value: workdayCount(summary.final),
    }] : []),
  ];
}

export function staffTimesheetNextAction(row: StaffTimesheetV2Row) {
  if (row.status === "ACTION_NEEDED") {
    if (row.day?.actionableException?.type === "MISSING_CLOCK_IN") {
      return "Fix your missing clock in.";
    }
    if (row.day?.actionableException?.type === "MISSING_CLOCK_OUT") {
      return "Fix your missing clock out.";
    }
    return "Fix the missing attendance time and send it for manager review.";
  }

  if (row.status === "WAITING_FOR_MANAGER") {
    if (row.day?.status === "WAITING_FOR_MANAGER") {
      return "No action — your manager needs to review this day.";
    }
    if (row.overtime?.status === "PENDING_REVIEW") {
      return "No action — your manager is reviewing the overtime.";
    }
  }

  return null;
}

export function parseStaffTimesheetMonth(
  value: string | string[] | undefined,
  fallback = new Date(),
) {
  const fallbackMonth = monthStart(fallback);
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return fallbackMonth;
  }
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed : fallbackMonth;
}

export function staffTimesheetMonthHref(month: Date, offset: number) {
  const shifted = new Date(Date.UTC(
    month.getUTCFullYear(),
    month.getUTCMonth() + offset,
    1,
  ));
  return `/staff/timesheet?month=${shifted.toISOString().slice(0, 7)}`;
}

export function staffTimesheetStatusLabel(status: StaffTimesheetV2Row["status"]) {
  if (status === "ACTION_NEEDED") return "Action needed";
  if (status === "WAITING_FOR_MANAGER") return "Waiting for manager";
  return "Final";
}

export function staffTimesheetDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (!hours) return `${remainder} min`;
  if (!remainder) return `${hours} hr`;
  return `${hours} hr ${remainder} min`;
}

export function staffTimesheetOvertimeLine(
  overtime: StaffTimesheetV2Overtime | null,
) {
  if (!overtime || overtime.status === "NOT_APPLICABLE") return null;
  if (overtime.status === "PENDING_REVIEW") {
    return `OT · Potential ${staffTimesheetDuration(overtime.potentialMinutes)}`;
  }
  if (overtime.status === "REJECTED") return "Overtime not approved";
  return `OT · ${staffTimesheetDuration(overtime.approvedMinutes)} approved`;
}

function primaryStatus(
  day: EmployeeTimesheetDay | null,
  overtime: StaffTimesheetV2Overtime,
): StaffTimesheetV2Row["status"] {
  if (day?.status === "ACTION_NEEDED") return "ACTION_NEEDED";
  if (day?.status === "WAITING_FOR_MANAGER" || overtime.status === "PENDING_REVIEW") {
    return "WAITING_FOR_MANAGER";
  }
  return "FINAL";
}

function monthStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function employeeDateKey(membershipId: string, workDate: Date) {
  return `${membershipId}:${workDate.toISOString().slice(0, 10)}`;
}

function itemCount(count: number) {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function workdayCount(count: number) {
  return `${count} workday${count === 1 ? "" : "s"}`;
}
