export const SENSITIVE_ACTION_KEYS = [
  "STATUTORY_RULESET_SIGNOFF",
  "STATUTORY_RULESET_ACTIVATE",
  "PAYROLL_FINALIZE",
  "PAYROLL_REOPEN",
  "PAYMENT_FILE_EXPORT",
  "STATUTORY_EXPORT",
  "STATUTORY_SUBMIT",
  "BANK_ACCOUNT_EDIT",
  "PAYROLL_PAYMENT_PROCESS",
  "HIGH_RISK_PERMISSION_CHANGE",
  "QA_SENSITIVE_ACTION",
  "SUPPLIER_PAYMENT_RECORD",
  "SUPPLIER_PAYMENT_REVERSE",
  "SUBSCRIPTION_PAYMENT_RECORD",
  "SUBSCRIPTION_PAYMENT_REVERSE",
  "SUBSCRIPTION_INVOICE_VOID",
] as const;

export type SensitiveActionKey = (typeof SENSITIVE_ACTION_KEYS)[number];
export type SensitiveActionAssurance = "REAUTH" | "MFA";

export type SensitiveActionPolicy = Readonly<{
  actionKey: SensitiveActionKey;
  requiredAssurance: SensitiveActionAssurance;
  ttlSeconds: number;
  oneTime: true;
  requiresReason: boolean;
  resourceBound: true;
  resourceType: string;
  requiredCapability: string;
  requiredModule: "PAYROLL" | "STATUTORY" | "PEOPLE" | "INVENTORY" | null;
}>;

const FIVE_MINUTES_SECONDS = 5 * 60;

const policies: Record<SensitiveActionKey, SensitiveActionPolicy> = {
  STATUTORY_RULESET_SIGNOFF: policy({
    actionKey: "STATUTORY_RULESET_SIGNOFF",
    requiredAssurance: "MFA",
    resourceType: "STATUTORY_RULESET",
    requiredCapability: "SIGN_OFF_STATUTORY_RULESET",
    requiresReason: true,
  }),
  STATUTORY_RULESET_ACTIVATE: policy({
    actionKey: "STATUTORY_RULESET_ACTIVATE",
    requiredAssurance: "MFA",
    resourceType: "STATUTORY_RULESET",
    requiredCapability: "ACTIVATE_STATUTORY_RULESET",
    requiresReason: true,
  }),
  PAYROLL_FINALIZE: policy({
    actionKey: "PAYROLL_FINALIZE",
    requiredAssurance: "MFA",
    resourceType: "PAYROLL_RUN",
    requiredCapability: "APPROVE_PAYROLL",
    requiredModule: "PAYROLL",
    requiresReason: true,
  }),
  PAYROLL_REOPEN: policy({
    actionKey: "PAYROLL_REOPEN",
    requiredAssurance: "MFA",
    resourceType: "PAYROLL_RUN",
    requiredCapability: "REOPEN_PAYROLL",
    requiredModule: "PAYROLL",
    requiresReason: true,
  }),
  PAYMENT_FILE_EXPORT: policy({
    actionKey: "PAYMENT_FILE_EXPORT",
    requiredAssurance: "MFA",
    resourceType: "PAYMENT_BATCH",
    requiredCapability: "EXPORT_PAYMENT_FILE",
    requiredModule: "PAYROLL",
    requiresReason: true,
  }),
  STATUTORY_EXPORT: policy({
    actionKey: "STATUTORY_EXPORT",
    requiredAssurance: "MFA",
    resourceType: "STATUTORY_SUBMISSION",
    requiredCapability: "EXPORT_STATUTORY",
    requiredModule: "STATUTORY",
    requiresReason: false,
  }),
  STATUTORY_SUBMIT: policy({
    actionKey: "STATUTORY_SUBMIT",
    requiredAssurance: "MFA",
    resourceType: "STATUTORY_SUBMISSION",
    requiredCapability: "SUBMIT_STATUTORY",
    requiredModule: "STATUTORY",
    requiresReason: true,
  }),
  BANK_ACCOUNT_EDIT: policy({
    actionKey: "BANK_ACCOUNT_EDIT",
    requiredAssurance: "MFA",
    resourceType: "EMPLOYEE_BANK_ACCOUNT",
    requiredCapability: "EDIT_BANK_ACCOUNT",
    requiredModule: "PAYROLL",
    requiresReason: true,
  }),
  PAYROLL_PAYMENT_PROCESS: policy({
    actionKey: "PAYROLL_PAYMENT_PROCESS",
    requiredAssurance: "MFA",
    resourceType: "PAYMENT_BATCH",
    requiredCapability: "PROCESS_PAYMENT",
    requiredModule: "PAYROLL",
    requiresReason: true,
  }),
  HIGH_RISK_PERMISSION_CHANGE: policy({
    actionKey: "HIGH_RISK_PERMISSION_CHANGE",
    requiredAssurance: "REAUTH",
    resourceType: "USER",
    requiredCapability: "MANAGE_TEAM_PERMISSIONS",
    requiredModule: "PEOPLE",
    requiresReason: true,
  }),
  QA_SENSITIVE_ACTION: policy({
    actionKey: "QA_SENSITIVE_ACTION",
    requiredAssurance: "MFA",
    resourceType: "QA_FIXTURE",
    requiredCapability: "SENSITIVE_ACTION_QA",
    requiresReason: false,
  }),
  SUPPLIER_PAYMENT_RECORD: policy({
    actionKey: "SUPPLIER_PAYMENT_RECORD",
    requiredAssurance: "MFA",
    resourceType: "SUPPLIER_BILL",
    requiredCapability: "RECORD_SUPPLIER_PAYMENT",
    requiredModule: "INVENTORY",
    requiresReason: false,
  }),
  SUPPLIER_PAYMENT_REVERSE: policy({
    actionKey: "SUPPLIER_PAYMENT_REVERSE",
    requiredAssurance: "MFA",
    resourceType: "SUPPLIER_PAYMENT",
    requiredCapability: "REVERSE_SUPPLIER_PAYMENT",
    requiredModule: "INVENTORY",
    requiresReason: true,
  }),
  SUBSCRIPTION_PAYMENT_RECORD: policy({
    actionKey: "SUBSCRIPTION_PAYMENT_RECORD",
    requiredAssurance: "MFA",
    resourceType: "SUBSCRIPTION_INVOICE",
    requiredCapability: "MANAGE_COMMERCIAL_BILLING",
    requiresReason: false,
  }),
  SUBSCRIPTION_PAYMENT_REVERSE: policy({
    actionKey: "SUBSCRIPTION_PAYMENT_REVERSE",
    requiredAssurance: "MFA",
    resourceType: "SUBSCRIPTION_PAYMENT",
    requiredCapability: "MANAGE_COMMERCIAL_BILLING",
    requiresReason: true,
  }),
  SUBSCRIPTION_INVOICE_VOID: policy({
    actionKey: "SUBSCRIPTION_INVOICE_VOID",
    requiredAssurance: "MFA",
    resourceType: "SUBSCRIPTION_INVOICE",
    requiredCapability: "MANAGE_COMMERCIAL_BILLING",
    requiresReason: true,
  }),
};

export function getSensitiveActionPolicy(
  actionKey: SensitiveActionKey,
): SensitiveActionPolicy {
  return policies[actionKey];
}

export function isSensitiveActionKey(value: string): value is SensitiveActionKey {
  return SENSITIVE_ACTION_KEYS.includes(value as SensitiveActionKey);
}

export function assuranceSatisfies(
  actual: SensitiveActionAssurance,
  required: SensitiveActionAssurance,
) {
  return actual === "MFA" || required === "REAUTH";
}

export function assertSensitiveActionAccessPreconditions(input: {
  actionKey: SensitiveActionKey;
  capabilities: readonly string[];
  enabledModules: ReadonlySet<string>;
}) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  if (!input.capabilities.includes(policy.requiredCapability)) {
    throw new Error("SENSITIVE_ACTION_PERMISSION_DENIED");
  }
  if (
    policy.requiredModule &&
    !input.enabledModules.has(policy.requiredModule)
  ) {
    throw new Error("MODULE_NOT_ENABLED");
  }
  return policy;
}

export const TRUE_MFA_CAPABILITY: Readonly<{
  status: "READY" | "NOT_READY";
  methods: readonly ("TOTP" | "PASSKEY")[];
  blocker: "TRUE_MFA_NOT_READY" | null;
}> = {
  status: "READY",
  methods: ["TOTP"],
  blocker: null,
};

function policy(input: {
  actionKey: SensitiveActionKey;
  requiredAssurance: SensitiveActionAssurance;
  resourceType: string;
  requiredCapability: string;
  requiredModule?: SensitiveActionPolicy["requiredModule"];
  requiresReason: boolean;
}): SensitiveActionPolicy {
  return Object.freeze({
    ...input,
    requiredModule: input.requiredModule ?? null,
    ttlSeconds: FIVE_MINUTES_SECONDS,
    oneTime: true,
    resourceBound: true,
  });
}
