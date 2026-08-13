"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MfaError } from "@/lib/auth/mfa-errors";
import {
  beginMfaEnrollment,
  completeMfaEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
  type MfaFactorInput,
} from "@/lib/auth/mfa-service";
import {
  assertServerActionSameOrigin,
  getAuthRequestContext,
} from "@/lib/auth/security";
import { requireUser } from "@/lib/auth/session";

export type MfaActionState = Readonly<{
  status: "IDLE" | "SUCCESS" | "ERROR";
  message: string | null;
  recoveryCodes: readonly string[];
}>;

export async function startMfaEnrollmentAction(formData: FormData) {
  assertLocalTestingMfaRuntime();
  const user = await requireUser();
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  try {
    await beginMfaEnrollment({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      password: required(formData, "password", 256),
      request: getAuthRequestContext(requestHeaders),
    });
    revalidatePath("/security/mfa");
    redirect("/security/mfa?result=MFA_ENROLLMENT_STARTED");
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/security/mfa?error=${encodeURIComponent(errorCode(error))}`);
  }
}

export async function completeMfaEnrollmentAction(
  _previous: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  assertLocalTestingMfaRuntime();
  const user = await requireUser();
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  try {
    const result = await completeMfaEnrollment({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      credentialId: required(formData, "credentialId", 64),
      code: required(formData, "code", 32),
      request: getAuthRequestContext(requestHeaders),
    });
    revalidatePath("/security/mfa");
    return {
      status: "SUCCESS",
      message: "MFA_ENROLLMENT_COMPLETED",
      recoveryCodes: result.recoveryCodes,
    };
  } catch (error) {
    return {
      status: "ERROR",
      message: errorCode(error),
      recoveryCodes: [],
    };
  }
}

export async function regenerateRecoveryCodesAction(
  _previous: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  assertLocalTestingMfaRuntime();
  const user = await requireUser();
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  try {
    const result = await regenerateRecoveryCodes({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      password: required(formData, "password", 256),
      factor: factor(formData),
      request: getAuthRequestContext(requestHeaders),
    });
    revalidatePath("/security/mfa");
    return {
      status: "SUCCESS",
      message: "RECOVERY_CODES_REGENERATED",
      recoveryCodes: result.recoveryCodes,
    };
  } catch (error) {
    return {
      status: "ERROR",
      message: errorCode(error),
      recoveryCodes: [],
    };
  }
}

export async function disableMfaAction(formData: FormData) {
  assertLocalTestingMfaRuntime();
  const user = await requireUser();
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  try {
    await disableMfa({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      password: required(formData, "password", 256),
      factor: factor(formData),
      request: getAuthRequestContext(requestHeaders),
    });
    revalidatePath("/security/mfa");
    redirect("/security/mfa?result=MFA_DISABLED");
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/security/mfa?error=${encodeURIComponent(errorCode(error))}`);
  }
}

function factor(formData: FormData): MfaFactorInput {
  const factorType = required(formData, "factorType", 32);
  if (factorType !== "TOTP" && factorType !== "RECOVERY_CODE") {
    throw new MfaError("MFA_VERIFICATION_FAILED");
  }
  return {
    factorType,
    code: required(formData, "code", 64),
  };
}

function required(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new MfaError("MFA_VERIFICATION_FAILED");
  }
  return value.trim();
}

function requiredSessionId(value: string | null | undefined) {
  if (!value) throw new MfaError("MFA_VERIFICATION_FAILED");
  return value;
}

function errorCode(error: unknown) {
  return error instanceof MfaError ? error.code : "MFA_VERIFICATION_FAILED";
}

function assertLocalTestingMfaRuntime(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const localDatabase = databaseUrl
    ? ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)
    : false;
  const namedTesting =
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "testing" ||
    env.VERCEL_ENV?.trim().toLowerCase() === "preview";
  if (!localDatabase && !namedTesting) throw new Error("LOCAL_TESTING_ONLY");
}

function isRedirect(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT"),
  );
}
