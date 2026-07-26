export const businessCapabilities = [
  "VIEW_DASHBOARD",
  "VIEW_REPORTS",
  "VIEW_APPOINTMENTS",
  "VIEW_WORK_ORDERS",
  "VIEW_CRM",
  "VIEW_INVOICES",
  "VIEW_CATALOG",
  "VIEW_INVENTORY",
  "VIEW_TEAM_DIRECTORY",
  "PROCESS_CASHIER_PAYMENT",
  "PROCESS_REFUND",
  "ADJUST_INVENTORY",
  "RUN_CLOSING",
  "MODIFY_TEAM",
  "MANAGE_WHATSAPP",
  "MODIFY_BUSINESS_SETTINGS",
] as const;

export type BusinessCapability = (typeof businessCapabilities)[number];

const groupManagerCapabilities = new Set<BusinessCapability>([
  "VIEW_DASHBOARD",
  "VIEW_REPORTS",
  "VIEW_APPOINTMENTS",
  "VIEW_WORK_ORDERS",
  "VIEW_CRM",
  "VIEW_INVOICES",
  "VIEW_CATALOG",
  "VIEW_INVENTORY",
  "VIEW_TEAM_DIRECTORY",
]);

export function isReadCapability(capability: BusinessCapability) {
  return capability.startsWith("VIEW_");
}

export function canGroupManager(
  capability: BusinessCapability,
) {
  return groupManagerCapabilities.has(capability);
}

export function canGroupOwner(capability: BusinessCapability) {
  return businessCapabilities.includes(capability);
}

const directStaffPermissionMap: Record<BusinessCapability, readonly string[]> = {
  VIEW_DASHBOARD: ["DASHBOARD"],
  VIEW_REPORTS: ["REPORTS"],
  VIEW_APPOINTMENTS: ["APPOINTMENTS"],
  VIEW_WORK_ORDERS: ["JOBS"],
  VIEW_CRM: ["CRM"],
  VIEW_INVOICES: ["INVOICES"],
  VIEW_CATALOG: ["SERVICES", "PACKAGES", "PRODUCTS", "DISCOUNTS"],
  VIEW_INVENTORY: ["PRODUCTS"],
  VIEW_TEAM_DIRECTORY: ["TEAM"],
  PROCESS_CASHIER_PAYMENT: ["POS", "JOBS"],
  PROCESS_REFUND: ["INVOICES"],
  ADJUST_INVENTORY: ["PRODUCTS"],
  RUN_CLOSING: ["CLOSING"],
  MODIFY_TEAM: ["TEAM"],
  MANAGE_WHATSAPP: ["WHATSAPP_SESSION"],
  MODIFY_BUSINESS_SETTINGS: [],
};

export function canDirectStaff(
  permissions: readonly string[],
  capability: BusinessCapability,
) {
  const acceptedPermissions = directStaffPermissionMap[capability];
  return acceptedPermissions.some((permission) =>
    permissions.includes(permission),
  );
}
