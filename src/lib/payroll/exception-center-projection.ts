import type { PayrollReadinessIssue, PayrollReadinessSeverity } from "./readiness";
import type {
  PayrollExceptionAction,
  PayrollExceptionArea,
  PayrollExceptionEmployee,
  PayrollExceptionImpact,
  PayrollExceptionItem,
} from "./exception-center-types";
import type { LeavePayrollConflictFact } from "./leave-conflict-read";

type ProjectionAccess = {
  canEditAttendance: boolean;
  canEditCompensation: boolean;
  canEditStatutory: boolean;
  canEditTax: boolean;
  canEditLeave: boolean;
  canViewAttendance: boolean;
  canViewPayroll: boolean;
  canViewStatutory: boolean;
  canViewTax: boolean;
  canViewLeave: boolean;
};

export type PayrollExceptionEmployeeFacts = {
  branches: Array<{ id: string; name: string }>;
  employeeCode: string;
  membershipId: string;
  name: string;
};

export type AttendanceExceptionFact = {
  area: "ATTENDANCE" | "OVERTIME" | "TIMESHEET";
  detail: string;
  membershipId: string;
  title: string;
  workDate?: string;
};

const impactRank: Record<PayrollExceptionImpact, number> = {
  BLOCKING_PAYROLL: 0,
  NEEDS_REVIEW: 1,
  SETUP_REQUIRED: 2,
  READY: 3,
};

const areaRank: Record<PayrollExceptionArea, number> = {
  EMPLOYMENT: 10,
  ATTENDANCE: 20,
  LEAVE: 30,
  OVERTIME: 40,
  TIMESHEET: 50,
  PAY_SETUP: 60,
  TAX: 70,
  STATUTORY: 80,
};

export function projectPayrollExceptionEmployees(input: {
  access: ProjectionAccess;
  attendanceFacts: readonly AttendanceExceptionFact[];
  employees: readonly PayrollExceptionEmployeeFacts[];
  month: string;
  leaveFacts?: readonly LeavePayrollConflictFact[];
  payrollIssues: readonly PayrollReadinessIssue[];
  setupIssues: ReadonlyArray<{
    actionLabel: string;
    detail: string;
    href: string;
    label: string;
    membershipId: string;
    scheme: "EMPLOYMENT" | "PCB" | "EPF" | "SOCSO" | "EIS" | "LINDUNG24";
    status: "NEEDS_SETUP" | "REVIEW_REQUIRED";
  }>;
}) {
  const payrollByEmployee = groupByMembership(input.payrollIssues.filter(
    (issue): issue is PayrollReadinessIssue & { membershipId: string } => issue.membershipId !== null,
  ));
  const setupByEmployee = groupByMembership(input.setupIssues);
  const attendanceByEmployee = groupByMembership(input.attendanceFacts);
  const leaveByEmployee = groupByMembership(input.leaveFacts ?? []);
  return input.employees.map((employee): PayrollExceptionEmployee => {
    const detailPath = exceptionDetailPath(employee.membershipId, input.month);
    const issues = [
      ...(payrollByEmployee.get(employee.membershipId) ?? [])
        .map((issue) => projectPayrollIssue(issue, input.access, employee.membershipId, input.month, detailPath))
        .filter((issue): issue is PayrollExceptionItem => Boolean(issue)),
      ...(attendanceByEmployee.get(employee.membershipId) ?? [])
        .map((fact) => projectAttendanceFact(fact, input.access, input.month, detailPath))
        .filter((issue): issue is PayrollExceptionItem => Boolean(issue)),
      ...(leaveByEmployee.get(employee.membershipId) ?? [])
        .filter((fact) => !leaveDuplicatesAttendance(fact, attendanceByEmployee.get(employee.membershipId) ?? []))
        .map((fact) => projectLeaveFact(fact, input.access, input.month, detailPath))
        .filter((issue): issue is PayrollExceptionItem => Boolean(issue)),
      ...(setupByEmployee.get(employee.membershipId) ?? [])
        .map((issue) => projectSetupIssue(issue, input.access, employee.membershipId, input.month, detailPath))
        .filter((issue): issue is PayrollExceptionItem => Boolean(issue)),
    ];
    const unique = deduplicate(issues).sort(compareIssues);
    const status = unique[0]?.impact ?? "READY";
    return {
      ...employee,
      issues: unique,
      mainIssue: unique[0] ?? null,
      status,
    };
  }).sort((a, b) =>
    impactRank[a.status] - impactRank[b.status] ||
    (a.mainIssue ? areaRank[a.mainIssue.area] : 999) - (b.mainIssue ? areaRank[b.mainIssue.area] : 999) ||
    a.name.localeCompare(b.name),
  );
}

function projectLeaveFact(
  fact: LeavePayrollConflictFact,
  access: ProjectionAccess,
  month: string,
  detailPath: string,
): PayrollExceptionItem | null {
  if (!access.canViewLeave) return null;
  const evidence = fact.kind === "EVIDENCE_REVIEW";
  return {
    action: access.canEditLeave
      ? { href: `/team/leave?year=${month.slice(0, 4)}&queue=pending`, label: evidence ? "Review evidence" : "Review leave" }
      : { href: detailPath, label: "View issue" },
    area: "LEAVE",
    detail: evidence
      ? "Supporting evidence for a leave request affecting this payroll month still needs review."
      : "A leave request affecting this payroll month still needs a decision.",
    impact: "NEEDS_REVIEW",
    owner: evidence ? "HR / Manager" : "Manager",
    title: evidence ? "Leave evidence needs review" : "Leave needs review",
  };
}

function leaveDuplicatesAttendance(fact: LeavePayrollConflictFact, attendanceFacts: readonly AttendanceExceptionFact[]) {
  const dates = new Set(fact.relevantDates);
  return attendanceFacts.some((attendance) =>
    attendance.area === "ATTENDANCE" && attendance.workDate && dates.has(attendance.workDate),
  );
}

function projectPayrollIssue(
  issue: PayrollReadinessIssue,
  access: ProjectionAccess,
  membershipId: string,
  month: string,
  detailPath: string,
): PayrollExceptionItem | null {
  if (issue.severity === "INFO" || issue.membershipId === null) return null;
  const presentation = payrollIssuePresentation(issue.code);
  if (!presentation || !areaVisible(presentation.area, access)) return null;
  return {
    action: actionForArea(presentation.area, access, membershipId, month, detailPath),
    area: presentation.area,
    detail: presentation.detail,
    impact: severityImpact(issue.severity),
    owner: ownerForArea(presentation.area),
    title: presentation.title,
  };
}

function projectAttendanceFact(
  fact: AttendanceExceptionFact,
  access: ProjectionAccess,
  month: string,
  detailPath: string,
): PayrollExceptionItem | null {
  if (!access.canViewAttendance) return null;
  return {
    action: access.canEditAttendance
      ? { href: `/team/attendance/timesheets?month=${month}`, label: fact.area === "OVERTIME" ? "Review overtime" : fact.area === "TIMESHEET" ? "Open timesheet" : "Review attendance" }
      : { href: detailPath, label: "View issue" },
    area: fact.area,
    detail: fact.detail,
    impact: "BLOCKING_PAYROLL",
    owner: "Manager",
    title: fact.title,
  };
}

function projectSetupIssue(
  issue: {
    actionLabel: string;
    detail: string;
    href: string;
    scheme: "EMPLOYMENT" | "PCB" | "EPF" | "SOCSO" | "EIS" | "LINDUNG24";
    status: "NEEDS_SETUP" | "REVIEW_REQUIRED";
    label: string;
  },
  access: ProjectionAccess,
  membershipId: string,
  month: string,
  detailPath: string,
): PayrollExceptionItem | null {
  const area: PayrollExceptionArea = issue.scheme === "EMPLOYMENT"
    ? "EMPLOYMENT"
    : issue.scheme === "PCB"
      ? "TAX"
      : "STATUTORY";
  if (!areaVisible(area, access)) return null;
  const canEdit = area === "TAX"
    ? access.canEditTax
    : area === "STATUTORY"
      ? access.canEditStatutory
      : false;
  return {
    action: canEdit
      ? actionForArea(area, access, membershipId, month, detailPath)
      : { href: detailPath, label: "View issue" },
    area,
    detail: issue.detail,
    impact: issue.status === "NEEDS_SETUP" ? "SETUP_REQUIRED" : "NEEDS_REVIEW",
    owner: area === "EMPLOYMENT" ? "HR" : "HR / Payroll",
    title: issue.label,
  };
}

function payrollIssuePresentation(code: PayrollReadinessIssue["code"]): {
  area: PayrollExceptionArea;
  detail: string;
  title: string;
} | null {
  switch (code) {
    case "PCB_CORRECTION_SETTLEMENT_REQUIRED":
      return { area: "TAX", title: "Apply prior-period PCB adjustment", detail: "Refresh the next open draft and confirm PCB again. A payroll adjustment is not proof of payment." };
    case "PCB_MANUAL_CONFIRMATION_REQUIRED":
      return { area: "TAX", title: "Confirm PCB for this payroll", detail: "An authorized payroll user must confirm the amount, including zero, with external evidence and MFA for the current inputs." };
    case "PRORATION_NOT_SUPPORTED":
      return { area: "EMPLOYMENT", title: "Employment dates need review", detail: "This employee joined or left during the month and the pay treatment needs confirmation." };
    case "MISSING_COMPENSATION":
      return { area: "PAY_SETUP", title: "Pay setup is missing", detail: "No verified pay setup applies to this payroll month." };
    case "RECONCILIATION_FAILED":
      return { area: "PAY_SETUP", title: "Payroll totals need review", detail: "The saved payroll components do not match the employee total." };
    case "APPROVED_VARIABLE_PAY_MISSING":
      return { area: "PAY_SETUP", title: "Approved variable pay is missing", detail: "Approved variable pay has not been included in this payroll draft." };
    case "APPROVED_CORRECTION_MISSING":
      return { area: "PAY_SETUP", title: "Approved correction is missing", detail: "An approved payroll correction has not been included in this payroll draft." };
    case "PENDING_VARIABLE_PAY":
      return { area: "PAY_SETUP", title: "Variable pay needs review", detail: "A draft variable-pay item is waiting for a decision." };
    case "MISSING_LOCKED_TIMESHEET":
      return { area: "TIMESHEET", title: "Timesheet is not locked", detail: "The monthly attendance timesheet must be reviewed and locked before payroll." };
    case "STALE_ATTENDANCE_SOURCE":
    case "TIMESHEET_REVISION_INVALID":
    case "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED":
    case "ATTENDANCE_PAY_POLICY_NOT_READY":
    case "LEGACY_ATTENDANCE_INPUT":
      return { area: "ATTENDANCE", title: "Attendance input needs review", detail: "The payroll draft does not match the current approved attendance record." };
    case "OVERTIME_APPROVAL_SOURCE_NOT_READY":
      return { area: "OVERTIME", title: "Overtime needs review", detail: "An overtime decision is still required before payroll can continue." };
    case "PCB_PROFILE_INCOMPLETE":
    case "PCB_YTD_LEDGER_INCOMPLETE":
    case "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED":
    case "CP38_INSTRUCTION_NOT_READY":
      return { area: "TAX", title: "Tax setup needs attention", detail: "Review this employee's tax information for the selected payroll month." };
    case "STATUTORY_PROFILE_INCOMPLETE":
    case "MISSING_EPF_PROFILE":
    case "MISSING_SOCSO_PROFILE":
    case "MISSING_EIS_PROFILE":
    case "STATUTORY_RULE_NOT_AVAILABLE":
    case "STATUTORY_CLASSIFICATION_REQUIRED":
    case "STATUTORY_CALCULATION_FAILED":
    case "STALE_STATUTORY_PROFILE":
    case "STALE_STATUTORY_SOURCE":
    case "LINDUNG24_PROFILE_INCOMPLETE":
    case "LINDUNG24_PARTICIPATION_REQUIRED":
    case "LINDUNG24_SELECTED_EMPLOYER_REQUIRED":
    case "LINDUNG24_APPLICABILITY_INCOMPLETE":
    case "LINDUNG24_LOCAL_PARTICIPATION_DECISION_REQUIRED":
    case "LINDUNG24_FOREIGN_MANDATORY_PROFILE_INCOMPLETE":
    case "LINDUNG24_MULTIPLE_EMPLOYER_SELECTION_REQUIRED":
    case "LINDUNG24_POLICY_TRANSITION_REVIEW_REQUIRED":
    case "STALE_LINDUNG24_PARTICIPATION":
    case "STATUTORY_WORK_PAY_NOT_READY":
    case "STATUTORY_WORK_PAY_REVIEW_REQUIRED":
    case "STALE_STATUTORY_WORK_PAY_SOURCE":
    case "STATUTORY_WORK_PAY_RECONCILIATION_FAILED":
      return { area: "STATUTORY", title: "Statutory setup needs attention", detail: "Review the employee's statutory setup for the selected payroll month." };
    case "EMPTY_PAYROLL_RUN":
    case "MISSING_BANK_ACCOUNT":
    case "BANK_ACCOUNT_UNVERIFIED":
    case "FUTURE_COMPENSATION_CHANGE":
    case "APPROVED_INPUT_READY":
    case "CLAIM_STATUTORY_TREATMENT_NOT_READY":
      return null;
  }
}

function severityImpact(severity: PayrollReadinessSeverity): "BLOCKING_PAYROLL" | "NEEDS_REVIEW" {
  return severity === "BLOCKING" ? "BLOCKING_PAYROLL" : "NEEDS_REVIEW";
}

function areaVisible(area: PayrollExceptionArea, access: ProjectionAccess) {
  if (area === "ATTENDANCE" || area === "OVERTIME" || area === "TIMESHEET") return access.canViewAttendance;
  if (area === "LEAVE") return access.canViewLeave;
  if (area === "PAY_SETUP") return access.canViewPayroll;
  if (area === "TAX") return access.canViewTax;
  if (area === "STATUTORY") return access.canViewStatutory;
  return true;
}

function actionForArea(
  area: PayrollExceptionArea,
  access: ProjectionAccess,
  membershipId: string,
  month: string,
  detailPath: string,
): PayrollExceptionAction {
  const returnPath = `/team/payroll/exceptions?month=${month}`;
  if (area === "EMPLOYMENT") return { href: detailPath, label: "View issue" };
  if (area === "LEAVE") {
    return access.canEditLeave
      ? { href: `/team/leave?year=${month.slice(0, 4)}&queue=pending`, label: "Review leave" }
      : { href: detailPath, label: "View issue" };
  }
  if (area === "ATTENDANCE" || area === "OVERTIME" || area === "TIMESHEET") {
    return access.canEditAttendance
      ? { href: `/team/attendance/timesheets?month=${month}`, label: area === "OVERTIME" ? "Review overtime" : area === "TIMESHEET" ? "Open timesheet" : "Review attendance" }
      : { href: detailPath, label: "View issue" };
  }
  if (area === "PAY_SETUP") {
    return access.canEditCompensation
      ? { href: `/team/people/${membershipId}?section=compensation&view=summary&peopleReturn=${encodeURIComponent(returnPath)}`, label: "Open pay setup" }
      : { href: detailPath, label: "View issue" };
  }
  if (area === "TAX") {
    return access.canEditTax
      ? { href: `/team/people/${membershipId}?section=compensation&view=pcb&peopleReturn=${encodeURIComponent(returnPath)}`, label: "Fix tax setup" }
      : { href: detailPath, label: "View issue" };
  }
  return access.canEditStatutory
    ? { href: `/team/people/${membershipId}?section=compensation&view=statutory&peopleReturn=${encodeURIComponent(returnPath)}`, label: "Fix statutory setup" }
    : { href: detailPath, label: "View issue" };
}

function ownerForArea(area: PayrollExceptionArea) {
  if (area === "ATTENDANCE" || area === "OVERTIME" || area === "TIMESHEET") return "Manager";
  if (area === "LEAVE") return "Manager";
  if (area === "EMPLOYMENT") return "HR";
  return "HR / Payroll";
}

function exceptionDetailPath(membershipId: string, month: string) {
  return `/team/payroll/exceptions/${membershipId}?month=${month}`;
}

function compareIssues(a: PayrollExceptionItem, b: PayrollExceptionItem) {
  return impactRank[a.impact] - impactRank[b.impact] ||
    areaRank[a.area] - areaRank[b.area] ||
    a.title.localeCompare(b.title);
}

function deduplicate(issues: PayrollExceptionItem[]) {
  return [...new Map(issues.map((issue) => [`${issue.area}:${issue.title}`, issue])).values()];
}

function groupByMembership<T extends { membershipId: string }>(items: readonly T[]) {
  const grouped = new Map<string, T[]>();
  for (const item of items) grouped.set(item.membershipId, [...(grouped.get(item.membershipId) ?? []), item]);
  return grouped;
}
