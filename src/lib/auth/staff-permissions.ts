import type { AppSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

const payrollCapabilityPermissions = [
  ["VIEW_COMPENSATION", "View compensation"],
  ["EDIT_COMPENSATION", "Edit compensation"],
  ["VIEW_PAYROLL_RUN", "View payroll runs"],
  ["CREATE_PAYROLL_RUN", "Generate payroll runs"],
  ["EDIT_PAYROLL_ENTRY", "Edit payroll entries"],
  ["SUBMIT_PAYROLL_REVIEW", "Submit payroll review"],
  ["RETURN_PAYROLL_TO_DRAFT", "Return payroll to draft"],
  ["APPROVE_PAYROLL", "Approve payroll"],
  ["REOPEN_PAYROLL", "Reopen payroll"],
  ["EXPORT_PAYROLL", "Export payroll"],
  ["VIEW_PAYSLIP", "View employee payslips"],
  ["PUBLISH_PAYSLIP", "Publish employee payslips (not available yet)"],
  ["VIEW_BANK_ACCOUNT", "View masked employee salary bank profiles"],
  ["EDIT_BANK_ACCOUNT", "Add, replace or deactivate employee salary bank profiles"],
  ["VERIFY_BANK_ACCOUNT", "Manually verify employee salary bank profiles"],
  ["VIEW_PAYMENT_BATCH", "View payroll payment batches"],
  ["PROCESS_PAYMENT", "Process payroll payments (not available yet)"],
  ["CREATE_PAYMENT_BATCH", "Create payroll payment batches"],
  ["SUBMIT_PAYMENT_BATCH", "Submit payroll payment batches"],
  ["APPROVE_PAYMENT_BATCH", "Approve payroll payment batches"],
  ["EXPORT_PAYMENT_FILE", "Export bank payment files (not available yet)"],
  ["CANCEL_PAYMENT_BATCH", "Cancel payroll payment batches"],
  ["VIEW_PAYMENT_AUDIT", "View payroll payment audit history"],
  ["VIEW_STATUTORY_PROFILE", "View statutory profiles"],
  ["EDIT_STATUTORY_PROFILE", "Edit statutory profiles"],
  ["VIEW_TAX_PROFILE", "View tax profiles"],
  ["EDIT_TAX_PROFILE", "Edit tax profiles"],
  ["VIEW_STATUTORY_SUBMISSION", "View statutory submissions"],
  ["EXPORT_STATUTORY", "Export statutory files"],
  ["SUBMIT_STATUTORY", "Submit statutory filings"],
  ["RESOLVE_STATUTORY_SUBMISSION", "Resolve statutory submissions"],
] as const;

const claimCapabilityPermissions = [
  ["VIEW_CLAIM", "View employee claims"],
  ["REVIEW_CLAIM", "Review employee claims"],
  ["VERIFY_CLAIM", "Verify employee claims as Finance"],
  ["MANAGE_CLAIM_SETTINGS", "Manage claim categories and policy (not available yet)"],
  ["LINK_CLAIM_TO_PAYROLL", "Schedule verified claims for payroll (not available yet)"],
] as const;

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
    description: "Search, create, and update customer records.",
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
    description: "Schedule visits and manage appointment details.",
  },
  {
    key: "POS",
    label: "Cashier",
    description: "Collect payments, complete checkout, and use packages.",
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
    key: "MANAGE_TEAM_PERMISSIONS",
    label: "Manage roles & permissions",
    description:
      "Create roles and grant only permissions already held by the administrator.",
  },
  {
    key: "ATTENDANCE_EMPLOYEE_READ",
    label: "View attendance employees",
    description: "View employee profiles and branch attendance assignments.",
  },
  {
    key: "ATTENDANCE_EMPLOYEE_MANAGE",
    label: "Manage attendance employees",
    description: "Create and update employee profiles and branch attendance assignments.",
  },
  {
    key: "ATTENDANCE_SETTINGS_READ",
    label: "View attendance settings",
    description: "View branch attendance and geofence settings.",
  },
  {
    key: "ATTENDANCE_SETTINGS_MANAGE",
    label: "Manage attendance settings",
    description: "Update branch attendance and geofence settings.",
  },
  ...claimCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description:
      "Sensitive claim capability. Grant only for the required business function.",
  })),
  {
    key: "PAYROLL_READ",
    label: "View payroll",
    description: "View company payroll runs and employee pay details.",
  },
  {
    key: "PAYROLL_MANAGE",
    label: "Manage payroll",
    description: "Generate, adjust and finalize company payroll runs.",
  },
  ...payrollCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description:
      "Sensitive payroll capability. Grant only for the required business function.",
  })),
  {
    key: "DELETE_STAFF",
    label: "Delete staff",
    description: "Delete staff accounts that do not have cashier or payment history.",
  },
  {
    key: "REPORTS",
    label: "Reports",
    description: "View sales, invoice, payment, and operational reports.",
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
  {
    key: "DISCOUNTS",
    label: "Discounts",
    description: "Create and manage reusable catalog discount rules.",
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

export function getStaffPermissionsForIndustry(industryType: string | null | undefined) {
  return industryType === "SALON_BEAUTY"
    ? staffPermissions.filter((permission) => permission.key !== "JOBS")
    : staffPermissions;
}

export function getDefaultStaffPermissionsForIndustry(
  industryType: string | null | undefined,
): StaffPermission[] {
  const available = new Set(
    getStaffPermissionsForIndustry(industryType).map((permission) => permission.key),
  );

  return defaultStaffPermissions.filter((permission) => available.has(permission));
}

const permissionSet = new Set<string>(
  staffPermissions.map((permission) => permission.key),
);

const impliedStaffPermissions: Partial<
  Record<StaffPermission, readonly StaffPermission[]>
> = {
  ATTENDANCE_EMPLOYEE_MANAGE: ["ATTENDANCE_EMPLOYEE_READ"],
  ATTENDANCE_SETTINGS_MANAGE: ["ATTENDANCE_SETTINGS_READ"],
  REVIEW_CLAIM: ["VIEW_CLAIM"],
  VERIFY_CLAIM: ["VIEW_CLAIM"],
  MANAGE_CLAIM_SETTINGS: ["VIEW_CLAIM"],
  LINK_CLAIM_TO_PAYROLL: ["VIEW_CLAIM", "VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  PAYROLL_MANAGE: ["PAYROLL_READ"],
  EDIT_COMPENSATION: ["VIEW_COMPENSATION", "PAYROLL_READ"],
  VIEW_COMPENSATION: ["PAYROLL_READ"],
  VIEW_PAYROLL_RUN: ["PAYROLL_READ"],
  CREATE_PAYROLL_RUN: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  EDIT_PAYROLL_ENTRY: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  SUBMIT_PAYROLL_REVIEW: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  RETURN_PAYROLL_TO_DRAFT: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  APPROVE_PAYROLL: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  REOPEN_PAYROLL: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  EXPORT_PAYROLL: ["VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  VIEW_PAYSLIP: ["PAYROLL_READ"],
  PUBLISH_PAYSLIP: ["VIEW_PAYSLIP", "PAYROLL_READ"],
  VIEW_BANK_ACCOUNT: ["PAYROLL_READ"],
  EDIT_BANK_ACCOUNT: ["VIEW_BANK_ACCOUNT", "PAYROLL_READ"],
  VERIFY_BANK_ACCOUNT: ["VIEW_BANK_ACCOUNT", "PAYROLL_READ"],
  VIEW_PAYMENT_BATCH: ["PAYROLL_READ"],
  PROCESS_PAYMENT: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  CREATE_PAYMENT_BATCH: ["VIEW_PAYMENT_BATCH", "VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  SUBMIT_PAYMENT_BATCH: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  APPROVE_PAYMENT_BATCH: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  EXPORT_PAYMENT_FILE: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  CANCEL_PAYMENT_BATCH: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  VIEW_PAYMENT_AUDIT: ["VIEW_PAYMENT_BATCH", "PAYROLL_READ"],
  VIEW_STATUTORY_PROFILE: ["PAYROLL_READ"],
  EDIT_STATUTORY_PROFILE: ["VIEW_STATUTORY_PROFILE", "PAYROLL_READ"],
  VIEW_TAX_PROFILE: ["PAYROLL_READ"],
  EDIT_TAX_PROFILE: ["VIEW_TAX_PROFILE", "PAYROLL_READ"],
  VIEW_STATUTORY_SUBMISSION: ["PAYROLL_READ"],
  EXPORT_STATUTORY: ["VIEW_STATUTORY_SUBMISSION", "PAYROLL_READ"],
  SUBMIT_STATUTORY: ["VIEW_STATUTORY_SUBMISSION", "PAYROLL_READ"],
  RESOLVE_STATUTORY_SUBMISSION: ["VIEW_STATUTORY_SUBMISSION", "PAYROLL_READ"],
};

export function normalizeStaffPermissions(values: unknown[]): StaffPermission[] {
  const unique = new Set<StaffPermission>();

  values.forEach((value) => {
    if (typeof value === "string" && permissionSet.has(value)) {
      const permission = value as StaffPermission;
      impliedStaffPermissions[permission]?.forEach((impliedPermission) => {
        unique.add(impliedPermission);
      });
      unique.add(permission);
    }
  });

  return Array.from(unique);
}

export function normalizeStaffPermissionsForIndustry(
  values: unknown[],
  industryType: string | null | undefined,
): StaffPermission[] {
  const available = new Set(
    getStaffPermissionsForIndustry(industryType).map((permission) => permission.key),
  );

  return normalizeStaffPermissions(values).filter((permission) => available.has(permission));
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
  ["DISCOUNTS", "/discounts"],
  ["TEAM", "/team"],
  ["ATTENDANCE_EMPLOYEE_READ", "/team/employees"],
  ["ATTENDANCE_SETTINGS_READ", "/team/attendance-settings"],
  ["PAYROLL_READ", "/team/payroll/workspace"],
];

export function getStaffHomePath(
  permissions: unknown,
  industryType?: string | null,
): string {
  const values = Array.isArray(permissions) ? permissions : [];
  const permissionValues = new Set(values.filter((value): value is string => typeof value === "string"));
  const routes = industryType === "SALON_BEAUTY"
    ? staffHomeRoutes.filter(([permission]) => permission !== "JOBS")
    : staffHomeRoutes;

  return (
    routes.find(([permission]) => permissionValues.has(permission))?.[1] ??
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

  if (
    pathname === "/team/employees" ||
    pathname.startsWith("/team/employees/")
  ) {
    return "ATTENDANCE_EMPLOYEE_READ";
  }

  if (
    pathname === "/team/attendance-settings" ||
    pathname.startsWith("/team/attendance-settings/")
  ) {
    return "ATTENDANCE_SETTINGS_READ";
  }
  // These read-only payroll surfaces render their own capability-aware denied
  // state before any payroll query. Let authenticated users reach that boundary
  // so a direct URL does not silently redirect them to an unrelated module.
  if (
    pathname === "/team/payroll/workspace" ||
    pathname === "/team/payroll/runs" ||
    pathname.startsWith("/team/payroll/runs/")
  ) {
    return null;
  }

  if (
    pathname === "/team/payroll" ||
    pathname.startsWith("/team/payroll/")
  ) {
    return "PAYROLL_READ";
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

  if (pathname === "/discounts" || pathname.startsWith("/discounts/")) {
    return "DISCOUNTS";
  }

  if (pathname === "/branches" || pathname.startsWith("/branches/")) {
    return "OWNER_ONLY";
  }

  if (pathname === "/business/settings") {
    return "OWNER_ONLY";
  }

  return null;
}
