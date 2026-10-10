import "server-only";

import { resolveCurrentOutletContext, type CurrentOutletContext } from "@/lib/outlet-context";
import { assertOutletSubmissionSnapshot, outletBranchInput, outletPresentation } from "@/lib/outlet-ui-context";

type Input = {
  businessId: string;
  actorUserId: string;
  capability: "RUN_CLOSING";
  operation: "read" | "write";
  explicitBranchInput?: string | null;
};

/** Phase-local consumer policy. The canonical adapter alone counts topology.
 * Existing document readers/writers retain their own historical authorization. */
export async function resolvePhase1c2OutletContext(input: Input) {
  return resolveCurrentOutletContext({ ...input, resolveScope: async ({ access }) => {
    if (access.effectiveBusinessRole === "BUSINESS_OWNER") return { kind: "business" };
    if (access.effectiveBusinessRole === "STAFF" && access.branchId) return { kind: "branches", branchIds: [access.branchId] };
    return { kind: "none" };
  } });
}

/** New current operations only. Never call for an existing Shift. */
export async function guardPhase1c2Create(input: Input & { rendered: CurrentOutletContext; formData: FormData }) {
  if (input.rendered.kind === "denied" || input.rendered.businessId !== input.businessId) {
    throw new Error("Outlet context is invalid. Reload before continuing.");
  }
  const current = await resolvePhase1c2OutletContext({ ...input, operation: "write", ...outletBranchInput(input.formData) });
  assertOutletSubmissionSnapshot({ ...outletPresentation(input.rendered), businessId: input.businessId }, current);
  if (current.kind === "denied" || current.kind === "no_location") throw new Error("An active authorised outlet is required.");
  const result = new FormData();
  for (const [key, value] of input.formData) result.append(key, value);
  if (current.kind === "single_outlet") result.set("branchId", current.internalBranchId);
  else if (current.branchInput.kind !== "explicit") throw new Error("Select an authorised branch before continuing.");
  return result;
}
