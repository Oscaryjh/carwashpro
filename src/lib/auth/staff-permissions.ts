import type { AppSession } from "@/lib/auth/session";

export const staffPermissions = [
  {
    key: "DASHBOARD",
    label: "Dashboard",
    description: "View daily business overview.",
  },
  {
    key: "CRM",
    label: "CRM",
    description: "Search, create, and edit customers and vehicles.",
  },
  {
    key: "JOBS",
    label: "Jobs",
    description: "Create jobs and update job status.",
  },
  {
    key: "POS",
    label: "POS",
    description: "Collect payments and use prepaid packages.",
  },
  {
    key: "INVOICES",
    label: "Invoices",
    description: "View invoices and payment records.",
  },
  {
    key: "WHATSAPP",
    label: "WhatsApp",
    description: "Use WhatsApp inbox, manual links, and message logs.",
  },
] as const;

export type StaffPermission = (typeof staffPermissions)[number]["key"];

export const defaultStaffPermissions: StaffPermission[] = [
  "DASHBOARD",
  "CRM",
  "JOBS",
  "POS",
  "INVOICES",
  "WHATSAPP",
];

const permissionSet = new Set<string>(
  staffPermissions.map((permission) => permission.key),
);

export function normalizeStaffPermissions(values: unknown[]): StaffPermission[] {
  const unique = new Set<StaffPermission>();

  values.forEach((value) => {
    if (typeof value === "string" && permissionSet.has(value)) {
      unique.add(value as StaffPermission);
    }
  });

  return Array.from(unique);
}

export function hasStaffPermission(
  user: Pick<AppSession, "role" | "permissions">,
  permission: StaffPermission,
) {
  if (user.role === "BUSINESS_OWNER") {
    return true;
  }

  if (user.role !== "STAFF") {
    return false;
  }

  return Array.isArray(user.permissions) && user.permissions.includes(permission);
}

export function routePermission(pathname: string): StaffPermission | "OWNER_ONLY" | null {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "DASHBOARD";
  }

  if (pathname === "/crm" || pathname.startsWith("/crm/")) {
    return "CRM";
  }

  if (pathname === "/work-orders" || pathname.startsWith("/work-orders/")) {
    return "JOBS";
  }

  if (pathname === "/pos" || pathname.startsWith("/pos/")) {
    return "POS";
  }

  if (pathname === "/invoices" || pathname.startsWith("/invoices/")) {
    return "INVOICES";
  }

  if (pathname === "/whatsapp" || pathname.startsWith("/whatsapp/")) {
    return "WHATSAPP";
  }

  if (
    pathname === "/reports" ||
    pathname.startsWith("/reports/") ||
    pathname === "/services" ||
    pathname.startsWith("/services/") ||
    pathname === "/packages" ||
    pathname.startsWith("/packages/") ||
    pathname === "/branches" ||
    pathname.startsWith("/branches/") ||
    pathname === "/business/settings" ||
    pathname.startsWith("/team")
  ) {
    return "OWNER_ONLY";
  }

  return null;
}
