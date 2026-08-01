import { redirect } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";

export async function requireWholeBusinessPayroll(
  capability: "VIEW_PAYROLL" | "MODIFY_PAYROLL",
) {
  const context = await requireBusinessUser(capability);
  const [scope, activeBranchCount] = await Promise.all([
    resolveAttendanceScope(context.access),
    prisma.branch.count({
      where: { businessId: context.businessId, status: "ACTIVE" },
    }),
  ]);
  if (
    scope.allowedBranchIds.length !== activeBranchCount ||
    (context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES"))
  ) {
    redirect(
      "/team?type=error&message=Payroll%20requires%20all-branch%20access.",
    );
  }
  return { ...context, allowedBranchIds: [...scope.allowedBranchIds] };
}
