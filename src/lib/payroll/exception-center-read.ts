import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasWholeBusinessPeopleScope } from "@/lib/team/people-scope";
import {
  buildCurrentPeopleAssignmentWhere,
  buildPeopleMembershipScopeWhere,
} from "@/lib/team/people-scope";
import { loadMonthlyAttendanceTimesheet } from "@/lib/attendance/timesheet-service";
import { parsePayrollMonth } from "@/lib/payroll/period";
import { getPayrollPeriodReadiness, type PayrollReadinessCode } from "@/lib/payroll/readiness";
import { prisma } from "@/lib/prisma";
import { loadLeavePayrollConflictContext } from "./leave-conflict-read";
import {
  resolvePayrollExceptionCenterCapabilities,
} from "./exception-center-access";
import {
  projectPayrollExceptionEmployees,
  type AttendanceExceptionFact,
} from "./exception-center-projection";
import {
  PAYROLL_EXCEPTION_AREA_LABELS,
  summarizePayrollExceptionRows,
  type PayrollExceptionArea,
  type PayrollExceptionOverview,
} from "./exception-center-types";

const MAX_ROWS = 1_000;
const RESTRICTED_READINESS_CODES = new Set<PayrollReadinessCode>([
  "PCB_PROFILE_INCOMPLETE",
  "PCB_YTD_LEDGER_INCOMPLETE",
  "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED",
  "CP38_INSTRUCTION_NOT_READY",
  "STATUTORY_PROFILE_INCOMPLETE",
  "MISSING_EPF_PROFILE",
  "MISSING_SOCSO_PROFILE",
  "MISSING_EIS_PROFILE",
  "STATUTORY_RULE_NOT_AVAILABLE",
  "STATUTORY_CLASSIFICATION_REQUIRED",
  "STATUTORY_CALCULATION_FAILED",
  "STALE_STATUTORY_PROFILE",
  "STALE_STATUTORY_SOURCE",
  "LINDUNG24_PROFILE_INCOMPLETE",
  "LINDUNG24_PARTICIPATION_REQUIRED",
  "LINDUNG24_SELECTED_EMPLOYER_REQUIRED",
  "LINDUNG24_APPLICABILITY_INCOMPLETE",
  "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED",
  "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE",
  "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED",
  "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED",
  "STALE_LINDUNG24_PARTICIPATION",
  "STATUTORY_WORK_PAY_NOT_READY",
  "STATUTORY_WORK_PAY_REVIEW_REQUIRED",
  "STALE_STATUTORY_WORK_PAY_SOURCE",
  "STATUTORY_WORK_PAY_RECONCILIATION_FAILED",
]);

export async function getPayrollExceptionOverview(
  input: {
    access: ResolvedBusinessAccess;
    allowedBranchIds: readonly string[];
    businessId: string;
    membershipId?: string;
    month: string;
    now?: Date;
    wholeBusinessScope: boolean;
  },
  database: PrismaClient = prisma,
): Promise<{ status: "ACCESS_DENIED" } | { status: "READY"; data: PayrollExceptionOverview }> {
  if (!input.access.granted) return { status: "ACCESS_DENIED" };
  const capabilities = resolvePayrollExceptionCenterCapabilities(input.access, input.businessId);
  if (!capabilities.granted) return { status: "ACCESS_DENIED" };

  const now = input.now ?? new Date();
  const period = parsePayrollMonth(input.month);
  const wholeBusinessScope = input.wholeBusinessScope && hasWholeBusinessPeopleScope(input.access);
  const scope = {
    allowedBranchIds: input.allowedBranchIds,
    businessId: input.businessId,
    now,
    wholeBusinessScope,
  };
  const [employees, accessibleBranches] = await Promise.all([
    database.employeeBusinessMembership.findMany({
      where: {
        ...buildPeopleMembershipScopeWhere(scope),
        ...(input.membershipId ? { id: input.membershipId } : {}),
        joinedAt: { lt: period.end },
        OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.start } }],
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      take: MAX_ROWS + 1,
      select: {
        employeeCode: true,
        fullName: true,
        id: true,
        branchAssignments: {
          where: buildCurrentPeopleAssignmentWhere(scope),
          orderBy: [{ isPrimary: "desc" }, { branch: { name: "asc" } }],
          select: { branch: { select: { id: true, name: true } } },
        },
      },
    }),
    database.branch.findMany({
      where: {
        businessId: input.businessId,
        status: "ACTIVE",
        ...(wholeBusinessScope ? {} : { id: { in: [...input.allowedBranchIds] } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const rowLimitReached = employees.length > MAX_ROWS;
  const boundedEmployees = employees.slice(0, MAX_ROWS).map((employee) => ({
    branches: employee.branchAssignments.map((assignment) => assignment.branch),
    employeeCode: employee.employeeCode,
    membershipId: employee.id,
    name: employee.fullName,
  }));

  if (boundedEmployees.length === 0) {
    return readyOverview({
      accessibleBranches,
      capabilities,
      month: period.value,
      now,
      rowLimitReached,
      rows: [],
    });
  }

  const visibleIds = new Set(boundedEmployees.map((employee) => employee.membershipId));
  const [payrollReadiness, attendance] = await Promise.all([
    capabilities.canViewPayroll
      ? getPayrollPeriodReadiness({ businessId: input.businessId, month: period.value }, database)
      : null,
    capabilities.canViewAttendance
      ? loadMonthlyAttendanceTimesheet({
          businessId: input.businessId,
          allowedBranchIds: input.allowedBranchIds,
          month: period.value,
          database,
        })
      : null,
  ]);
  const payrollIssues = payrollReadiness?.issues.filter((issue) =>
    issue.membershipId &&
    visibleIds.has(issue.membershipId) &&
    !RESTRICTED_READINESS_CODES.has(issue.code),
  ) ?? [];
  const attendanceFacts = attendance
    ? attendanceFactsForEmployees(attendance, boundedEmployees)
    : [];
  const leaveFacts = capabilities.canViewLeave
    ? await loadLeavePayrollConflictContext({
        allowedBranchIds: input.allowedBranchIds,
        businessId: input.businessId,
        membershipIds: boundedEmployees.map((employee) => employee.membershipId),
        month: period.value,
        timesheetLocked: attendance?.timesheet?.status === "LOCKED",
      }, database)
    : [];
  const rows = projectPayrollExceptionEmployees({
    access: capabilities,
    attendanceFacts,
    employees: boundedEmployees,
    leaveFacts,
    month: period.value,
    payrollIssues,
    setupIssues: [],
  });
  return readyOverview({
    accessibleBranches,
    capabilities,
    month: period.value,
    now,
    rowLimitReached,
    rows,
  });
}

function readyOverview(input: {
  accessibleBranches: Array<{ id: string; name: string }>;
  capabilities: ReturnType<typeof resolvePayrollExceptionCenterCapabilities>;
  month: string;
  now: Date;
  rowLimitReached: boolean;
  rows: PayrollExceptionOverview["rows"];
}): { status: "READY"; data: PayrollExceptionOverview } {
  const areas = [...new Set(input.rows.flatMap((row) => row.issues.map((issue) => issue.area)))]
    .sort((a, b) => Object.keys(PAYROLL_EXCEPTION_AREA_LABELS).indexOf(a) - Object.keys(PAYROLL_EXCEPTION_AREA_LABELS).indexOf(b)) as PayrollExceptionArea[];
  return {
    status: "READY",
    data: {
      areas,
      asOf: input.now.toISOString(),
      branches: input.accessibleBranches,
      canClaimPayrollReadiness: false,
      canViewPayroll: input.capabilities.canViewPayroll,
      hasAccessibleBranches: input.accessibleBranches.length > 0,
      month: input.month,
      restrictedAreas: ["TAX", "STATUTORY"],
      rowLimitReached: input.rowLimitReached,
      rows: input.rows,
      summary: summarizePayrollExceptionRows(input.rows),
    },
  };
}

function attendanceFactsForEmployees(
  attendance: Awaited<ReturnType<typeof loadMonthlyAttendanceTimesheet>>,
  employees: ReadonlyArray<{ membershipId: string }>,
) {
  const facts: AttendanceExceptionFact[] = [];
  const visibleIds = new Set(employees.map((employee) => employee.membershipId));
  for (const branch of attendance.branches) {
    for (const blocker of branch.blockers) {
      if (!visibleIds.has(blocker.employeeId)) continue;
      facts.push({
        area: "ATTENDANCE",
        detail: "An attendance record still needs a manager decision before the monthly timesheet can be completed.",
        membershipId: blocker.employeeId,
        title: "Attendance needs review",
        workDate: blocker.workDate.toISOString().slice(0, 10),
      });
    }
    for (const blocker of branch.p2Blockers) {
      if (!visibleIds.has(blocker.membershipId)) continue;
      facts.push({
        area: "ATTENDANCE",
        detail: "An attendance exception remains unresolved for this payroll month.",
        membershipId: blocker.membershipId,
        title: "Attendance exception is unresolved",
        workDate: blocker.workDate.toISOString().slice(0, 10),
      });
    }
    for (const blocker of branch.overtimeBlockers) {
      if (!visibleIds.has(blocker.membershipId)) continue;
      facts.push({
        area: "OVERTIME",
        detail: "Potential overtime is waiting for review or no longer matches the latest attendance result.",
        membershipId: blocker.membershipId,
        title: "Overtime needs review",
      });
    }
  }
  if (attendance.timesheet?.status !== "LOCKED") {
    for (const employee of employees) {
      facts.push({
        area: "TIMESHEET",
        detail: attendance.timesheet?.status === "APPROVED"
          ? "The approved monthly timesheet still needs to be locked before payroll."
          : "The monthly timesheet must be reviewed, approved and locked before payroll.",
        membershipId: employee.membershipId,
        title: attendance.timesheet?.status === "APPROVED" ? "Timesheet is awaiting lock" : "Timesheet is not locked",
      });
    }
  }
  return facts;
}
