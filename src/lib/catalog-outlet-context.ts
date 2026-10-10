import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveBranchId } from "@/lib/branches";
import { resolveCurrentOutletContext, type OutletDatabase } from "@/lib/outlet-context";
import { assertOutletSubmissionSnapshot, outletBranchInput, type OutletSubmissionSnapshot } from "@/lib/outlet-ui-context";

type CatalogInput = {
  businessId: string;
  actorUserId: string;
  resource: "SERVICES" | "PACKAGES";
  operation: "read" | "write";
  explicitBranchInput?: string | null;
};

/** Catalog consumer policy, not a second topology classifier or writer grant. */
export async function resolveCatalogOutletContext(input: CatalogInput, database: OutletDatabase = prisma) {
  return resolveCurrentOutletContext({ ...input, capability: "VIEW_CATALOG", resolveScope: async ({ access }) => {
    if (access.effectiveBusinessRole === "STAFF" && !access.permissions.includes(input.resource)) return { kind: "none" };
    if (input.operation === "read") {
      // Existing catalog reads are business-wide. Explicit branch selection must
      // still respect the actor's branch; null-only legacy filters stay null-only.
      if (access.effectiveBusinessRole === "STAFF" && input.explicitBranchInput && input.explicitBranchInput !== access.branchId) return { kind: "none" };
      return { kind: "business", allowExplicitBusinessWide: true };
    }
    if (access.effectiveBusinessRole === "BUSINESS_OWNER") return { kind: "business" };
    if (access.effectiveBusinessRole === "STAFF" && access.branchId) return { kind: "branches", branchIds: [access.branchId] };
    return { kind: "none" };
  } }, database);
}

export async function guardCatalogOutletSubmission(input: Omit<CatalogInput, "operation"> & {
  snapshot: OutletSubmissionSnapshot;
  formData: FormData;
}) {
  const branchInput = outletBranchInput(input.formData);
  // An explicit empty value has the existing resolver semantics. Never treat it
  // as an absent field for edit preservation.
  const current = await resolveCatalogOutletContext({ ...input, operation: "write",
    ...(branchInput.explicitBranchInput ? branchInput : {}),
  });
  assertOutletSubmissionSnapshot(input.snapshot, current);
  if (current.kind === "no_location" || current.kind === "denied") throw new Error("This business does not have an operating location set up yet.");
  return current;
}

/** Existing record comes from the action's authorized, business-scoped read.
 * Only absent input in freshly resolved single topology preserves its branch.
 * No client-provided historical branch or hidden preservation flag is trusted. */
export async function resolveCatalogEditBranch(input: Omit<CatalogInput, "operation"> & {
  existingBranchId: string | null;
  formData: FormData;
}) {
  const branchInput = outletBranchInput(input.formData);
  const current = await resolveCatalogOutletContext({ ...input, operation: "write",
    ...(branchInput.explicitBranchInput ? branchInput : {}),
  });
  if (current.kind === "denied") throw new Error("Catalog branch access denied.");
  if (!input.formData.has("branchId") && current.kind === "single_outlet") return input.existingBranchId;
  return resolveBranchId(input.businessId, input.formData.get("branchId"));
}
