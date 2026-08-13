import type { ResolvedBusinessAccess } from "@/lib/business-groups/business-access";
import { modulesForStaffPermission, type ModuleKey } from "@/lib/modules/registry";

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

export function assertStaffPermissionsEntitled(
  requestedPermissions: readonly string[],
  enabledModules: ReadonlySet<ModuleKey>,
  industryType: BusinessIndustry,
) {
  const unavailable = requestedPermissions.filter((permission) =>
    modulesForStaffPermission(permission, industryType).some(
      (moduleKey) => !enabledModules.has(moduleKey),
    ),
  );
  if (unavailable.length) {
    throw new Error(
      `Permissions require disabled business modules: ${unavailable.join(", ")}.`,
    );
  }
}
import type { BusinessIndustry } from "@prisma/client";
