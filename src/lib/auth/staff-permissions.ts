import type { AppSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const staffPermissions = [
  {
    key: "DASHBOARD",
    label: "Dashboard",
    description: "View daily overview for assigned access.",
  },
  {
    key: "ALL_BRANCHES",
    label: "All branch access",
    description: "View all branches and switch branch filters in Reports.",
  },
  {
    key: "CRM",
    label: "CRM",
    description: "Search, create, and update customers and vehicles.",
  },
  {
    key: "DELETE_CUSTOMER",
    label: "Delete customer",
    description: "Delete customer records that do not have protected history.",
  },
  {
    key: "LOYALTY",
    label: "Membership",
    description: "View members, point balances, and loyalty activity.",
  },
  {
    key: "JOBS",
    label: "Jobs",
    description: "Create jobs, update status, and manage pickup flow.",
  },
  {
    key: "APPOINTMENTS",
    label: "Appointments",
    description: "Schedule visits, confirm arrivals, and convert appointments to jobs.",
  },
  {
    key: "POS",
    label: "POS",
    description: "Checkout jobs, collect payments, and use packages.",
  },
  {
    key: "INVOICES",
    label: "Invoices",
    description: "View invoices, PDFs, and payment records.",
  },
  {
    key: "CLOSING",
    label: "Shift Closing",
    description: "Start/end cashier shifts and view shift totals.",
  },
  {
    key: "WHATSAPP",
    label: "WhatsApp Inbox",
    description: "Use Inbox, message logs, and customer chats.",
  },
  {
    key: "WHATSAPP_SESSION",
    label: "Manage WhatsApp session",
    description: "Reconnect, disconnect, and manage the linked WhatsApp session.",
  },
  {
    key: "TEAM",
    label: "Team & Permissions",
    description: "Create staff accounts and manage staff permissions.",
  },
  {
    key: "DELETE_STAFF",
    label: "Delete staff",
    description: "Delete staff accounts that do not have cashier or payment history.",
  },
  {
    key: "REPORTS",
    label: "Reports",
    description: "View sales, job, invoice, and payment reports.",
  },
  {
    key: "SERVICES",
    label: "Services",
    description: "Create and update service items and categories.",
  },
  {
    key: "PACKAGES",
    label: "Packages",
    description: "Create and update package plans and categories.",
  },
  {
    key: "PRODUCTS",
    label: "Products",
    description: "Create and update retail products and branch stock.",
  },
] as const;

export type StaffPermission = (typeof staffPermissions)[number]["key"];

export const defaultStaffPermissions: StaffPermission[] = [
  "CRM",
  "JOBS",
  "APPOINTMENTS",
  "POS",
  "INVOICES",
  "CLOSING",
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

export function assertStaffPermission(
  user: Pick<AppSession, "role" | "permissions">,
  permission: StaffPermission,
) {
  if (!hasStaffPermission(user, permission)) {
    redirect(getStaffHomePath(user.permissions));
  }
}

const staffHomeRoutes: Array<[StaffPermission, string]> = [
  ["JOBS", "/work-orders"],
  ["APPOINTMENTS", "/appointments"],
  ["CRM", "/crm"],
  ["POS", "/cashier"],
  ["INVOICES", "/invoices"],
  ["CLOSING", "/closing"],
  ["WHATSAPP", "/whatsapp/inbox"],
  ["LOYALTY", "/loyalty"],
  ["REPORTS", "/reports"],
  ["SERVICES", "/services"],
  ["PACKAGES", "/packages"],
  ["PRODUCTS", "/products"],
  ["TEAM", "/team"],
];

export function getStaffHomePath(permissions: unknown): string {
  const values = Array.isArray(permissions) ? permissions : [];
  const permissionValues = new Set(values.filter((value): value is string => typeof value === "string"));

  return (
    staffHomeRoutes.find(([permission]) => permissionValues.has(permission))?.[1] ??
    "/login"
  );
}

export function routePermission(pathname: string): StaffPermission | "OWNER_ONLY" | null {
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    return "DASHBOARD";
  }

  if (pathname === "/crm" || pathname.startsWith("/crm/")) {
    return "CRM";
  }

  if (pathname === "/loyalty" || pathname.startsWith("/loyalty/")) {
    return "LOYALTY";
  }

  if (pathname === "/work-orders" || pathname.startsWith("/work-orders/")) {
    return "JOBS";
  }

  if (pathname === "/appointments" || pathname.startsWith("/appointments/")) {
    return "APPOINTMENTS";
  }

  if (pathname === "/pos" || pathname.startsWith("/pos/")) {
    return "POS";
  }

  if (pathname === "/cashier" || pathname.startsWith("/cashier/")) {
    return "POS";
  }

  if (pathname === "/invoices" || pathname.startsWith("/invoices/")) {
    return "INVOICES";
  }

  if (pathname === "/closing" || pathname.startsWith("/closing/")) {
    return "CLOSING";
  }

  if (
    pathname === "/whatsapp/settings" ||
    pathname.startsWith("/whatsapp/settings/") ||
    pathname === "/whatsapp/diagnostics" ||
    pathname.startsWith("/whatsapp/diagnostics/") ||
    pathname === "/whatsapp/contact-diagnostics" ||
    pathname.startsWith("/whatsapp/contact-diagnostics/") ||
    pathname === "/whatsapp/queue" ||
    pathname.startsWith("/whatsapp/queue/")
  ) {
    return "WHATSAPP_SESSION";
  }

  if (pathname === "/whatsapp" || pathname.startsWith("/whatsapp/")) {
    return "WHATSAPP";
  }

  if (pathname === "/team" || pathname.startsWith("/team/")) {
    return "TEAM";
  }

  if (pathname === "/reports" || pathname.startsWith("/reports/")) {
    return "REPORTS";
  }

  if (pathname === "/services" || pathname.startsWith("/services/")) {
    return "SERVICES";
  }

  if (pathname === "/packages" || pathname.startsWith("/packages/")) {
    return "PACKAGES";
  }

  if (pathname === "/products" || pathname.startsWith("/products/")) {
    return "PRODUCTS";
  }

  if (pathname === "/branches" || pathname.startsWith("/branches/")) {
    return "OWNER_ONLY";
  }

  if (pathname === "/business/settings") {
    return "OWNER_ONLY";
  }

  return null;
}
