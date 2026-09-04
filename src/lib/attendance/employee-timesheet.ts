import type {
  AttendanceExpectedDayKind,
  AttendanceOvertimeApprovalStatus,
  AttendanceOvertimeContext,
  AttendanceP2ExceptionStatus,
  AttendanceP2ExceptionType,
  AttendanceP2Outcome,
  AttendanceResolutionCaseStatus,
  PrismaClient,
} from "@prisma/client";
import type { EmployeeAuthContext } from "@/lib/attendance/employee-auth/session";
import { listAttendanceOvertimeCandidates } from "@/lib/attendance/overtime-service";
import { prisma } from "@/lib/prisma";

const ACTIVE_EXCEPTION_STATUSES: AttendanceP2ExceptionStatus[] = [
  "OPEN",
  "PENDING_EMPLOYEE",
  "PENDING_MANAGER",
];
const EMPLOYEE_ACTIONABLE_TYPES: AttendanceP2ExceptionType[] = [
  "MISSING_CLOCK_IN",
  "MISSING_CLOCK_OUT",
];

export type EmployeeTimesheetFinalInput = {
  id: string;
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  version: number;
  outcome: AttendanceP2Outcome;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  sourceDigest: string;
  createdAt: Date;
};

export type EmployeeTimesheetExceptionInput = {
  id: string;
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  type: AttendanceP2ExceptionType;
  status: AttendanceP2ExceptionStatus;
  expectedDayId: string | null;
  attendanceSessionId: string | null;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  exceptionMinutes: number;
  reasonCode: string;
  sourceDigest: string;
  detectedAt: Date;
  updatedAt: Date;
};

export type EmployeeTimesheetLockedDayInput = {
  id: string;
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  finalResultId: string;
  finalResultVersion: number;
  outcome: AttendanceP2Outcome;
  expectedDayKindSnapshot: AttendanceExpectedDayKind | null;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  sourceDigest: string;
  potentialOtMinutes: number;
  approvedOtMinutes: number;
  otContext: AttendanceOvertimeContext | null;
  otApprovalStatus: AttendanceOvertimeApprovalStatus;
};

export type EmployeeTimesheetDayIssue = Pick<
  EmployeeTimesheetExceptionInput,
  "id" | "type" | "status" | "exceptionMinutes" | "reasonCode"
>;

export type EmployeeTimesheetDay = {
  key: string;
  source: "LIVE_FINAL" | "LIVE_EXCEPTION" | "LOCKED_SNAPSHOT";
  businessId: string;
  branchId: string;
  membershipId: string;
  workDate: Date;
  status: "ACTION_NEEDED" | "WAITING_FOR_MANAGER" | "FINAL";
  outcome: AttendanceP2Outcome | null;
  actualClockInAt: Date | null;
  actualClockOutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkedMinutes: number;
  issues: EmployeeTimesheetDayIssue[];
  actionableException: {
    id: string;
    type: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
  } | null;
  resolutionCase?: {
    id: string;
    status: "OPEN" | "UNDER_REVIEW" | "RETURNED_FOR_CORRECTION";
  } | null;
};

export async function getEmployeeTimesheetOverview(
  auth: EmployeeAuthContext,
  options: { database?: PrismaClient; now?: Date } = {},
) {
  const database = options.database ?? prisma;
  const now = options.now ?? new Date();
  const { monthStart, monthEndExclusive } = employeeTimesheetMonthRange(now);
  const allowedBranchIds = [...new Set([auth.primaryBranchId, auth.attendanceBranchId].filter(Boolean))] as string[];
  const [rows, exceptions, overtime, timesheet, resolutionCases] = await Promise.all([
    database.attendanceP2FinalResult.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: monthStart, lt: monthEndExclusive },
      },
      orderBy: [{ workDate: "desc" }, { version: "desc" }],
    }),
    database.attendanceP2Exception.findMany({
      where: {
        businessId: auth.businessId,
        membershipId: auth.membershipId,
        workDate: { gte: monthStart, lt: monthEndExclusive },
        status: { in: ACTIVE_EXCEPTION_STATUSES },
      },
      orderBy: [{ workDate: "desc" }, { detectedAt: "desc" }],
    }),
    listAttendanceOvertimeCandidates({
      businessId: auth.businessId,
      allowedBranchIds,
      periodStart: monthStart,
      periodEndExclusive: monthEndExclusive,
      membershipId: auth.membershipId,
      database,
    }),
    database.attendanceMonthlyTimesheet.findUnique({
      where: {
        businessId_periodStart: {
          businessId: auth.businessId,
          periodStart: monthStart,
        },
      },
      select: { status: true, currentRevisionId: true },
    }),
    database.attendanceResolutionCase.findMany({
      where: {
        businessId: auth.businessId,
        employeeId: auth.membershipId,
        branchId: { in: allowedBranchIds },
        status: { in: ["OPEN", "UNDER_REVIEW", "RETURNED_FOR_CORRECTION"] },
        attendanceSession: {
          workDate: { gte: monthStart, lt: monthEndExclusive },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        businessId: true,
        employeeId: true,
        status: true,
        attendanceSession: { select: { workDate: true } },
      },
    }),
  ]);

  const lockedDays = timesheet?.status === "LOCKED" && timesheet.currentRevisionId
    ? await database.attendanceTimesheetP2DaySnapshot.findMany({
        where: {
          revisionId: timesheet.currentRevisionId,
          businessId: auth.businessId,
          membershipId: auth.membershipId,
        },
        orderBy: { workDate: "desc" },
        select: {
          id: true,
          businessId: true,
          branchId: true,
          membershipId: true,
          workDate: true,
          finalResultId: true,
          finalResultVersion: true,
          outcome: true,
          expectedDayKindSnapshot: true,
          actualClockInAt: true,
          actualClockOutAt: true,
          totalBreakMinutes: true,
          totalWorkedMinutes: true,
          sourceDigest: true,
          potentialOtMinutes: true,
          approvedOtMinutes: true,
          otContext: true,
          otApprovalStatus: true,
        },
      })
    : [];

  const projectedDays = projectEmployeeTimesheetDays({
    finalResults: rows,
    exceptions,
    lockedDays,
    timesheetStatus: timesheet?.status ?? "DRAFT",
  });
  const days = timesheet?.status === "LOCKED"
    ? projectedDays
    : applyEmployeeTimesheetResolutionCases(projectedDays, resolutionCases.map((item) => ({
        id: item.id,
        businessId: item.businessId,
        membershipId: item.employeeId,
        workDate: item.attendanceSession.workDate,
        status: item.status,
      })));
  const lockedOvertime = lockedDays.filter((day) => day.potentialOtMinutes > 0);

  return {
    monthStart,
    days,
    overtime,
    lockedOvertime,
    timesheetStatus: timesheet?.status ?? "DRAFT",
  };
}

export function applyEmployeeTimesheetResolutionCases(
  days: readonly EmployeeTimesheetDay[],
  cases: readonly Readonly<{
    id: string;
    businessId: string;
    membershipId: string;
    workDate: Date;
    status: AttendanceResolutionCaseStatus;
  }>[],
): EmployeeTimesheetDay[] {
  type ActiveResolutionCase = Omit<(typeof cases)[number], "status"> & {
    status: "OPEN" | "UNDER_REVIEW" | "RETURNED_FOR_CORRECTION";
  };
  const caseByWorkday = new Map<string, ActiveResolutionCase>();
  for (const resolutionCase of cases) {
    if (
      resolutionCase.status !== "OPEN" &&
      resolutionCase.status !== "UNDER_REVIEW" &&
      resolutionCase.status !== "RETURNED_FOR_CORRECTION"
    ) continue;
    const key = workdayKey(resolutionCase);
    if (!caseByWorkday.has(key)) {
      caseByWorkday.set(key, { ...resolutionCase, status: resolutionCase.status });
    }
  }
  return days.map((day) => {
    const resolutionCase = caseByWorkday.get(workdayKey(day));
    if (!resolutionCase) return day;
    return {
      ...day,
      status: resolutionCase.status === "UNDER_REVIEW"
        ? "WAITING_FOR_MANAGER"
        : "ACTION_NEEDED",
      actionableException: resolutionCase.status === "UNDER_REVIEW"
        ? null
        : day.actionableException,
      resolutionCase: {
        id: resolutionCase.id,
        status: resolutionCase.status,
      },
    };
  });
}

export function employeeTimesheetMonthRange(now: Date) {
  return {
    monthStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    monthEndExclusive: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * Builds the employee-facing Timesheet read model.
 *
 * P2 is intentionally day-based: multiple raw Attendance sessions are folded
 * into one immutable daily result before reaching this projector. Therefore
 * the canonical identity is business + membership + work date, not a label or
 * an exception row id.
 */
export function projectEmployeeTimesheetDays(input: {
  finalResults: readonly EmployeeTimesheetFinalInput[];
  exceptions: readonly EmployeeTimesheetExceptionInput[];
  lockedDays?: readonly EmployeeTimesheetLockedDayInput[];
  timesheetStatus: string;
}): EmployeeTimesheetDay[] {
  if (input.timesheetStatus === "LOCKED") {
    return dedupeLockedDays(input.lockedDays ?? []).map((day) => ({
      key: workdayKey(day),
      source: "LOCKED_SNAPSHOT",
      businessId: day.businessId,
      branchId: day.branchId,
      membershipId: day.membershipId,
      workDate: day.workDate,
      status: "FINAL",
      outcome: day.outcome,
      actualClockInAt: day.actualClockInAt,
      actualClockOutAt: day.actualClockOutAt,
      totalBreakMinutes: day.totalBreakMinutes,
      totalWorkedMinutes: day.totalWorkedMinutes,
      issues: [],
      actionableException: null,
    }));
  }

  const latestFinals = latestFinalByWorkday(input.finalResults);
  const issuesByWorkday = new Map<string, EmployeeTimesheetExceptionInput[]>();
  for (const issue of input.exceptions) {
    const key = workdayKey(issue);
    const final = latestFinals.get(key);
    // A later immutable final result supersedes an older active projection row.
    // Audit history remains in the database; it simply stops being an active
    // employee task. A newer exception still correctly overrides an older final.
    if (final && final.createdAt.getTime() >= issue.updatedAt.getTime()) continue;
    const issues = issuesByWorkday.get(key) ?? [];
    issues.push(issue);
    issuesByWorkday.set(key, issues);
  }

  const keys = new Set([...latestFinals.keys(), ...issuesByWorkday.keys()]);
  return [...keys]
    .map((key) => {
      const final = latestFinals.get(key) ?? null;
      const activeIssues = (issuesByWorkday.get(key) ?? []).sort(compareIssues);
      if (activeIssues.length) return exceptionDay(key, activeIssues, final);
      if (final) return finalDay(key, final);
      return null;
    })
    .filter((day): day is EmployeeTimesheetDay => Boolean(day))
    .sort((left, right) => right.workDate.getTime() - left.workDate.getTime());
}

function latestFinalByWorkday(rows: readonly EmployeeTimesheetFinalInput[]) {
  const latest = new Map<string, EmployeeTimesheetFinalInput>();
  for (const row of [...rows].sort((left, right) =>
    right.workDate.getTime() - left.workDate.getTime()
      || right.version - left.version
      || right.createdAt.getTime() - left.createdAt.getTime())) {
    const key = workdayKey(row);
    if (!latest.has(key)) latest.set(key, row);
  }
  return latest;
}

function dedupeLockedDays(rows: readonly EmployeeTimesheetLockedDayInput[]) {
  const days = new Map<string, EmployeeTimesheetLockedDayInput>();
  for (const row of [...rows].sort((left, right) =>
    right.workDate.getTime() - left.workDate.getTime()
      || right.finalResultVersion - left.finalResultVersion)) {
    const key = workdayKey(row);
    if (!days.has(key)) days.set(key, row);
  }
  return [...days.values()];
}

function exceptionDay(
  key: string,
  issues: EmployeeTimesheetExceptionInput[],
  final: EmployeeTimesheetFinalInput | null,
): EmployeeTimesheetDay {
  const actionable = issues.find((issue): issue is EmployeeTimesheetExceptionInput & {
    type: "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
  } => EMPLOYEE_ACTIONABLE_TYPES.includes(issue.type)
    && (issue.status === "OPEN" || issue.status === "PENDING_EMPLOYEE"));
  const primary = issues[0]!;
  return {
    key,
    source: "LIVE_EXCEPTION",
    businessId: primary.businessId,
    branchId: primary.branchId,
    membershipId: primary.membershipId,
    workDate: primary.workDate,
    status: actionable ? "ACTION_NEEDED" : "WAITING_FOR_MANAGER",
    outcome: null,
    actualClockInAt: primary.actualClockInAt ?? final?.actualClockInAt ?? null,
    actualClockOutAt: primary.actualClockOutAt ?? final?.actualClockOutAt ?? null,
    totalBreakMinutes: final?.totalBreakMinutes ?? 0,
    totalWorkedMinutes: final?.totalWorkedMinutes ?? 0,
    issues: uniqueIssues(issues).map(({ id, type, status, exceptionMinutes, reasonCode }) => ({
      id,
      type,
      status,
      exceptionMinutes,
      reasonCode,
    })),
    actionableException: actionable ? { id: actionable.id, type: actionable.type } : null,
  };
}

function finalDay(key: string, final: EmployeeTimesheetFinalInput): EmployeeTimesheetDay {
  return {
    key,
    source: "LIVE_FINAL",
    businessId: final.businessId,
    branchId: final.branchId,
    membershipId: final.membershipId,
    workDate: final.workDate,
    status: "FINAL",
    outcome: final.outcome,
    actualClockInAt: final.actualClockInAt,
    actualClockOutAt: final.actualClockOutAt,
    totalBreakMinutes: final.totalBreakMinutes,
    totalWorkedMinutes: final.totalWorkedMinutes,
    issues: [],
    actionableException: null,
  };
}

function uniqueIssues(issues: EmployeeTimesheetExceptionInput[]) {
  const unique = new Map<AttendanceP2ExceptionType, EmployeeTimesheetExceptionInput>();
  for (const issue of issues) if (!unique.has(issue.type)) unique.set(issue.type, issue);
  return [...unique.values()];
}

function compareIssues(left: EmployeeTimesheetExceptionInput, right: EmployeeTimesheetExceptionInput) {
  return exceptionPriority(left) - exceptionPriority(right)
    || right.updatedAt.getTime() - left.updatedAt.getTime()
    || left.id.localeCompare(right.id);
}

function exceptionPriority(issue: EmployeeTimesheetExceptionInput) {
  if (EMPLOYEE_ACTIONABLE_TYPES.includes(issue.type)
    && (issue.status === "OPEN" || issue.status === "PENDING_EMPLOYEE")) return 0;
  if (issue.status === "PENDING_MANAGER") return 1;
  return 2;
}

function workdayKey(value: { businessId: string; membershipId: string; workDate: Date }) {
  return `${value.businessId}:${value.membershipId}:${value.workDate.toISOString().slice(0, 10)}`;
}
