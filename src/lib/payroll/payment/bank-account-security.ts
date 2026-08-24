import {
  isProductionRuntime,
  type RuntimeEnvironmentMap,
} from "@/lib/release/environment";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * This narrower switch only applies while the product-wide MFA switch is on.
 * The temporary master switch can therefore hide the complete MFA experience
 * without deleting the bank-account protection implementation.
 */
export function isPayrollBankAccountMfaEnabled(
  env: RuntimeEnvironmentMap = process.env,
) {
  if (!isMfaFeatureEnabled(env)) return false;
  if (isProductionRuntime(env)) return true;

  const configured = env.PAYROLL_BANK_ACCOUNT_MFA_ENABLED
    ?.trim()
    .toLowerCase();
  if (!configured) return false;

  return ENABLED_VALUES.has(configured);
}

export function payrollBankAccountHighRisk(
  resourceId: string,
  env: RuntimeEnvironmentMap = process.env,
) {
  if (!isPayrollBankAccountMfaEnabled(env)) return undefined;

  return {
    actionKey: "BANK_ACCOUNT_EDIT" as const,
    resourceId,
  };
}
