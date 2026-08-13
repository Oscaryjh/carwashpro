import type { BusinessIndustry } from "@prisma/client";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export const moduleKeys = [
  "CORE",
  "POS",
  "INVENTORY",
  "SALON",
  "AUTO",
  "WHATSAPP",
  "BUSINESS_GROUP",
  "HR",
  "PAYROLL",
  "STATUTORY",
  "CLAIMS",
  "COMMISSION",
  "EXPENSE",
  "AI",
  "LOYALTY",
] as const;

export type ModuleKey = (typeof moduleKeys)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  category: "CORE" | "OPERATIONS" | "WORKFORCE" | "ADD_ON" | "FUTURE";
  dependencies: readonly ModuleKey[];
  isCore: boolean;
  operational: boolean;
};

export const MODULE_REGISTRY = {
  CORE: definition("CORE", "Core platform", "CORE", [], true, true),
  POS: definition("POS", "POS", "OPERATIONS", [], false, true),
  INVENTORY: definition("INVENTORY", "Inventory", "OPERATIONS", ["POS"], false, true),
  SALON: definition("SALON", "Salon appointments", "OPERATIONS", [], false, true),
  AUTO: definition("AUTO", "Auto work orders", "OPERATIONS", [], false, true),
  WHATSAPP: definition("WHATSAPP", "WhatsApp", "ADD_ON", [], false, true),
  BUSINESS_GROUP: definition("BUSINESS_GROUP", "Business group", "ADD_ON", [], false, true),
  HR: definition("HR", "HR", "WORKFORCE", [], false, true),
  PAYROLL: definition("PAYROLL", "Payroll", "WORKFORCE", ["HR"], false, true),
  STATUTORY: definition("STATUTORY", "Statutory", "WORKFORCE", ["PAYROLL"], false, true),
  CLAIMS: definition("CLAIMS", "Claims", "WORKFORCE", ["HR"], false, true),
  COMMISSION: definition("COMMISSION", "Commission", "ADD_ON", ["CORE"], false, true),
  EXPENSE: definition("EXPENSE", "Expenses", "OPERATIONS", ["CORE"], false, true),
  AI: definition("AI", "AI Business Analysis", "ADD_ON", [], false, true),
  LOYALTY: definition("LOYALTY", "Loyalty", "FUTURE", [], false, true),
} as const satisfies Record<ModuleKey, ModuleDefinition>;

const hrCapabilities = new Set<BusinessCapability>([
  "VIEW_ATTENDANCE_EMPLOYEES",
  "VIEW_ATTENDANCE_SETTINGS",
  "VIEW_ROSTER",
  "CREATE_ROSTER",
  "EDIT_ROSTER",
  "PUBLISH_ROSTER",
  "AMEND_PUBLISHED_ROSTER",
  "MANAGE_RETROSPECTIVE_ROSTER",
  "VIEW_LEAVE",
  "APPROVE_LEAVE",
  "EDIT_LEAVE_POLICY",
  "ADJUST_LEAVE_BALANCE",
  "MODIFY_ATTENDANCE_EMPLOYEES",
  "MODIFY_ATTENDANCE_SETTINGS",
]);

const payrollCapabilities = new Set<BusinessCapability>([
  "VIEW_PAYROLL",
  "VIEW_COMPENSATION",
  "EDIT_COMPENSATION",
  "VIEW_PAYROLL_RUN",
  "CREATE_PAYROLL_RUN",
  "EDIT_PAYROLL_ENTRY",
  "SUBMIT_PAYROLL_REVIEW",
  "RETURN_PAYROLL_TO_DRAFT",
  "APPROVE_PAYROLL",
  "REOPEN_PAYROLL",
  "EXPORT_PAYROLL",
  "VIEW_PAYSLIP",
  "PUBLISH_PAYSLIP",
  "VIEW_BANK_ACCOUNT",
  "EDIT_BANK_ACCOUNT",
  "VERIFY_BANK_ACCOUNT",
  "VIEW_PAYMENT_BATCH",
  "PROCESS_PAYMENT",
  "CREATE_PAYMENT_BATCH",
  "SUBMIT_PAYMENT_BATCH",
  "APPROVE_PAYMENT_BATCH",
  "EXPORT_PAYMENT_FILE",
  "CANCEL_PAYMENT_BATCH",
  "VIEW_PAYMENT_AUDIT",
  "MODIFY_PAYROLL",
]);

const statutoryCapabilities = new Set<BusinessCapability>([
  "VIEW_STATUTORY_PROFILE",
  "EDIT_STATUTORY_PROFILE",
  "VIEW_TAX_PROFILE",
  "EDIT_TAX_PROFILE",
  "VIEW_STATUTORY_SUBMISSION",
  "EXPORT_STATUTORY",
  "SUBMIT_STATUTORY",
  "RESOLVE_STATUTORY_SUBMISSION",
]);

const posCapabilities = new Set<BusinessCapability>([
  "VIEW_CRM",
  "MODIFY_CRM",
  "VIEW_INVOICES",
  "VIEW_CATALOG",
  "PROCESS_CASHIER_PAYMENT",
  "PROCESS_REFUND",
  "RUN_CLOSING",
]);

const inventoryCapabilities = new Set<BusinessCapability>([
  "VIEW_INVENTORY",
  "MANAGE_INVENTORY",
  "ADJUST_INVENTORY",
  "TRANSFER_INVENTORY",
  "VIEW_SUPPLIERS",
  "MANAGE_SUPPLIERS",
  "VIEW_PURCHASE_ORDERS",
  "CREATE_PURCHASE_ORDER",
  "APPROVE_PURCHASE_ORDER",
  "CANCEL_PURCHASE_ORDER",
  "RECEIVE_PURCHASE_ORDER",
  "REVERSE_GOODS_RECEIPT",
  "VIEW_SUPPLIER_BILL",
  "CREATE_SUPPLIER_BILL",
  "EDIT_SUPPLIER_BILL_DRAFT",
  "CONFIRM_SUPPLIER_BILL",
  "VOID_SUPPLIER_BILL",
  "VIEW_ACCOUNTS_PAYABLE",
  "RECORD_SUPPLIER_PAYMENT",
  "REVERSE_SUPPLIER_PAYMENT",
  "VIEW_SUPPLIER_INVOICE_ATTACHMENT",
  "VIEW_STOCK_COUNTS",
  "CREATE_STOCK_COUNT",
  "COUNT_INVENTORY",
  "SUBMIT_STOCK_COUNT",
  "APPROVE_STOCK_COUNT",
  "REOPEN_STOCK_COUNT",
  "CANCEL_STOCK_COUNT",
  "MANAGE_REORDER_SETTINGS",
]);

const claimCapabilities = new Set<BusinessCapability>([
  "VIEW_CLAIM",
  "REVIEW_CLAIM",
  "VERIFY_CLAIM",
  "MANAGE_CLAIM_SETTINGS",
  "LINK_CLAIM_TO_PAYROLL",
]);

const commissionCapabilities = new Set<BusinessCapability>([
  "VIEW_COMMISSION",
  "MANAGE_COMMISSION_RULES",
  "CALCULATE_COMMISSION",
  "APPROVE_COMMISSION",
  "ADJUST_COMMISSION",
  "LINK_COMMISSION_TO_PAYROLL",
]);

const expenseCapabilities = new Set<BusinessCapability>([
  "VIEW_EXPENSE",
  "CREATE_EXPENSE",
  "EDIT_EXPENSE_DRAFT",
  "CONFIRM_EXPENSE",
  "VOID_EXPENSE",
  "MARK_EXPENSE_PAID",
  "MANAGE_EXPENSE_CATEGORY",
  "VIEW_EXPENSE_RECEIPT",
]);

const aiCapabilities = new Set<BusinessCapability>([
  "VIEW_AI_ANALYSIS",
  "USE_AI_ANALYSIS",
  "VIEW_AI_USAGE",
  "MANAGE_AI_SETTINGS",
]);

export function modulesForCapability(
  capability: BusinessCapability | undefined,
  industryType: BusinessIndustry,
): readonly ModuleKey[] {
  if (!capability) return [];
  if (hrCapabilities.has(capability)) return ["HR"];
  if (payrollCapabilities.has(capability)) return ["PAYROLL"];
  if (statutoryCapabilities.has(capability)) return ["STATUTORY"];
  if (claimCapabilities.has(capability)) return ["CLAIMS"];
  if (commissionCapabilities.has(capability)) return ["COMMISSION"];
  if (expenseCapabilities.has(capability)) return ["EXPENSE"];
  if (aiCapabilities.has(capability)) return ["AI"];
  if (inventoryCapabilities.has(capability)) return ["INVENTORY"];
  if (posCapabilities.has(capability)) return ["POS"];
  if (capability === "MANAGE_WHATSAPP") return ["WHATSAPP"];
  if (capability === "VIEW_APPOINTMENTS" || capability === "MODIFY_APPOINTMENTS") {
    return [industryType === "SALON_BEAUTY" ? "SALON" : "AUTO"];
  }
  if (capability === "VIEW_WORK_ORDERS" || capability === "MODIFY_WORK_ORDERS") {
    return ["POS", "AUTO"];
  }
  return [];
}

export function modulesForStaffPermission(
  permission: string,
  industryType: BusinessIndustry,
): readonly ModuleKey[] {
  if (["ATTENDANCE_EMPLOYEE_READ", "ATTENDANCE_EMPLOYEE_MANAGE", "ATTENDANCE_SETTINGS_READ", "ATTENDANCE_SETTINGS_MANAGE", "ROSTER_VIEW", "ROSTER_CREATE", "ROSTER_EDIT", "ROSTER_PUBLISH", "ROSTER_AMEND", "ROSTER_RETROSPECTIVE", "VIEW_LEAVE", "APPROVE_LEAVE", "EDIT_LEAVE_POLICY", "ADJUST_LEAVE_BALANCE"].includes(permission)) {
    return ["HR"];
  }
  if (["VIEW_CLAIM", "REVIEW_CLAIM", "VERIFY_CLAIM", "MANAGE_CLAIM_SETTINGS", "LINK_CLAIM_TO_PAYROLL"].includes(permission)) {
    return ["CLAIMS"];
  }
  if (["VIEW_COMMISSION", "MANAGE_COMMISSION_RULES", "CALCULATE_COMMISSION", "APPROVE_COMMISSION", "ADJUST_COMMISSION", "LINK_COMMISSION_TO_PAYROLL"].includes(permission)) {
    return ["COMMISSION"];
  }
  if (["EXPENSE_VIEW", "EXPENSE_CREATE", "EXPENSE_EDIT_DRAFT", "EXPENSE_CONFIRM", "EXPENSE_VOID", "EXPENSE_MARK_PAID", "EXPENSE_CATEGORY_MANAGE", "EXPENSE_RECEIPT_VIEW"].includes(permission)) return ["EXPENSE"];
  if (["AI_ANALYSIS_VIEW", "AI_ANALYSIS_USE", "AI_USAGE_VIEW", "AI_SETTINGS_MANAGE"].includes(permission)) return ["AI"];
  if (/^(SUPPLIER_|ACCOUNTS_PAYABLE)/.test(permission)) return ["INVENTORY"];
  if (/(STATUTORY|TAX_PROFILE)/.test(permission)) return ["STATUTORY"];
  if (/(PAYROLL|COMPENSATION|PAYSLIP|BANK_ACCOUNT|PAYMENT)/.test(permission)) return ["PAYROLL"];
  if (permission === "APPOINTMENTS") return ["POS", "SALON"];
  if (permission === "JOBS") return ["POS", "AUTO"];
  if (["CRM", "POS", "INVOICES", "CLOSING", "REPORTS", "SERVICES", "PACKAGES", "PRODUCTS", "DISCOUNTS"].includes(permission)) return ["POS"];
  if (["INVENTORY_VIEW", "INVENTORY_MANAGE", "INVENTORY_ADJUST", "INVENTORY_TRANSFER", "STOCK_COUNTS_VIEW", "STOCK_COUNTS_CREATE", "STOCK_COUNTS_COUNT", "STOCK_COUNTS_APPROVE", "STOCK_COUNTS_CANCEL", "REORDER_SETTINGS_MANAGE", "SUPPLIERS_VIEW", "SUPPLIERS_MANAGE", "PURCHASE_ORDERS_VIEW", "PURCHASE_ORDERS_CREATE", "PURCHASE_ORDERS_APPROVE", "PURCHASE_ORDERS_CANCEL", "PURCHASE_ORDERS_RECEIVE", "GOODS_RECEIPTS_REVERSE", "SUPPLIER_BILLS_VIEW", "SUPPLIER_BILLS_CREATE", "SUPPLIER_BILLS_EDIT_DRAFT", "SUPPLIER_BILLS_CONFIRM", "SUPPLIER_BILLS_VOID", "ACCOUNTS_PAYABLE_VIEW", "SUPPLIER_PAYMENTS_RECORD", "SUPPLIER_PAYMENTS_REVERSE", "SUPPLIER_INVOICE_ATTACHMENT_VIEW"].includes(permission)) return ["INVENTORY"];
  if (["WHATSAPP", "WHATSAPP_SESSION"].includes(permission)) return ["WHATSAPP"];
  if (permission === "LOYALTY") return ["LOYALTY"];
  if (permission === "VIEW_APPOINTMENTS" || permission === "MODIFY_APPOINTMENTS") {
    return [industryType === "SALON_BEAUTY" ? "SALON" : "AUTO"];
  }
  return [];
}

export function moduleDependencies(key: ModuleKey) {
  return MODULE_REGISTRY[key].dependencies;
}

export function moduleDependents(key: ModuleKey) {
  return moduleKeys.filter((candidate) => MODULE_REGISTRY[candidate].dependencies.includes(key));
}

export function defaultModulesForNewBusiness(industryType: BusinessIndustry): ModuleKey[] {
  return ["POS", industryType === "SALON_BEAUTY" ? "SALON" : "AUTO"];
}

function definition(
  key: ModuleKey,
  label: string,
  category: ModuleDefinition["category"],
  dependencies: readonly ModuleKey[],
  isCore: boolean,
  operational: boolean,
): ModuleDefinition {
  return { key, label, category, dependencies, isCore, operational };
}
