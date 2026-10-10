import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveCurrentOutletContext, type CurrentOutletContext, type OutletDatabase } from "@/lib/outlet-context";
import { resolveInventoryReadScope } from "@/lib/inventory/authorization";

/** Presentation only: never evidence of authorization for a writer. */
export type OutletPresentation =
  | { kind: "single_outlet"; internalBranchId: string }
  | { kind: "legacy_multi_branch" }
  | { kind: "no_location"; owner?: boolean }
  | { kind: "denied" };
export type OutletSubmissionSnapshot = OutletPresentation & { businessId: string };
type Input = { businessId: string; actorUserId: string; explicitBranchInput?: string | null };

export function outletBranches(context: CurrentOutletContext) {
  return context.kind === "single_outlet" ? [{ id: context.internalBranchId, name: context.branchNameSnapshot }]
    : context.kind === "legacy_multi_branch" ? [...context.branches] : [];
}

export function outletBranchInput(formData: FormData): Pick<Input, "explicitBranchInput"> {
  if (!formData.has("branchId")) return {};
  const values = formData.getAll("branchId");
  if (values.length !== 1 || typeof values[0] !== "string") throw new Error("Invalid stock location input.");
  return { explicitBranchInput: values[0] };
}

export function outletPresentation(context: CurrentOutletContext, owner = false): OutletPresentation {
  if (context.kind === "single_outlet") return { kind: context.kind, internalBranchId: context.internalBranchId };
  if (context.kind === "no_location") return { kind: context.kind, owner };
  return { kind: context.kind };
}

export async function resolveProductsOutletContext(input: Input, database: OutletDatabase = prisma) {
  // Products retains its existing business-wide catalog contract. Pages/actions
  // still enforce PRODUCTS; this consumer does not grant catalog permission.
  return resolveCurrentOutletContext({ ...input, capability: "VIEW_CATALOG", operation: "read",
    resolveScope: async () => ({ kind: "business" }),
  }, database);
}

export async function resolveInventoryOutletReadContext(input: Input, database: OutletDatabase = prisma) {
  return resolveCurrentOutletContext({ ...input, capability: "VIEW_INVENTORY", operation: "read",
    resolveScope: async ({ businessId, access, activeBranches }) => {
      const scope = await resolveInventoryReadScope(businessId, access);
      // Empty all-stores is an existing legacy read intent, not a write fallback.
      return scope.kind === "business" ? { ...scope, allowExplicitBusinessWide: activeBranches.length > 1 } : scope;
    },
  }, database);
}

export async function resolveInventoryOutletWriteContext(input: Input & { capability: "MANAGE_INVENTORY" | "ADJUST_INVENTORY" }, database: OutletDatabase = prisma) {
  return resolveCurrentOutletContext({ ...input, operation: "write",
    resolveScope: async ({ businessId, access }) => resolveInventoryReadScope(businessId, access),
  }, database);
}

export function assertOutletSubmissionSnapshot(rendered: OutletSubmissionSnapshot, current: CurrentOutletContext) {
  if (current.kind === "denied" || rendered.kind === "denied" || current.businessId !== rendered.businessId ||
      current.kind !== rendered.kind || (rendered.kind === "single_outlet" &&
      (current.kind !== "single_outlet" || current.internalBranchId !== rendered.internalBranchId))) {
    throw new Error("Operating location or access changed. Reload this page before continuing.");
  }
}

export function assertProductStockFields(formData: FormData, context: CurrentOutletContext) {
  const allowed = context.kind === "single_outlet" ? [context.internalBranchId]
    : context.kind === "legacy_multi_branch" ? context.branches.map(branch => branch.id) : [];
  for (const key of formData.keys()) {
    if ((key.startsWith("stock_") || key.startsWith("reorder_")) && !allowed.includes(key.slice(key.indexOf("_") + 1))) {
      throw new Error("Stock location is outside your authorised scope.");
    }
  }
}
