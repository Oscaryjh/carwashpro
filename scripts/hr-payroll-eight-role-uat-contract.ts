import { assertHrPayrollUatFixtureEnvironment } from "./uat-preview-database-guard";

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
      "ALL_BRANCHES",
      "ATTENDANCE_EMPLOYEE_READ",
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

type FixtureEnvironment = NodeJS.ProcessEnv;

export function assertEightRoleUatEnvironment(environment: FixtureEnvironment) {
  const preview = environment.APP_ENVIRONMENT?.trim().toLowerCase() === "uat-preview";
  if (environment.NODE_ENV === "production" && !preview) {
    throw new Error("HR_EIGHT_ROLE_UAT_FORBIDDEN_IN_PRODUCTION");
  }
  try {
    assertHrPayrollUatFixtureEnvironment(environment);
  } catch (error) {
    if (
      !preview &&
      error instanceof Error &&
      error.message === "HR_UAT_FIXTURE_LOCAL_DATABASE_REQUIRED"
    ) {
      throw new Error("HR_EIGHT_ROLE_UAT_REQUIRES_A_LOCAL_DATABASE");
    }
    throw error;
  }
  const password = environment.HR_EIGHT_ROLE_UAT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HR_EIGHT_ROLE_UAT_PASSWORD_MUST_BE_AT_LEAST_12_CHARACTERS");
  }
  return password;
}

type EightRoleUatDeviceIdentity = Readonly<{
  employeeAccountId: string;
  deviceIdentifierHash: string;
}>;

const EIGHT_ROLE_UAT_DEVICE_STATE = {
  displayName: "Eight-role UAT staff browser",
  platform: "Browser",
  browser: "Codex browser",
  canView: true,
  canPunch: true,
  status: "ACTIVE" as const,
  revokedAt: null,
  revokeReason: null,
};

export function resolveEightRoleUatDeviceWrite(
  existingDevice: Readonly<{ id: string }> | null,
  identity: EightRoleUatDeviceIdentity,
) {
  if (existingDevice) {
    return {
      mode: "UPDATE" as const,
      where: { id: existingDevice.id },
      data: { ...EIGHT_ROLE_UAT_DEVICE_STATE },
    };
  }
  return {
    mode: "CREATE" as const,
    data: {
      ...identity,
      ...EIGHT_ROLE_UAT_DEVICE_STATE,
    },
  };
}
