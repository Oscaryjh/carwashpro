export type PayrollExceptionImpact =
  | "BLOCKING_PAYROLL"
  | "NEEDS_REVIEW"
  | "SETUP_REQUIRED"
  | "READY";

export type PayrollExceptionArea =
  | "EMPLOYMENT"
  | "ATTENDANCE"
  | "LEAVE"
  | "OVERTIME"
  | "TIMESHEET"
  | "PAY_SETUP"
  | "TAX"
  | "STATUTORY";

export const PAYROLL_EXCEPTION_IMPACT_LABELS: Record<PayrollExceptionImpact, string> = {
  BLOCKING_PAYROLL: "Blocking payroll",
  NEEDS_REVIEW: "Needs review",
  SETUP_REQUIRED: "Setup required",
  READY: "Ready",
};

export const PAYROLL_EXCEPTION_AREA_LABELS: Record<PayrollExceptionArea, string> = {
  EMPLOYMENT: "Employment",
  ATTENDANCE: "Attendance",
  LEAVE: "Leave",
  OVERTIME: "Overtime",
  TIMESHEET: "Timesheet",
  PAY_SETUP: "Pay setup",
  TAX: "Tax",
  STATUTORY: "Statutory",
};

export type PayrollExceptionAction = {
  href: string;
  label: string;
};

export type PayrollExceptionItem = {
  action: PayrollExceptionAction | null;
  area: PayrollExceptionArea;
  detail: string;
  impact: Exclude<PayrollExceptionImpact, "READY">;
  owner: string;
  title: string;
};

export type PayrollExceptionEmployee = {
  branches: Array<{ id: string; name: string }>;
  employeeCode: string;
  issues: PayrollExceptionItem[];
  mainIssue: PayrollExceptionItem | null;
  membershipId: string;
  name: string;
  status: PayrollExceptionImpact;
};

export type PayrollExceptionOverview = {
  areas: PayrollExceptionArea[];
  asOf: string;
  branches: Array<{ id: string; name: string }>;
  canClaimPayrollReadiness: boolean;
  canViewPayroll: boolean;
  hasAccessibleBranches: boolean;
  month: string;
  restrictedAreas: Array<"TAX" | "STATUTORY">;
  rowLimitReached: boolean;
  rows: PayrollExceptionEmployee[];
  summary: {
    blocking: number;
    needsReview: number;
    ready: number;
    setupRequired: number;
    total: number;
  };
};

export function filterPayrollExceptionRows(
  rows: readonly PayrollExceptionEmployee[],
  input: {
    area?: string;
    branch?: string;
    impact?: string;
    search?: string;
    showReady?: boolean;
  },
) {
  const search = input.search?.trim().toLocaleLowerCase() ?? "";
  return rows.filter((row) =>
    (input.showReady || row.status !== "READY") &&
    (!search || `${row.name} ${row.employeeCode}`.toLocaleLowerCase().includes(search)) &&
    (!input.branch || row.branches.some((branch) => branch.id === input.branch)) &&
    (!input.impact || row.status === input.impact) &&
    (!input.area || row.issues.some((issue) => issue.area === input.area)),
  );
}

export function summarizePayrollExceptionRows(rows: readonly PayrollExceptionEmployee[]) {
  return {
    blocking: rows.filter((row) => row.status === "BLOCKING_PAYROLL").length,
    needsReview: rows.filter((row) => row.status === "NEEDS_REVIEW").length,
    ready: rows.filter((row) => row.status === "READY").length,
    setupRequired: rows.filter((row) => row.status === "SETUP_REQUIRED").length,
    total: rows.length,
  };
}
