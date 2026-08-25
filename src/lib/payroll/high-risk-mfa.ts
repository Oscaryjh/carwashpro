import type { Prisma } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import {
  consumeSensitiveActionAuthorizationInTransaction,
  SensitiveActionError,
  verifySensitiveActionMfa,
} from "@/lib/auth/sensitive-action-service";
import type { MfaFactorInput } from "@/lib/auth/mfa-service";
import type { AuthRequestContext } from "@/lib/auth/security";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import {
  getSensitiveActionPolicy,
  type SensitiveActionKey,
} from "@/lib/auth/sensitive-actions";
import {
  hasBusinessCapability,
  type ResolvedBusinessAccess,
} from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";

export type PayrollHighRiskStepUp = Readonly<{
  rawToken: string;
  sessionId: string;
}>;

export type PayrollHighRiskAuditLink = Readonly<{
  sensitiveActionAuthorizationId: string;
  stepUpAssurance: string;
  stepUpVerificationMethod: string;
}>;

export async function issuePayrollHighRiskAuthorization(input: {
  access: ResolvedBusinessAccess;
  actionKey: SensitiveActionKey;
  businessId: string;
  enabledModules: ReadonlySet<string>;
  factor: MfaFactorInput;
  password: string;
  request: AuthRequestContext;
  resourceId: string;
  user: Pick<AppSession, "sessionId" | "userId">;
}) {
  const policy = getSensitiveActionPolicy(input.actionKey);
  if (
    !input.access.granted ||
    input.access.businessId !== input.businessId ||
    !hasBusinessCapability(
      input.access,
      policy.requiredCapability as BusinessCapability,
    )
  ) {
    throw new Error("SENSITIVE_ACTION_PERMISSION_DENIED");
  }
  if (
    policy.requiredModule &&
    !input.enabledModules.has(policy.requiredModule)
  ) {
    throw new Error("MODULE_NOT_ENABLED");
  }
  if (!input.user.sessionId) throw new Error("STEP_UP_SESSION_MISMATCH");
  if (!isMfaFeatureEnabled()) {
    return {
      rawToken: "MFA_TEMPORARILY_DISABLED",
      sessionId: input.user.sessionId,
    } satisfies PayrollHighRiskStepUp;
  }
  const verified = await verifySensitiveActionMfa({
    actionKey: input.actionKey,
    businessId: input.businessId,
    factor: input.factor,
    password: input.password,
    request: input.request,
    resourceId: input.resourceId,
    resourceType: policy.resourceType,
    sessionId: input.user.sessionId,
    userId: input.user.userId,
  });
  return {
    rawToken: verified.rawToken,
    sessionId: input.user.sessionId,
  } satisfies PayrollHighRiskStepUp;
}

export async function consumePayrollHighRiskAuthorization(input: {
  actionKey: SensitiveActionKey;
  businessId: string;
  resourceId: string;
  stepUp: PayrollHighRiskStepUp | null | undefined;
  userId: string;
}, transaction: Prisma.TransactionClient): Promise<PayrollHighRiskAuditLink> {
  if (!input.stepUp) {
    throw new SensitiveActionError("STEP_UP_REQUIRED");
  }
  const policy = getSensitiveActionPolicy(input.actionKey);
  const authorization = await consumeSensitiveActionAuthorizationInTransaction(
    {
      actionKey: input.actionKey,
      businessId: input.businessId,
      rawToken: input.stepUp.rawToken,
      resourceId: input.resourceId,
      resourceType: policy.resourceType,
      sessionId: input.stepUp.sessionId,
      userId: input.userId,
    },
    transaction,
  );
  return {
    sensitiveActionAuthorizationId: authorization.id,
    stepUpAssurance: authorization.assuranceLevel,
    stepUpVerificationMethod: authorization.verificationMethod,
  };
}

export function payrollMfaFactor(formData: FormData): MfaFactorInput {
  if (!isMfaFeatureEnabled()) {
    return { factorType: "TOTP", code: "MFA_TEMPORARILY_DISABLED" };
  }
  const factorType = required(formData, "stepUpFactorType", 32);
  if (factorType !== "TOTP" && factorType !== "RECOVERY_CODE") {
    throw new Error("MFA_VERIFICATION_FAILED");
  }
  return {
    factorType,
    code: required(formData, "stepUpCode", 64),
  };
}

export function payrollMfaPassword(formData: FormData) {
  if (!isMfaFeatureEnabled()) return "MFA_TEMPORARILY_DISABLED";
  return required(formData, "stepUpPassword", 256);
}

export function statutoryExportStepUpResourceId(
  month: string,
  provider: string,
  revision?: number | null,
) {
  return `STATUTORY_EXPORT:${month}:${provider}:${revision ?? "LATEST"}`;
}

export function publicPayrollMfaError(error: unknown) {
  if (!(error instanceof SensitiveActionError)) return null;
  if (error.code === "MFA_NOT_ENROLLED") {
    return "MFA enrollment required. Open Account security and enroll an authenticator before continuing.";
  }
  if (error.code === "MFA_RATE_LIMITED" || error.code === "STEP_UP_RATE_LIMITED") {
    return "MFA verification is temporarily rate limited. Wait and try again.";
  }
  if (error.code === "MFA_REPLAYED") {
    return "That authenticator code was already used. Wait for a new code and try again.";
  }
  if (error.code === "MFA_VERIFICATION_FAILED" || error.code === "STEP_UP_FAILED") {
    return "MFA verification failed. Check the password and current authenticator code.";
  }
  return "Additional MFA verification is required for this exact action and resource.";
}

function required(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new Error("MFA_VERIFICATION_FAILED");
  }
  return value.trim();
}
