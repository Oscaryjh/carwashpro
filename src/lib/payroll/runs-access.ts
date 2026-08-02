import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";

export type PayrollRunsReadAccess =
  | { granted: false; scopeRestricted: boolean }
  | { granted: true; businessId: string };

export async function resolvePayrollRunsReadAccess(): Promise<PayrollRunsReadAccess> {
  const identity = await requireUser();
  const context = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId
      ? "VIEW_DASHBOARD"
      : undefined,
  );

  if (!hasBusinessCapability(context.access, "VIEW_PAYROLL_RUN")) {
    return { granted: false, scopeRestricted: false };
  }

  const [scope, activeBranchCount] = await Promise.all([
    resolveAttendanceScope(context.access),
    prisma.branch.count({
      where: { businessId: context.businessId, status: "ACTIVE" },
    }),
  ]);
  const hasWholeBusinessScope =
    scope.allowedBranchIds.length === activeBranchCount &&
    !(
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );

  return hasWholeBusinessScope
    ? { granted: true, businessId: context.businessId }
    : { granted: false, scopeRestricted: true };
}
