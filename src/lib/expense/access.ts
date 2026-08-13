import type { AppSession } from "@/lib/auth/session";
import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import type { ExpenseReadScope } from "./service";

export async function resolveExpenseReadScope(input: {
  access: ResolvedBusinessAccess;
  businessId: string;
  user: Pick<AppSession, "branchId" | "role">;
}): Promise<ExpenseReadScope & { branches: Array<{ id: string; name: string }> }> {
  const allBranches = await prisma.branch.findMany({
    where: { businessId: input.businessId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const broadAccess = input.access.granted && ["BUSINESS_OWNER", "GROUP_MANAGER_READ_ONLY"].includes(input.access.effectiveBusinessRole);
  const branches = broadAccess ? allBranches : allBranches.filter((branch) => branch.id === input.user.branchId);
  return {
    allowedBranchIds: branches.map((branch) => branch.id),
    branches,
    includeBusinessWide: broadAccess,
  };
}

export async function resolveExpenseMutationBranch(input: {
  access: ResolvedBusinessAccess;
  businessId: string;
  requestedBranchId?: string | null;
  user: Pick<AppSession, "branchId" | "role">;
}) {
  if (input.access.granted && input.access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY") {
    throw new Error("Group managers have read-only Expense access.");
  }
  if (input.access.granted && input.access.effectiveBusinessRole === "BUSINESS_OWNER" && !input.requestedBranchId) return null;
  const branchId = input.user.role === "BUSINESS_OWNER" ? input.requestedBranchId : input.user.branchId;
  if (!branchId) throw new Error("An authorised branch is required for this Expense.");
  const branch = await prisma.branch.findFirst({ where: { businessId: input.businessId, id: branchId, status: "ACTIVE" }, select: { id: true } });
  if (!branch) throw new Error("Expense branch is outside the authorised business scope.");
  return branch.id;
}

export function assertExpenseInMutationScope(expense: { branchId: string | null }, scope: ExpenseReadScope) {
  if (expense.branchId === null) {
    if (!scope.includeBusinessWide) throw new Error("Business-wide Expense is outside your scope.");
    return;
  }
  if (scope.allowedBranchIds && !scope.allowedBranchIds.includes(expense.branchId)) throw new Error("Expense is outside your branch scope.");
}
