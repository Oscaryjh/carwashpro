import { resolveOperationalBranchId } from "@/lib/branches";
import { resolveExpenseMutationBranch, resolveExpenseReadScope } from "./access";

// Only creation opts into implicit single-outlet resolution. Editing and
// recurring templates retain their existing business-wide scope contract.
export async function resolveExpenseCreateBranch(input: Parameters<typeof resolveExpenseMutationBranch>[0]) {
  const scope = await resolveExpenseReadScope(input);
  if (scope.branches.length === 1 && input.access.granted && input.access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY") {
    return resolveOperationalBranchId(input.businessId, input.user, input.requestedBranchId ?? null);
  }
  return resolveExpenseMutationBranch(input);
}
