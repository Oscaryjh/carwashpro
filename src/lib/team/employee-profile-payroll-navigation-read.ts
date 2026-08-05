import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

type EmployeePayrollNavigationInput = {
  access: ResolvedBusinessAccess;
  allowedBranchIds: readonly string[];
  businessId: string;
  membershipId: string;
};

type RestrictedOrHiddenState =
  | { status: "HIDDEN" }
  | { status: "ACCESS_DENIED"; reason: "WHOLE_BUSINESS_SCOPE" };

type NavigationState =
  | RestrictedOrHiddenState
  | { status: "AVAILABLE"; href: string };

export type EmployeePayrollNavigationResult = {
  payrollRuns: NavigationState;
  payslip:
    | RestrictedOrHiddenState
    | { status: "EMPTY" }
    | { status: "AVAILABLE"; href: string; periodStart: string };
  payment:
    | RestrictedOrHiddenState
    | { status: "NOT_AVAILABLE" };
};

export async function loadEmployeePayrollNavigationSection(
  input: EmployeePayrollNavigationInput,
  database: PrismaClient = prisma,
): Promise<EmployeePayrollNavigationResult> {
  const canViewRuns = hasBusinessCapability(input.access, "VIEW_PAYROLL_RUN");
  const canViewPayslip = hasBusinessCapability(input.access, "VIEW_PAYSLIP");
  const canViewPayment = hasBusinessCapability(
    input.access,
    "VIEW_PAYMENT_BATCH",
  );

  if (!canViewRuns && !canViewPayslip && !canViewPayment) {
    return hiddenNavigation();
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
    const restricted = {
      status: "ACCESS_DENIED" as const,
      reason: "WHOLE_BUSINESS_SCOPE" as const,
    };
    return {
      payrollRuns: canViewRuns ? restricted : { status: "HIDDEN" },
      payslip: canViewPayslip ? restricted : { status: "HIDDEN" },
      payment: canViewPayment ? restricted : { status: "HIDDEN" },
    };
  }

  const latestFinalizedPayslip = canViewPayslip
    ? await database.payrollEntry.findFirst({
        where: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          payrollRun: { status: "FINALIZED" },
        },
        orderBy: { payrollRun: { periodStart: "desc" } },
        select: {
          id: true,
          payrollRun: { select: { periodStart: true } },
        },
      })
    : null;

  return {
    payrollRuns: canViewRuns
      ? { status: "AVAILABLE", href: "/team/payroll/runs" }
      : { status: "HIDDEN" },
    payslip: !canViewPayslip
      ? { status: "HIDDEN" }
      : latestFinalizedPayslip
        ? {
            status: "AVAILABLE",
            href: `/team/payroll/payslips/${latestFinalizedPayslip.id}`,
            periodStart:
              latestFinalizedPayslip.payrollRun.periodStart.toISOString(),
          }
        : { status: "EMPTY" },
    payment: canViewPayment
      ? { status: "NOT_AVAILABLE" }
      : { status: "HIDDEN" },
  };
}

function hiddenNavigation(): EmployeePayrollNavigationResult {
  return {
    payrollRuns: { status: "HIDDEN" },
    payslip: { status: "HIDDEN" },
    payment: { status: "HIDDEN" },
  };
}
