import type { BusinessIndustry } from "@prisma/client";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export const moduleKeys = [
  "CORE",
  "POS",
  "SALON",
  "AUTO",
  "WHATSAPP",
  "BUSINESS_GROUP",
  "HR",
  "PAYROLL",
  "STATUTORY",
  "CLAIMS",
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
  SALON: definition("SALON", "Salon appointments", "OPERATIONS", [], false, true),
  AUTO: definition("AUTO", "Auto work orders", "OPERATIONS", [], false, true),
  WHATSAPP: definition("WHATSAPP", "WhatsApp", "ADD_ON", [], false, true),
  BUSINESS_GROUP: definition("BUSINESS_GROUP", "Business group", "ADD_ON", [], false, true),
  HR: definition("HR", "HR", "WORKFORCE", [], false, true),
  PAYROLL: definition("PAYROLL", "Payroll", "WORKFORCE", ["HR"], false, true),
  STATUTORY: definition("STATUTORY", "Statutory", "WORKFORCE", ["PAYROLL"], false, true),
  CLAIMS: definition("CLAIMS", "Claims", "WORKFORCE", ["HR"], false, true),
  AI: definition("AI", "AI", "FUTURE", [], false, false),
  LOYALTY: definition("LOYALTY", "Loyalty", "FUTURE", [], false, true),
} as const satisfies Record<ModuleKey, ModuleDefinition>;

const hrCapabilities = new Set<BusinessCapability>([
  "VIEW_ATTENDANCE_EMPLOYEES",
  "VIEW_ATTENDANCE_SETTINGS",
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
  "VIEW_INVENTORY",
  "PROCESS_CASHIER_PAYMENT",
  "PROCESS_REFUND",
  "ADJUST_INVENTORY",
  "RUN_CLOSING",
]);

const claimCapabilities = new Set<BusinessCapability>([
  "VIEW_CLAIM",
  "REVIEW_CLAIM",
  "VERIFY_CLAIM",
  "MANAGE_CLAIM_SETTINGS",
  "LINK_CLAIM_TO_PAYROLL",
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
