import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { DEFAULT_PAYROLL_SETTING } from "@/lib/payroll/service";
import { prisma } from "@/lib/prisma";

type EmployeeCompensationReadInput = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

export type EmployeeCompensationSectionResult =
  | {
      status: "ACCESS_DENIED";
      reason: "CAPABILITY" | "WHOLE_BUSINESS_SCOPE";
    }
  | {
      status: "NOT_FOUND";
    }
  | {
      status: "READY";
      data: {
        id: string;
        payBasis: "MONTHLY" | "DAILY" | "HOURLY";
        baseRate: string | null;
        workingDaysPerMonth: number;
        normalWorkMinutesPerDay: number;
        normalWorkPolicySource:
          | "Employee profile"
          | "Company payroll settings"
          | "System default";
        targetBreakMinutes: number;
        targetBreakPolicySource:
          | "Employee profile"
          | "Company payroll settings"
          | "System default";
      };
    };

export async function loadEmployeeCompensationSection(
  input: EmployeeCompensationReadInput,
  database: PrismaClient = prisma,
): Promise<EmployeeCompensationSectionResult> {
  if (!hasBusinessCapability(input.access, "VIEW_COMPENSATION")) {
    return { status: "ACCESS_DENIED", reason: "CAPABILITY" };
  }

  const activeBranchCount = await database.branch.count({
    where: { businessId: input.businessId, status: "ACTIVE" },
  });
  const hasWholeBusinessScope =
    input.allowedBranchIds.length === activeBranchCount &&
    !(
      input.access.granted &&
      input.access.effectiveBusinessRole === "STAFF" &&
      !input.access.permissions.includes("ALL_BRANCHES")
    );

  if (!hasWholeBusinessScope) {
    return { status: "ACCESS_DENIED", reason: "WHOLE_BUSINESS_SCOPE" };
  }

  const [membership, payrollSetting] = await Promise.all([
    database.employeeBusinessMembership.findFirst({
      where: {
        businessId: input.businessId,
        id: input.membershipId,
      },
      select: {
        id: true,
        payBasis: true,
        baseSalary: true,
        normalWorkMinutesPerDay: true,
        targetBreakMinutes: true,
      },
    }),
    database.payrollSetting.findUnique({
      where: { businessId: input.businessId },
      select: {
        workingDaysPerMonth: true,
        normalWorkMinutesPerDay: true,
        breakMinutesPerDay: true,
      },
    }),
  ]);

  if (!membership) {
    return { status: "NOT_FOUND" };
  }

  const normalWorkPolicySource = membership.normalWorkMinutesPerDay !== null
    ? "Employee profile"
    : payrollSetting
      ? "Company payroll settings"
      : "System default";
  const targetBreakPolicySource = membership.targetBreakMinutes !== null
    ? "Employee profile"
    : payrollSetting
      ? "Company payroll settings"
      : "System default";

  return {
    status: "READY",
    data: {
      id: membership.id,
      payBasis: membership.payBasis,
      baseRate: membership.baseSalary?.toString() ?? null,
      workingDaysPerMonth:
        payrollSetting?.workingDaysPerMonth ??
        DEFAULT_PAYROLL_SETTING.workingDaysPerMonth,
      normalWorkMinutesPerDay:
        membership.normalWorkMinutesPerDay ??
        payrollSetting?.normalWorkMinutesPerDay ??
        DEFAULT_PAYROLL_SETTING.normalWorkMinutesPerDay,
      normalWorkPolicySource,
      targetBreakMinutes:
        membership.targetBreakMinutes ??
        payrollSetting?.breakMinutesPerDay ??
        DEFAULT_PAYROLL_SETTING.breakMinutesPerDay,
      targetBreakPolicySource,
    },
  };
}
