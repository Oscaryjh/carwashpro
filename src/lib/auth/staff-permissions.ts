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
  ["PUBLISH_PAYSLIP", "Publish finalized employee payslips"],
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
  ["MANAGE_CLAIM_SETTINGS", "Manage claim categories and reimbursement policies"],
  ["LINK_CLAIM_TO_PAYROLL", "Add approved reimbursements to eligible payroll drafts"],
] as const;

const commissionCapabilityPermissions = [
  ["VIEW_COMMISSION", "View commission statements"],
  ["MANAGE_COMMISSION_RULES", "Manage commission rules"],
  ["CALCULATE_COMMISSION", "Calculate commission periods"],
  ["APPROVE_COMMISSION", "Approve and lock commission periods"],
  ["ADJUST_COMMISSION", "Create audited future commission corrections"],
  ["LINK_COMMISSION_TO_PAYROLL", "Link approved commission to payroll"],
] as const;

const expenseCapabilityPermissions = [
  ["EXPENSE_VIEW", "View business expenses"],
  ["EXPENSE_CREATE", "Create business expenses"],
  ["EXPENSE_EDIT_DRAFT", "Edit draft business expenses"],
  ["EXPENSE_CONFIRM", "Confirm business expenses"],
  ["EXPENSE_VOID", "Void unpaid confirmed expenses"],
  ["EXPENSE_MARK_PAID", "Mark confirmed expenses paid"],
  ["EXPENSE_CATEGORY_MANAGE", "Manage expense categories and recurring templates"],
  ["EXPENSE_RECEIPT_VIEW", "View authorised expense receipts"],
] as const;

const supplierApCapabilityPermissions = [
  ["SUPPLIER_BILLS_VIEW", "View supplier bills"],
  ["SUPPLIER_BILLS_CREATE", "Create supplier bill drafts"],
  ["SUPPLIER_BILLS_EDIT_DRAFT", "Edit supplier bill drafts"],
  ["SUPPLIER_BILLS_CONFIRM", "Confirm supplier bills"],
  ["SUPPLIER_BILLS_VOID", "Void unpaid confirmed supplier bills"],
  ["ACCOUNTS_PAYABLE_VIEW", "View accounts payable"],
  ["SUPPLIER_PAYMENTS_RECORD", "Record supplier payments"],
  ["SUPPLIER_PAYMENTS_REVERSE", "Reverse supplier payments"],
  ["SUPPLIER_INVOICE_ATTACHMENT_VIEW", "View supplier invoice attachments"],
] as const;

const aiCapabilityPermissions = [
  ["AI_ANALYSIS_VIEW", "View AI business analysis"],
  ["AI_ANALYSIS_USE", "Ask Tetamu AI for read-only analysis"],
  ["AI_USAGE_VIEW", "View AI request and token usage"],
  ["AI_SETTINGS_MANAGE", "Manage AI provider settings"],
] as const;

export const staffPermissions = [
  {
    key: "DASHBOARD",
    label: "Dashboard",
    description: "View daily overview for assigned access.",
  },
  ...aiCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description: "Read-only AI analysis capability. It never grants business mutation access.",
  })),
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
  {
    key: "ROSTER_VIEW",
    label: "View roster",
    description: "View published and authorised draft rosters within assigned branches.",
  },
  {
    key: "ROSTER_CREATE",
    label: "Create roster",
    description: "Create weekly draft rosters within assigned branches.",
  },
  {
    key: "ROSTER_EDIT",
    label: "Edit roster drafts",
    description: "Edit draft shift, rest-day and not-scheduled assignments.",
  },
  {
    key: "ROSTER_PUBLISH",
    label: "Publish roster",
    description: "Publish a versioned roster revision that becomes Attendance evidence.",
  },
  {
    key: "ROSTER_AMEND",
    label: "Amend published roster",
    description: "Prepare and publish a new future revision of an existing roster.",
  },
  {
    key: "ROSTER_RETROSPECTIVE",
    label: "Manage retrospective roster",
    description: "Record a reasoned retrospective roster revision without manufacturing no-show evidence.",
  },
  {
    key: "VIEW_LEAVE",
    label: "View employee leave",
    description: "View leave balances, applications and approval history within assigned branches.",
  },
  {
    key: "APPROVE_LEAVE",
    label: "Approve or reject leave",
    description: "Approve, reject or cancel leave without changing its type or pay treatment.",
  },
  {
    key: "EDIT_LEAVE_POLICY",
    label: "Edit leave policy",
    description: "Create effective-dated company leave policy revisions.",
  },
  {
    key: "ADJUST_LEAVE_BALANCE",
    label: "Adjust leave balance",
    description: "Append a reasoned immutable leave balance adjustment.",
  },
  ...claimCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description:
      "Sensitive claim capability. Grant only for the required business function.",
  })),
  ...commissionCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description:
      "Sensitive commission capability. Grant only for the required business function.",
  })),
  ...expenseCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description: "Sensitive business-spending capability. Grant only for the required branch or business function.",
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
    description: "Create and update the retail product catalog.",
  },
  {
    key: "INVENTORY_VIEW",
    label: "View inventory",
    description: "View branch balances, low stock, and the immutable movement ledger.",
  },
  {
    key: "INVENTORY_MANAGE",
    label: "Stock in / out",
    description: "Record reasoned stock receipts and stock-outs for assigned branches.",
  },
  {
    key: "INVENTORY_ADJUST",
    label: "Adjust inventory",
    description: "Create audited delta corrections without overwriting stock history.",
  },
  {
    key: "INVENTORY_TRANSFER",
    label: "Transfer inventory",
    description: "Move tracked stock atomically between authorised branches.",
  },
  {
    key: "STOCK_COUNTS_VIEW",
    label: "View stock counts",
    description: "View branch physical-count sessions and frozen variance evidence.",
  },
  {
    key: "STOCK_COUNTS_CREATE",
    label: "Create stock counts",
    description: "Create full-branch or selected-product count sessions.",
  },
  {
    key: "STOCK_COUNTS_COUNT",
    label: "Count inventory",
    description: "Record physical quantities and submit completed count sessions.",
  },
  {
    key: "STOCK_COUNTS_APPROVE",
    label: "Approve stock counts",
    description: "Review, reopen, and approve variance adjustments counted by another user.",
  },
  {
    key: "STOCK_COUNTS_CANCEL",
    label: "Cancel stock counts",
    description: "Cancel an unapproved count session with an audited reason.",
  },
  {
    key: "REORDER_SETTINGS_MANAGE",
    label: "Manage reorder settings",
    description: "Set branch-specific reorder and target stock levels.",
  },
  {
    key: "SUPPLIERS_VIEW",
    label: "View suppliers",
    description: "View business supplier records and purchasing history.",
  },
  {
    key: "SUPPLIERS_MANAGE",
    label: "Manage suppliers",
    description: "Create, update, activate, and deactivate suppliers.",
  },
  {
    key: "PURCHASE_ORDERS_VIEW",
    label: "View purchase orders",
    description: "View purchase orders and immutable goods receipts.",
  },
  {
    key: "PURCHASE_ORDERS_CREATE",
    label: "Create purchase orders",
    description: "Create and edit draft purchase orders.",
  },
  {
    key: "PURCHASE_ORDERS_APPROVE",
    label: "Approve purchase orders",
    description: "Approve another user's draft purchase order without changing stock.",
  },
  {
    key: "PURCHASE_ORDERS_CANCEL",
    label: "Cancel or close purchase orders",
    description: "Cancel unreceived orders or close their remaining quantity with a reason.",
  },
  {
    key: "PURCHASE_ORDERS_RECEIVE",
    label: "Receive purchase orders",
    description: "Post partial or full goods receipts into the inventory ledger.",
  },
  {
    key: "GOODS_RECEIPTS_REVERSE",
    label: "Reverse goods receipts",
    description: "Create reasoned receipt reversals without modifying the original receipt.",
  },
  ...supplierApCapabilityPermissions.map(([key, label]) => ({
    key,
    label,
    description: "Sensitive supplier accounts-payable capability. Grant only for the required branch or business function.",
  })),
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
  APPROVE_LEAVE: ["VIEW_LEAVE"],
  EDIT_LEAVE_POLICY: ["VIEW_LEAVE"],
  ADJUST_LEAVE_BALANCE: ["VIEW_LEAVE"],
  REVIEW_CLAIM: ["VIEW_CLAIM"],
  VERIFY_CLAIM: ["VIEW_CLAIM"],
  MANAGE_CLAIM_SETTINGS: ["VIEW_CLAIM"],
  LINK_CLAIM_TO_PAYROLL: ["VIEW_CLAIM", "VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  MANAGE_COMMISSION_RULES: ["VIEW_COMMISSION"],
  CALCULATE_COMMISSION: ["VIEW_COMMISSION"],
  APPROVE_COMMISSION: ["VIEW_COMMISSION"],
  ADJUST_COMMISSION: ["VIEW_COMMISSION"],
  LINK_COMMISSION_TO_PAYROLL: ["VIEW_COMMISSION", "VIEW_PAYROLL_RUN", "PAYROLL_READ"],
  EXPENSE_CREATE: ["EXPENSE_VIEW"],
  EXPENSE_EDIT_DRAFT: ["EXPENSE_VIEW"],
  EXPENSE_CONFIRM: ["EXPENSE_VIEW"],
  EXPENSE_VOID: ["EXPENSE_VIEW"],
  EXPENSE_MARK_PAID: ["EXPENSE_VIEW"],
  EXPENSE_CATEGORY_MANAGE: ["EXPENSE_VIEW"],
  EXPENSE_RECEIPT_VIEW: ["EXPENSE_VIEW"],
  SUPPLIER_BILLS_CREATE: ["SUPPLIER_BILLS_VIEW"],
  SUPPLIER_BILLS_EDIT_DRAFT: ["SUPPLIER_BILLS_VIEW"],
  SUPPLIER_BILLS_CONFIRM: ["SUPPLIER_BILLS_VIEW"],
  SUPPLIER_BILLS_VOID: ["SUPPLIER_BILLS_VIEW"],
  SUPPLIER_PAYMENTS_RECORD: ["ACCOUNTS_PAYABLE_VIEW", "SUPPLIER_BILLS_VIEW"],
  SUPPLIER_PAYMENTS_REVERSE: ["ACCOUNTS_PAYABLE_VIEW", "SUPPLIER_BILLS_VIEW"],
  SUPPLIER_INVOICE_ATTACHMENT_VIEW: ["SUPPLIER_BILLS_VIEW"],
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
  ["AI_ANALYSIS_VIEW", "/ai"],
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
  ["VIEW_LEAVE", "/team/leave"],
  ["PAYROLL_READ", "/team/payroll/workspace"],
  ["VIEW_CLAIM", "/team/claims"],
  ["VIEW_COMMISSION", "/team/commission"],
  ["EXPENSE_VIEW", "/expenses"],
  ["ACCOUNTS_PAYABLE_VIEW", "/inventory/accounts-payable"],
  ["SUPPLIER_BILLS_VIEW", "/inventory/supplier-bills"],
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
  if (pathname === "/ai" || pathname.startsWith("/ai/")) {
    return "AI_ANALYSIS_VIEW";
  }
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
    pathname === "/team/attendance" ||
    pathname.startsWith("/team/attendance/")
  ) {
    return "ATTENDANCE_EMPLOYEE_READ";
  }

  if (
    pathname === "/team/attendance-settings" ||
    pathname.startsWith("/team/attendance-settings/")
  ) {
    return "ATTENDANCE_SETTINGS_READ";
  }
  if (pathname === "/team/roster" || pathname.startsWith("/team/roster/")) {
    return "ROSTER_VIEW";
  }
  if (pathname === "/team/approvals" || pathname.startsWith("/team/approvals/")) {
    // The page requires HR plus at least one actionable domain capability.
    // No single legacy staff permission represents this aggregated route.
    return null;
  }
  if (pathname === "/team/claims" || pathname.startsWith("/team/claims/")) {
    return "VIEW_CLAIM";
  }
  if (pathname === "/team/commission" || pathname.startsWith("/team/commission/")) {
    return "VIEW_COMMISSION";
  }
  if (pathname === "/expenses" || pathname.startsWith("/expenses/")) {
    return "EXPENSE_VIEW";
  }
  if (pathname === "/inventory/accounts-payable" || pathname.startsWith("/inventory/accounts-payable/")) {
    return "ACCOUNTS_PAYABLE_VIEW";
  }
  if (pathname === "/inventory/supplier-bills" || pathname.startsWith("/inventory/supplier-bills/")) {
    return "SUPPLIER_BILLS_VIEW";
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
