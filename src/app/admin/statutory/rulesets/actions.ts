"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SENSITIVE_ACTION_COOKIE } from "@/lib/auth/sensitive-action-service";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import {
  activateStoredStatutoryRule,
  signOffStatutoryRule,
} from "@/lib/payroll/statutory-activation-service";
import {
  assertStatutoryReviewChecklist,
  statutoryReviewChecklistAnswers,
} from "@/lib/payroll/statutory-human-review";
import {
  completeStatutoryHumanReview,
  recordStatutoryComponentReviewDecision,
} from "@/lib/payroll/statutory-governance-service";

export async function signOffStatutoryRuleAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    const cookieStore = await cookies();
    const reviewChecklistVersion = assertStatutoryReviewChecklist(formData);
    await signOffStatutoryRule({
      ruleSetId,
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
      reason: required(formData, "reason"),
      expectedEvidenceDigest: required(formData, "expectedEvidenceDigest"),
      reviewChecklistVersion,
      reviewChecklistAnswers: statutoryReviewChecklistAnswers(formData),
      stepUpAuthorization: {
        sessionId: requiredSessionId(user.sessionId),
        rawToken: cookieStore.get(SENSITIVE_ACTION_COOKIE)?.value,
      },
    });
    cookieStore.delete(SENSITIVE_ACTION_COOKIE);
    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=SIGNED_OFF`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}`);
  }
}

export async function reviewStatutoryClassificationAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    await recordStatutoryComponentReviewDecision({
      ruleSetId,
      classificationId: required(formData, "classificationId"),
      decision: reviewDecision(formData),
      evidenceReference: required(formData, "evidenceReference"),
      reason: required(formData, "reason"),
      expectedEvidenceDigest: required(formData, "expectedEvidenceDigest"),
      expectedReviewRevision: requiredInteger(formData, "expectedReviewRevision"),
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
    });
    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=CLASSIFICATION_REVIEW_RECORDED`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}`);
  }
}

export async function completeStatutoryHumanReviewAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    await completeStatutoryHumanReview({
      ruleSetId,
      reason: required(formData, "reason"),
      expectedEvidenceDigest: required(formData, "expectedEvidenceDigest"),
      expectedReviewRevision: requiredInteger(formData, "expectedReviewRevision"),
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
    });
    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=HUMAN_REVIEW_COMPLETED`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}`);
  }
}

export async function activateStatutoryRuleAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    const cookieStore = await cookies();
    await activateStoredStatutoryRule({
      ruleSetId,
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
      reason: required(formData, "reason"),
      expectedEvidenceDigest: required(formData, "expectedEvidenceDigest"),
      stepUpAuthorization: {
        sessionId: requiredSessionId(user.sessionId),
        rawToken: cookieStore.get(SENSITIVE_ACTION_COOKIE)?.value,
      },
    });
    cookieStore.delete(SENSITIVE_ACTION_COOKIE);
    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=ACTIVATED`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}`);
  }
}

function required(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) throw new Error(`MISSING_${key.toUpperCase()}`);
  return value.trim();
}

function requiredInteger(formData: FormData, key: string) {
  const value = Number(required(formData, key));
  if (!Number.isInteger(value) || value < 0) throw new Error(`INVALID_${key.toUpperCase()}`);
  return value;
}

function reviewDecision(formData: FormData) {
  const value = required(formData, "decision");
  if (value !== "INCLUDED" && value !== "EXCLUDED" && value !== "KEEP_UNKNOWN") {
    throw new Error("INVALID_STATUTORY_REVIEW_DECISION");
  }
  return value;
}

function errorCode(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 160) : "STATUTORY_ACTION_FAILED";
}

function requiredSessionId(value: string | null | undefined) {
  if (!value) throw new Error("STEP_UP_SESSION_MISMATCH");
  return value;
}

function isRedirect(error: unknown) {
  return Boolean(error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT"));
}
