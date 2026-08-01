import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";

export function assertCanGrantStaffPermissions(
  access: ResolvedBusinessAccess,
  requestedPermissions: readonly string[],
) {
  if (!access.granted) {
    throw new Error("Business access is required.");
  }

  if (
    access.source === "PLATFORM_ADMIN" ||
    access.effectiveBusinessRole === "BUSINESS_OWNER" ||
    (access.source === "GROUP_ACCESS" && access.actorRole === "GROUP_OWNER")
  ) {
    return;
  }

  const actorPermissions = new Set(access.permissions);
  if (
    requestedPermissions.some(
      (permission) => !actorPermissions.has(permission),
    )
  ) {
    throw new Error("You cannot grant staff permissions that you do not hold.");
  }
}
