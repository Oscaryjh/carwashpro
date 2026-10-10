import type { BusinessOutletTopology } from "@/lib/outlet-context";

/** Safe presentation only; assignment provenance remains scope-filtered. */
export type PeopleWorkplacePresentation = { canSimplify: boolean; updatedAt: string };

export type PeopleWorkplaceAssignment = {
  branchId: string;
  status: "ACTIVE" | "INACTIVE";
  isPrimary: boolean;
  canClockIn: boolean;
  effectiveFrom: Date | string;
  effectiveUntil: Date | string | null;
};
export type PeopleWorkplaceProfile = {
  status: string;
  updatedAt?: Date | string;
  assignments: readonly PeopleWorkplaceAssignment[];
  /** Absent for Employee-only administration; null is an actual POS home value. */
  posHomeBranchId?: string | null;
};

export function canSimplifyPeopleWorkplace(
  topology: BusinessOutletTopology | undefined,
  existing?: PeopleWorkplaceProfile,
  now = new Date(),
) {
  if (topology?.kind !== "single_outlet") return false;
  if (!existing) return true;
  if (existing.status !== "ACTIVE") return false;
  if ("posHomeBranchId" in existing && existing.posHomeBranchId !== topology.internalBranchId) return false;
  const active = existing.assignments.filter(a => a.status === "ACTIVE");
  return active.length === 1 && active[0].branchId === topology.internalBranchId && active[0].isPrimary &&
    new Date(active[0].effectiveFrom) <= now &&
    (!active[0].effectiveUntil || new Date(active[0].effectiveUntil) >= now) &&
    existing.assignments.filter(a => a.status === "INACTIVE").every(a => !a.isPrimary && !a.canClockIn);
}

const locationFields = new Set(["branchId", "branchIds", "primaryBranchId", "posHomeBranchId", "userBranchId",
  "assignmentId", "assignmentIds", "canClockInBranchIds"]);

/** These aliases are not supported by either existing administration form.
 * Reject rather than silently discard crafted IDs. Supported location fields
 * retain their existing parser/service validation. */
export function assertPeopleLocationPayload(formData: FormData) {
  for (const key of ["branchId", "posHomeBranchId", "userBranchId", "assignmentId", "assignmentIds"]) {
    if (formData.has(key)) throw new Error("Unsupported explicit location input. Use the workplace management form.");
  }
}

/** Called only after existing HR capability/person scope checks. Does not grant
 * authority: service validation and transaction authorization still apply. */
export function preparePeopleOutletForm({ formData, topology, allowedBranchIds, existing }: {
  formData: FormData;
  topology: BusinessOutletTopology;
  allowedBranchIds: readonly string[];
  existing?: PeopleWorkplaceProfile;
}) {
  const copy = new FormData();
  assertPeopleLocationPayload(formData);
  formData.forEach((value, key) => copy.append(key, value));
  if (!formData.has("peopleOutletMode")) return { formData: copy, preservedAssignments: undefined };
  if (formData.get("peopleOutletMode") !== "single_outlet" || topology.kind !== "single_outlet" ||
      formData.get("peopleOutletBranchId") !== topology.internalBranchId) {
    throw new Error("Workplace setup changed. Reload this form before saving.");
  }
  if (!allowedBranchIds.includes(topology.internalBranchId)) throw new Error("Workplace is outside your authorized scope.");
  for (const key of formData.keys()) {
    if (locationFields.has(key) || key.startsWith("assignmentEffective")) {
      throw new Error("Explicit location changes require the workplace management form. Reload before saving.");
    }
  }
  if (!canSimplifyPeopleWorkplace(topology, existing)) throw new Error("Workplace records need review. Reload the management form.");
  if (existing?.updatedAt && new Date(String(formData.get("peopleOutletExpectedUpdatedAt") ??
      formData.get("expectedUpdatedAt") ?? "")).getTime() !== new Date(existing.updatedAt).getTime()) {
    throw new Error("Employee was changed by another user. Reload and try again.");
  }
  const clockValue = formData.get("peopleCanClockIn");
  if (clockValue !== null && clockValue !== "on" && clockValue !== "off") throw new Error("Invalid workplace clock-in setting.");
  const current = existing?.assignments.find(a => a.status === "ACTIVE");
  const canClockIn = clockValue === null ? current?.canClockIn ?? false : clockValue === "on";
  copy.append("branchIds", topology.internalBranchId);
  copy.set("primaryBranchId", topology.internalBranchId);
  if (canClockIn) copy.append("canClockInBranchIds", topology.internalBranchId);
  const preservedAssignments = current ? [{ ...current, canClockIn }] : undefined;
  return { formData: copy, preservedAssignments };
}
