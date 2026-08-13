"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import {
  consumeSensitiveActionAuthorization,
  sensitiveActionCookieOptions,
  SENSITIVE_ACTION_COOKIE,
  SensitiveActionError,
  verifySensitiveActionMfa,
} from "@/lib/auth/sensitive-action-service";
import {
  assertSensitiveActionAccessPreconditions,
  getSensitiveActionPolicy,
  isSensitiveActionKey,
  type SensitiveActionKey,
} from "@/lib/auth/sensitive-actions";
import {
  assertServerActionSameOrigin,
  getAuthRequestContext,
} from "@/lib/auth/security";
import { requireUser } from "@/lib/auth/session";

const QA_RESOURCE_ID = "local-testing-step-up-foundation";

export async function verifyQaSensitiveAction(formData: FormData) {
  const challenge = await resolveChallenge(formData);
  const user = await requireQaActor(challenge.actionKey);
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  const password = value(formData, "password");
  if (!password || password.length > 256) {
    redirectWithError("MFA_VERIFICATION_FAILED", challenge);
  }
  try {
    const policy = getSensitiveActionPolicy(challenge.actionKey);
    const verified = await verifySensitiveActionMfa({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      actionKey: policy.actionKey,
      resourceType: policy.resourceType,
      resourceId: challenge.resourceId,
      businessId: null,
      requestFingerprint: challenge.requestFingerprint,
      password,
      factor: challenge.factor,
      request: getAuthRequestContext(requestHeaders),
    });
    const cookieStore = await cookies();
    cookieStore.set(
      SENSITIVE_ACTION_COOKIE,
      verified.rawToken,
      sensitiveActionCookieOptions(policy.ttlSeconds),
    );
    if (challenge.returnTo) {
      redirect(`${challenge.returnTo}?stepUp=READY`);
    }
    redirect(challengeUrl(challenge, { result: "VERIFIED" }));
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirectWithError(errorCode(error), challenge);
  }
}

export async function consumeQaSensitiveAction(formData: FormData) {
  const challenge = await resolveChallenge(formData, false);
  const user = await requireQaActor(challenge.actionKey);
  const requestHeaders = await headers();
  assertServerActionSameOrigin(requestHeaders);
  const cookieStore = await cookies();
  try {
    const policy = getSensitiveActionPolicy(challenge.actionKey);
    await consumeSensitiveActionAuthorization({
      userId: user.userId,
      sessionId: requiredSessionId(user.sessionId),
      actionKey: policy.actionKey,
      resourceType: policy.resourceType,
      resourceId: challenge.resourceId,
      businessId: null,
      requestFingerprint: challenge.requestFingerprint,
      rawToken: cookieStore.get(SENSITIVE_ACTION_COOKIE)?.value,
    });
    cookieStore.delete(SENSITIVE_ACTION_COOKIE);
    const result = challenge.actionKey === "STATUTORY_RULESET_SIGNOFF"
      ? "STATUTORY_SIGNOFF_PRECONDITION_PASSED"
      : challenge.actionKey === "STATUTORY_RULESET_ACTIVATE"
        ? "STATUTORY_ACTIVATION_PRECONDITION_PASSED"
        : "CONSUMED";
    redirect(challengeUrl(challenge, { result }));
  } catch (error) {
    if (isRedirect(error)) throw error;
    cookieStore.delete(SENSITIVE_ACTION_COOKIE);
    redirectWithError(errorCode(error), challenge);
  }
}

async function requireQaActor(actionKey: SensitiveActionKey) {
  assertLocalTestingRuntime();
  const user = await requireUser();
  if (user.role !== "PLATFORM_ADMIN") redirect("/reports");
  try {
    assertSensitiveActionAccessPreconditions({
      actionKey,
      capabilities: user.permissions,
      enabledModules: new Set(),
    });
  } catch {
    redirect("/reports");
  }
  return user;
}

function assertLocalTestingRuntime(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  const localDatabase = databaseUrl
    ? ["localhost", "127.0.0.1", "::1"].includes(new URL(databaseUrl).hostname)
    : false;
  const namedTesting =
    env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() === "testing" ||
    env.VERCEL_ENV?.trim().toLowerCase() === "preview";
  if (!localDatabase && !namedTesting) throw new Error("LOCAL_TESTING_ONLY");
}

function requiredSessionId(value: string | null | undefined) {
  if (!value) throw new SensitiveActionError("STEP_UP_SESSION_MISMATCH");
  return value;
}

function errorCode(error: unknown) {
  return error instanceof SensitiveActionError
    ? error.code
    : "MFA_VERIFICATION_FAILED";
}

function redirectWithError(code: string, challenge: ResolvedChallenge): never {
  redirect(challengeUrl(challenge, { error: code }));
}

type ChallengeAction =
  | "QA_SENSITIVE_ACTION"
  | "STATUTORY_RULESET_SIGNOFF"
  | "STATUTORY_RULESET_ACTIVATE";

type ResolvedChallenge = Readonly<{
  actionKey: ChallengeAction;
  resourceId: string;
  requestFingerprint: string | null;
  returnTo: string | null;
  factor: { factorType: "TOTP" | "RECOVERY_CODE"; code: string };
}>;

async function resolveChallenge(
  formData: FormData,
  requireFactor = true,
): Promise<ResolvedChallenge> {
  const rawAction = value(formData, "actionKey") || "QA_SENSITIVE_ACTION";
  if (
    !isSensitiveActionKey(rawAction) ||
    ![
      "QA_SENSITIVE_ACTION",
      "STATUTORY_RULESET_SIGNOFF",
      "STATUTORY_RULESET_ACTIVATE",
    ].includes(rawAction)
  ) {
    throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  const actionKey = rawAction as ChallengeAction;
  const resourceId = value(formData, "resourceId") || QA_RESOURCE_ID;
  if (!resourceId || resourceId.length > 200) {
    throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  if (actionKey !== "QA_SENSITIVE_ACTION") {
    const exists = await prisma.statutoryRuleSet.count({ where: { id: resourceId } });
    if (exists !== 1) throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  const rawFingerprint = value(formData, "requestFingerprint");
  const requestFingerprint = rawFingerprint || null;
  if (requestFingerprint && !/^[a-f0-9]{64}$/.test(requestFingerprint)) {
    throw new SensitiveActionError("STEP_UP_SCOPE_MISMATCH");
  }
  const rawReturnTo = value(formData, "returnTo");
  const returnTo = rawReturnTo && /^\/admin\/statutory\/rulesets\/[0-9a-f-]{36}$/.test(rawReturnTo)
    ? rawReturnTo
    : null;
  const factorType = value(formData, "factorType") || "TOTP";
  const code = value(formData, "code");
  if (
    (factorType !== "TOTP" && factorType !== "RECOVERY_CODE") ||
    (requireFactor && (!code || code.length > 64))
  ) {
    throw new SensitiveActionError("MFA_VERIFICATION_FAILED");
  }
  return {
    actionKey,
    resourceId,
    requestFingerprint,
    returnTo,
    factor: { factorType, code },
  };
}

function challengeUrl(
  challenge: ResolvedChallenge,
  message: { result?: string; error?: string },
) {
  const params = new URLSearchParams({
    action: challenge.actionKey,
    resourceId: challenge.resourceId,
  });
  if (challenge.requestFingerprint) {
    params.set("requestFingerprint", challenge.requestFingerprint);
  }
  if (challenge.returnTo) params.set("returnTo", challenge.returnTo);
  if (message.result) params.set("result", message.result);
  if (message.error) params.set("error", message.error);
  return `/admin/security/sensitive-actions?${params.toString()}`;
}

function value(formData: FormData, key: string) {
  const candidate = formData.get(key);
  return typeof candidate === "string" ? candidate.trim() : "";
}

function isRedirect(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT"),
  );
}
