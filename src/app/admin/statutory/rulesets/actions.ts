"use server";

import type { StatutoryComponentReviewDecisionValue } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SENSITIVE_ACTION_COOKIE } from "@/lib/auth/sensitive-action-service";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isArrearsComponent } from "@/lib/payroll/statutory-classification-policy";
import {
  activateStoredStatutoryRule,
  recordPcbSoftwareVerification,
  signOffStatutoryRule,
} from "@/lib/payroll/statutory-activation-service";
import {
  assertStatutoryReviewChecklist,
  statutoryReviewChecklistAnswers,
} from "@/lib/payroll/statutory-human-review";
import {
  completeStatutoryHumanReview,
  registerPcbReviewDraft,
  recordStatutoryComponentReviewDecision,
  recordStatutoryComponentReviewDecisions,
} from "@/lib/payroll/statutory-governance-service";

export async function registerPcbReviewDraftAction() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  try {
    const result = await registerPcbReviewDraft({
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
      reason: "Started PCB pay-item review from the retained official HASiL evidence.",
    });
    revalidatePath("/admin/statutory/rulesets");
    revalidatePath("/admin/statutory/review/pcb");
    redirect(`/admin/statutory/rulesets/${result.ruleSetId}#classification-review`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/review/pcb?error=${encodeURIComponent(errorCode(error))}#pay-item-treatment`);
  }
}

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
      reason: "Approved after completing the final statutory review checklist.",
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
  const returnHash = reviewReturnHash(formData);
  try {
    const decision = reviewDecision(formData);
    await recordStatutoryComponentReviewDecision({
      ruleSetId,
      classificationId: required(formData, "classificationId"),
      decision,
      evidenceReference: required(formData, "defaultEvidenceReference"),
      reason: automaticReviewReason(decision),
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
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=CLASSIFICATION_REVIEW_RECORDED${returnHash}`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}${returnHash}`);
  }
}

export async function reviewStatutoryClassificationsAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  const expectedEvidenceDigest = required(formData, "expectedEvidenceDigest");
  const expectedReviewRevision = requiredInteger(formData, "expectedReviewRevision");

  try {
    const rule = await prisma.statutoryRuleSet.findUnique({
      where: { id: ruleSetId },
      select: {
        id: true,
        humanReviewRevision: true,
        classifications: {
          where: { treatment: "UNKNOWN" },
          orderBy: { componentCode: "asc" },
          select: {
            id: true,
            componentCode: true,
            authorityRef: true,
            reviewDecisions: {
              orderBy: { decisionRevision: "desc" },
              take: 1,
              select: { decision: true },
            },
          },
        },
      },
    });
    if (!rule) throw new Error("STATUTORY_RULESET_NOT_FOUND");
    if (rule.humanReviewRevision !== expectedReviewRevision) {
      throw new Error("STATUTORY_HUMAN_REVIEW_STALE");
    }

    const selections = rule.classifications.map((classification) => {
      const fieldName = `decision:${classification.id}`;
      const rawDecision = formData.get(fieldName);
      const decision = isArrearsComponent(classification.componentCode)
        ? "KEEP_UNKNOWN" as const
        : reviewDecisionValue(rawDecision, fieldName);
      return {
        ...classification,
        decision,
        currentDecision: classification.reviewDecisions[0]?.decision,
      };
    });
    const changes = selections.filter((selection) => selection.decision !== selection.currentDecision);

    if (changes.length) {
      await recordStatutoryComponentReviewDecisions({
        ruleSetId,
        decisions: changes.map((selection) => ({
          classificationId: selection.id,
          decision: selection.decision,
          evidenceReference: selection.authorityRef,
          reason: automaticReviewReason(selection.decision),
        })),
        expectedEvidenceDigest,
        expectedReviewRevision,
        actor: {
          id: user.userId,
          role: user.role,
          actorType: "HUMAN_USER",
          capabilities: user.permissions,
        },
      });
    }

    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    const result = changes.length
      ? "Payroll item treatments updated."
      : "No changes to save.";
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=${encodeURIComponent(result)}#classification-review`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}#classification-review`);
  }
}

export async function completeStatutoryHumanReviewAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    await completeStatutoryHumanReview({
      ruleSetId,
      reason: "HR review completed after every statutory classification item received a recorded decision.",
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
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=HUMAN_REVIEW_COMPLETED#approval`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}#classification-review`);
  }
}

export async function recordPcbSoftwareVerificationAction(formData: FormData) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const ruleSetId = required(formData, "ruleSetId");
  try {
    if (formData.get("confirmExactVersion") !== "on") {
      throw new Error("PCB_EXACT_VERSION_CONFIRMATION_REQUIRED");
    }
    await recordPcbSoftwareVerification({
      ruleSetId,
      expectedEvidenceDigest: required(formData, "expectedEvidenceDigest"),
      evidence: {
        approvedSoftwareName: required(formData, "approvedSoftwareName"),
        approvalReference: required(formData, "approvalReference"),
        sourceUrl: required(formData, "sourceUrl"),
        verifiedCalculatorVersion: required(formData, "verifiedCalculatorVersion"),
        effectiveFrom: required(formData, "effectiveFrom"),
      },
      actor: {
        id: user.userId,
        role: user.role,
        actorType: "HUMAN_USER",
        capabilities: user.permissions,
      },
    });
    revalidatePath(`/admin/statutory/rulesets/${ruleSetId}`);
    revalidatePath("/admin/statutory/rulesets");
    revalidatePath("/admin/statutory/review/pcb");
    redirect(`/admin/statutory/rulesets/${ruleSetId}?result=PCB_SOFTWARE_VERIFICATION_RECORDED#approval`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    redirect(`/admin/statutory/rulesets/${ruleSetId}?error=${encodeURIComponent(errorCode(error))}#approval`);
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
      reason: "Payroll use enabled after statutory review and approval.",
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

function reviewReturnHash(formData: FormData) {
  const value = formData.get("returnAnchor");
  if (typeof value === "string" && /^classification-[a-zA-Z0-9-]+$/.test(value)) {
    return `#${value}`;
  }
  return "#classification-review";
}

function reviewDecision(formData: FormData) {
  return reviewDecisionValue(required(formData, "decision"), "decision");
}

function reviewDecisionValue(
  value: FormDataEntryValue | null,
  fieldName: string,
): StatutoryComponentReviewDecisionValue {
  if (value !== "INCLUDED" && value !== "ADDITIONAL_REMUNERATION" &&
    value !== "EXCLUDED" && value !== "KEEP_UNKNOWN") {
    throw new Error(value === null || value === ""
      ? `MISSING_${fieldName.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
      : "INVALID_STATUTORY_REVIEW_DECISION");
  }
  return value as StatutoryComponentReviewDecisionValue;
}

function automaticReviewReason(decision: ReturnType<typeof reviewDecision>) {
  switch (decision) {
    case "INCLUDED":
      return "Included after HR review of the linked official evidence.";
    case "ADDITIONAL_REMUNERATION":
      return "Treated as additional remuneration after HR review of the linked official evidence.";
    case "EXCLUDED":
      return "Excluded after HR review of the linked official evidence.";
    case "KEEP_UNKNOWN":
      return "Kept unresolved until additional official evidence is available.";
  }
}

function errorCode(error: unknown) {
  if (!(error instanceof Error)) return "STATUTORY_ACTION_FAILED";
  const code = error.message.trim();
  return /^[A-Z][A-Z0-9_]*$/.test(code)
    ? code.slice(0, 160)
    : "STATUTORY_ACTION_FAILED";
}

function requiredSessionId(value: string | null | undefined) {
  if (!value) throw new Error("STEP_UP_SESSION_MISMATCH");
  return value;
}

function isRedirect(error: unknown) {
  return Boolean(error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_REDIRECT"));
}
