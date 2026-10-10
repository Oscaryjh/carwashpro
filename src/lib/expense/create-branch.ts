import { resolveOperationalBranchId } from "@/lib/branches";
import { resolveExpenseMutationBranch, resolveExpenseReadScope } from "./access";

// Only creation opts into implicit single-outlet resolution. Editing and
// recurring templates retain their existing business-wide scope contract.
export async function resolveExpenseCreateBranch(input: Parameters<typeof resolveExpenseMutationBranch>[0] & {
  user: Parameters<typeof resolveExpenseMutationBranch>[0]["user"] & { userId?: string };
  expenseScope?: "THIS_OUTLET" | "BUSINESS_WIDE";
}) {
  if (input.expenseScope !== undefined) {
    const { resolveExpenseOutletContext } = await import("./outlet-scope");
    const explicit = input.requestedBranchId;
    if (input.expenseScope === "BUSINESS_WIDE" && explicit) throw new Error("Conflicting expense scope and location input.");
    if (input.expenseScope === "THIS_OUTLET" && explicit !== undefined && !explicit) throw new Error("Conflicting expense scope and location input.");
    const { context, businessWideAllowed } = await resolveExpenseOutletContext({
      businessId: input.businessId, actorUserId: input.user.userId ?? "",
      ...(explicit === undefined ? {} : { explicitBranchInput: explicit }),
    });
    if (context.kind === "denied") throw new Error("Expense scope is outside your authorised access.");
    if (context.kind === "legacy_multi_branch") throw new Error("Operating locations changed. Reload and select a branch.");
    if (input.expenseScope === "BUSINESS_WIDE") {
      if (!businessWideAllowed) throw new Error("Business-wide Expense is outside your scope.");
      return null;
    }
    if (context.kind !== "single_outlet") throw new Error("An active outlet is required for this Expense.");
    return context.internalBranchId;
  }
  const scope = await resolveExpenseReadScope(input);
  // Preserve legitimate legacy blank/null semantics, but never silently ignore
  // an explicitly supplied location outside the existing actor scope.
  if (input.requestedBranchId && !scope.branches.some(branch => branch.id === input.requestedBranchId)) {
    throw new Error("Expense location is outside your authorised access.");
  }
  if (scope.branches.length === 1 && input.access.granted && input.access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY") {
    return resolveOperationalBranchId(input.businessId, input.user, input.requestedBranchId ?? null);
  }
  return resolveExpenseMutationBranch(input);
}
