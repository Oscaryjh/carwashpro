import "server-only";

import { resolveCurrentOutletContext } from "@/lib/outlet-context";

/** Expense owns Business-wide/null semantics; outlet-context owns topology.
 * Re-evaluate effective access on every call, never trust the rendered scope. */
export async function resolveExpenseOutletContext(input: {
  businessId: string;
  actorUserId: string;
  capability?: "CREATE_EXPENSE" | "VIEW_EXPENSE" | "EDIT_EXPENSE_DRAFT";
  operation?: "read" | "write";
  explicitBranchInput?: string | null;
}) {
  let businessWideAllowed = false;
  const context = await resolveCurrentOutletContext({
    ...input, capability: input.capability ?? "CREATE_EXPENSE", operation: input.operation ?? "write",
    resolveScope: async ({ access }) => {
      businessWideAllowed = access.effectiveBusinessRole === "BUSINESS_OWNER";
      return businessWideAllowed || (input.operation === "read" && access.effectiveBusinessRole === "GROUP_MANAGER_READ_ONLY") ? { kind: "business", allowExplicitBusinessWide: true }
        : access.effectiveBusinessRole !== "GROUP_MANAGER_READ_ONLY" && access.branchId
          ? { kind: "branches", branchIds: [access.branchId] } : { kind: "none" };
    },
  });
  return { context, businessWideAllowed: context.kind !== "denied" && businessWideAllowed };
}
