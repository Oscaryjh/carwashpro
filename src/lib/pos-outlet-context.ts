import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveCurrentOutletContext, type CurrentOutletContext, type OutletDatabase } from "@/lib/outlet-context";
import { assertOutletSubmissionSnapshot, outletBranchInput, outletPresentation } from "@/lib/outlet-ui-context";

type PosOutletInput = {
  businessId: string;
  actorUserId: string;
  capability: "PROCESS_CASHIER_PAYMENT" | "VIEW_APPOINTMENTS" | "MODIFY_APPOINTMENTS";
  operation: "read" | "write";
  explicitBranchInput?: string | null;
};

/** Consumer policy only: business topology is resolved by the one canonical adapter.
 * Keep existing Owner/all and Staff/assigned operational scope, never ALL_BRANCHES. */
export async function resolvePosOutletContext(input: PosOutletInput, database: OutletDatabase = prisma) {
  return resolveCurrentOutletContext({ ...input, resolveScope: async ({ access }) => {
    if (access.effectiveBusinessRole === "BUSINESS_OWNER") return { kind: "business" };
    if (access.effectiveBusinessRole === "STAFF" && access.branchId) return { kind: "branches", branchIds: [access.branchId] };
    return { kind: "none" };
  } }, database);
}

export async function guardPosOutletSubmission(
  input: PosOutletInput & { rendered: CurrentOutletContext; formData: FormData },
  database: OutletDatabase = prisma,
) {
  if (input.rendered.kind === "denied" || input.rendered.businessId !== input.businessId) throw new Error("Business access changed. Reload this page before continuing.");
  const current = await resolvePosOutletContext({ ...input, operation: "write", ...outletBranchInput(input.formData) }, database);
  assertOutletSubmissionSnapshot({ ...outletPresentation(input.rendered), businessId: input.businessId }, current);
  if (current.kind === "no_location" || current.kind === "denied") throw new Error("An operating location is required.");
  return current;
}

/** Bound IDs must come from server-authorized documents, not client claims.
 * Historical IDs stay historical; the original writer decides their lifecycle. */
export function selectCashierOutletBranch(input: {
  context: CurrentOutletContext;
  appointmentBranchId?: string | null;
  shiftBranchId?: string | null;
  explicitBranchId?: string;
}) {
  const { context, appointmentBranchId, shiftBranchId, explicitBranchId } = input;
  if (context.kind === "denied") throw new Error("Operating location access denied.");
  const bound = appointmentBranchId || shiftBranchId;
  if (appointmentBranchId && shiftBranchId && appointmentBranchId !== shiftBranchId) throw new Error("Appointment and shift branches do not match.");
  if (bound) {
    if (explicitBranchId !== undefined && explicitBranchId !== bound) throw new Error("Selected branch does not match the existing document.");
    return bound;
  }
  if (context.kind === "no_location") throw new Error("An operating location is required.");
  const allowed = context.kind === "single_outlet" ? [context.internalBranchId] : context.branches.map(b => b.id);
  if (explicitBranchId !== undefined) {
    if (!allowed.includes(explicitBranchId)) throw new Error("Branch is outside your authorised scope.");
    return explicitBranchId;
  }
  return context.kind === "single_outlet" ? context.internalBranchId : "";
}
