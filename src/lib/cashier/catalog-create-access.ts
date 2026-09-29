import type { BusinessIndustry } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { hasStaffPermission, type StaffPermission } from "@/lib/auth/staff-permissions";
import { modulesForStaffPermission, type ModuleKey } from "@/lib/modules/registry";

export type CashierCatalogCreateAccess = {
  service: boolean;
  product: boolean;
  package: boolean;
};

// UI visibility only. The existing create actions remain the authorization boundary.
export function getCashierCatalogCreateAccess(
  user: Pick<AppSession, "role" | "permissions">,
  enabledModules: ReadonlySet<ModuleKey>,
  industryType: BusinessIndustry,
): CashierCatalogCreateAccess {
  const allowed = (permission: StaffPermission) =>
    hasStaffPermission(user, permission) &&
    modulesForStaffPermission(permission, industryType).every((key) => enabledModules.has(key));

  return {
    service: allowed("SERVICES"),
    product: allowed("PRODUCTS"),
    package: allowed("PACKAGES"),
  };
}
