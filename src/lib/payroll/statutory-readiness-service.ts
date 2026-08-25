import type { PrismaClient } from "@prisma/client";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { prisma } from "@/lib/prisma";
import { statutoryRuleEvidenceDigest } from "./statutory-activation-service";
import { classificationBlockingScope } from "./statutory-classification-policy";
import { statutoryStepUpReadiness } from "./statutory-governance-service";

export type StatutoryActivationBlocker =
  | "HUMAN_SIGN_OFF_REQUIRED"
  | "SIGN_OFF_STALE"
  | "OFFICIAL_ARTIFACT_MISSING"
  | "ARTIFACT_HASH_MISMATCH"
  | "DATASET_NOT_VERIFIED"
  | "CALCULATOR_NOT_VERIFIED"
  | "FIXTURE_MISMATCH"
  | "COMPONENT_CLASSIFICATION_REQUIRED"
  | "HUMAN_REVIEW_REQUIRED"
  | "STATUTORY_STEP_UP_AUTH_NOT_READY"
  | "EMPLOYEE_RULE_CATEGORY_INCOMPLETE"
  | "ACTIVE_RULE_OVERLAP";

type ReadinessDatabase = Pick<PrismaClient, "statutoryRuleSet">;

export async function getStatutoryActivationReadiness(
  ruleSetId: string,
  database: ReadinessDatabase = prisma,
) {
  const rule = await database.statutoryRuleSet.findUniqueOrThrow({
    where: { id: ruleSetId },
    include: {
      classifications: true,
      reviewDecisions: true,
      signOffs: { orderBy: { createdAt: "desc" } },
    },
  });
  const evidenceDigest = statutoryRuleEvidenceDigest(rule);
  const blockers = new Set<StatutoryActivationBlocker>();

  if (!isSha256(rule.sourceDigest)) blockers.add("OFFICIAL_ARTIFACT_MISSING");
  if (!isSha256(rule.datasetDigest) || !rule.datasetRowCount || rule.datasetRowCount <= 0) {
    blockers.add("DATASET_NOT_VERIFIED");
  }
  if (!isSha256(rule.goldenFixtureDigest)) blockers.add("FIXTURE_MISMATCH");
  if (!isSha256(rule.calculatorTestDigest) || !rule.calculatorVersion) {
    blockers.add("CALCULATOR_NOT_VERIFIED");
  }
  const latestDecisions = latestDecisionByClassification(rule.reviewDecisions);
  const classificationGovernance = rule.classifications.map((classification) => ({
    componentCode: classification.componentCode,
    treatment: classification.treatment,
    decision: latestDecisions.get(classification.id)?.decision ?? null,
    blockingScope: classificationBlockingScope({
      componentCode: classification.componentCode,
      currentTreatment: classification.treatment,
      latestDecision: latestDecisions.get(classification.id)?.decision ?? null,
    }),
  }));
  if (!isSha256(rule.classificationDigest) || !rule.classificationVersion ||
    classificationGovernance.some((item) => item.blockingScope === "GLOBAL_ACTIVATION_BLOCKER")) {
    blockers.add("COMPONENT_CLASSIFICATION_REQUIRED");
  }
  if (rule.humanReviewStatus !== "COMPLETED" && rule.authority !== "TEST_ONLY") {
    blockers.add("HUMAN_REVIEW_REQUIRED");
  }

  const latestDecision = rule.signOffs[0];
  const latestApproval = rule.signOffs.find((item) => item.decision === "APPROVED");
  if (
    !latestApproval ||
    latestDecision?.decision !== "APPROVED" ||
    (rule.status !== "HUMAN_SIGNED_OFF" && rule.status !== "ACTIVE")
  ) blockers.add("HUMAN_SIGN_OFF_REQUIRED");
  if (latestApproval && latestApproval.evidenceDigest !== evidenceDigest) {
    blockers.add("SIGN_OFF_STALE");
  }
  const stepUp = statutoryStepUpReadiness(rule);
  const effectiveStepUp = isMfaFeatureEnabled()
    ? stepUp
    : { status: "READY" as const, blocker: null };
  if (effectiveStepUp.blocker) blockers.add("STATUTORY_STEP_UP_AUTH_NOT_READY");

  const overlap = await database.statutoryRuleSet.findFirst({
    where: {
      id: { not: rule.id },
      scheme: rule.scheme,
      status: "ACTIVE",
      effectiveFrom: { lt: rule.effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: rule.effectiveFrom } }],
    },
    select: { id: true },
  });
  if (overlap) blockers.add("ACTIVE_RULE_OVERLAP");

  return {
    status: blockers.size === 0 ? "READY" as const : "BLOCKED" as const,
    blockers: [...blockers].sort(),
    evidenceDigest,
    rule,
    latestApproval: latestApproval ?? null,
    classificationGovernance,
    conditionalRuntimeBlockers: classificationGovernance
      .filter((item) => item.blockingScope === "CONDITIONAL_RUNTIME_BLOCKER")
      .map((item) => item.componentCode)
      .sort(),
    layers: {
      engineering: rule.readiness === "CALCULATION_VERIFIED" ? "READY" as const : "PARTIAL" as const,
      evidence: isSha256(rule.sourceDigest) && isSha256(rule.datasetDigest) &&
        isSha256(rule.goldenFixtureDigest) ? "COMPLETE" as const : "INCOMPLETE" as const,
      canonicalRuleSet: "REGISTERED" as const,
      unknownReview: rule.humanReviewStatus === "COMPLETED"
        ? "COMPLETE" as const
        : rule.humanReviewStatus === "IN_PROGRESS" ? "IN_PROGRESS" as const : "PENDING" as const,
      humanSignOff: latestApproval && latestDecision?.decision === "APPROVED"
        ? "EXECUTED" as const : "NOT_EXECUTED" as const,
      stepUp: effectiveStepUp.status,
      activation: rule.status === "ACTIVE" ? "ACTIVE" as const : "NOT_ACTIVE" as const,
    },
  };
}

function latestDecisionByClassification<T extends {
  classificationId: string;
  decisionRevision: number;
  decision: "INCLUDED" | "ADDITIONAL_REMUNERATION" | "EXCLUDED" | "KEEP_UNKNOWN";
}>(decisions: T[]) {
  const latest = new Map<string, T>();
  for (const decision of decisions) {
    const current = latest.get(decision.classificationId);
    if (!current || current.decisionRevision < decision.decisionRevision) {
      latest.set(decision.classificationId, decision);
    }
  }
  return latest;
}

function isSha256(value: string | null) {
  return /^[a-f0-9]{64}$/.test(value ?? "");
}
