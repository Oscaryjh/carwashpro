export const HR_PAYROLL_EIGHT_ROLE_PERSONAS = [
  {
    key: "BUSINESS_OWNER",
    kind: "EXISTING_OWNER",
    email: null,
  },
  {
    key: "PAYROLL_ADMIN",
    kind: "DIRECT_USER",
    name: "UAT Payroll Admin",
    email: "uat.payroll-admin@tetamu.local",
    roleProfile: "Payroll Admin",
    permissions: [
      "PAYROLL_READ",
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "CREATE_PAYROLL_RUN",
      "EDIT_PAYROLL_ENTRY",
      "SUBMIT_PAYROLL_REVIEW",
      "RETURN_PAYROLL_TO_DRAFT",
      "APPROVE_PAYROLL",
      "REOPEN_PAYROLL",
      "EXPORT_PAYROLL",
      "VIEW_PAYSLIP",
      "PUBLISH_PAYSLIP",
    ],
  },
  {
    key: "HR_MANAGER",
    kind: "DIRECT_USER",
    name: "UAT HR Manager",
    email: "uat.hr-manager@tetamu.local",
    roleProfile: "HR Manager",
    permissions: [
      "ALL_BRANCHES",
      "ATTENDANCE_EMPLOYEE_READ",
      "ATTENDANCE_EMPLOYEE_MANAGE",
      "ROSTER_VIEW",
      "VIEW_LEAVE",
      "APPROVE_LEAVE",
      "VIEW_CLAIM",
      "REVIEW_CLAIM",
      "VIEW_COMPENSATION",
      "VIEW_PAYROLL_RUN",
      "VIEW_PAYSLIP",
      "PAYROLL_READ",
    ],
  },
  {
    key: "BRANCH_MANAGER",
    kind: "DIRECT_USER",
    name: "UAT Branch Manager",
    email: "uat.branch-manager@tetamu.local",
    roleProfile: "Branch Manager",
    permissions: [
      "ATTENDANCE_EMPLOYEE_READ",
      "ATTENDANCE_EMPLOYEE_MANAGE",
      "ROSTER_VIEW",
      "VIEW_LEAVE",
      "APPROVE_LEAVE",
      "VIEW_CLAIM",
      "REVIEW_CLAIM",
    ],
  },
  {
    key: "SUPERVISOR",
    kind: "DIRECT_USER",
    name: "UAT Supervisor",
    email: "uat.supervisor@tetamu.local",
    roleProfile: "Supervisor",
    permissions: [
      "ATTENDANCE_EMPLOYEE_READ",
      "ROSTER_VIEW",
      "VIEW_LEAVE",
      "APPROVE_LEAVE",
    ],
  },
  {
    key: "GROUP_OWNER",
    kind: "GROUP_USER",
    name: "UAT Group Owner",
    email: "uat.group-owner@tetamu.local",
    groupRole: "GROUP_OWNER",
  },
  {
    key: "GROUP_MANAGER",
    kind: "GROUP_USER",
    name: "UAT Group Manager",
    email: "uat.group-manager@tetamu.local",
    groupRole: "GROUP_MANAGER",
  },
  {
    key: "STAFF",
    kind: "EMPLOYEE",
    email: null,
  },
] as const;

export type HrPayrollEightRolePersona = (typeof HR_PAYROLL_EIGHT_ROLE_PERSONAS)[number];
export type HrPayrollEightRolePersonaKey = HrPayrollEightRolePersona["key"];

type FixtureEnvironment = Readonly<{
  DATABASE_URL?: string;
  HR_EIGHT_ROLE_UAT_PASSWORD?: string;
  NODE_ENV?: string;
}>;

export function assertEightRoleUatEnvironment(environment: FixtureEnvironment) {
  if (environment.NODE_ENV === "production") {
    throw new Error("HR_EIGHT_ROLE_UAT_FORBIDDEN_IN_PRODUCTION");
  }
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(environment.DATABASE_URL).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("HR_EIGHT_ROLE_UAT_REQUIRES_A_LOCAL_DATABASE");
  }
  const password = environment.HR_EIGHT_ROLE_UAT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HR_EIGHT_ROLE_UAT_PASSWORD_MUST_BE_AT_LEAST_12_CHARACTERS");
  }
  return password;
}
