import type {
  Prisma,
  PrismaClient,
  StatutoryComponentReviewDecisionValue,
  StatutoryComponentTreatment,
  StatutoryReviewBlockingScope,
  StatutoryScheme,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getSensitiveActionPolicy,
  TRUE_MFA_CAPABILITY,
} from "@/lib/auth/sensitive-actions";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import {
  canonicalDigest,
  type RuleActivationEvidence,
} from "./statutory-artifact-pipeline";
import {
  evaluateStatutoryEvidencePack,
  loadStatutoryHumanReviewPackages,
  loadStatutoryEvidencePackInputs,
  type EvidencePackScheme,
  type StatutoryHumanReviewPackage,
  type StatutoryEvidencePackInput,
} from "./statutory-evidence-pack";
import {
  assertArrearsDecision,
  classificationBlockingScope,
  effectiveClassificationTreatment,
} from "./statutory-classification-policy";
import {
  statutoryRuleEvidenceDigest,
  type StatutoryHumanActor,
} from "./statutory-activation-service";

export const REVIEW_STATUTORY_CLASSIFICATION = "REVIEW_STATUTORY_CLASSIFICATION";
export const STATUTORY_STEP_UP_AUTH_NOT_READY = "STATUTORY_STEP_UP_AUTH_NOT_READY";
export const LOCAL_REGISTRATION_ACTOR_ID = "00000000-0000-4000-8000-000000000001";

type GovernanceDatabase = PrismaClient;

type RegistrationActor = {
  id: string;
  role: "PLATFORM_ADMIN";
  actorType: "SYSTEM" | "SCRIPT";
};

type ClassificationWithDecisions = {
  id: string;
  componentCode: string;
  treatment: StatutoryComponentTreatment;
  reviewDecisions: Array<{
    id: string;
    classificationId: string;
    componentCode: string;
    classificationRevision: string;
    previousClassification: StatutoryComponentTreatment;
    decision: StatutoryComponentReviewDecisionValue;
    blockingScope: StatutoryReviewBlockingScope;
    evidenceReference: string;
    reason: string;
    reviewerUserId: string;
    reviewedAt: Date;
    decisionRevision: number;
    evidenceDigest: string;
    decisionDigest: string;
  }>;
};

export type StatutoryGovernanceLayerStatus = {
  canonicalRuleSet: "REGISTERED";
  unknownReview: "PENDING" | "IN_PROGRESS" | "COMPLETE";
  humanSignOff: "NOT_EXECUTED" | "EXECUTED";
  stepUp: "READY" | "BLOCKED";
  activation: "NOT_ACTIVE" | "ACTIVE";
};

export function statutoryStepUpReadiness(rule: {
  authority: string;
  version?: string;
  sourceReference?: string;
}) {
  void rule;
  if (!isMfaFeatureEnabled()) {
    return { status: "READY" as const, blocker: null };
  }
  const policy = getSensitiveActionPolicy("STATUTORY_RULESET_SIGNOFF");
  return policy.requiredAssurance === "MFA" &&
    TRUE_MFA_CAPABILITY.status !== "NOT_READY"
    ? { status: "READY" as const, blocker: null }
    : { status: "BLOCKED" as const, blocker: STATUTORY_STEP_UP_AUTH_NOT_READY };
}

export async function registerCanonicalStatutoryCandidates(
  input: {
    actor: RegistrationActor;
    reason: string;
    root?: string;
  },
  database: GovernanceDatabase = prisma,
) {
  assertRegistrationActor(input.actor);
  assertReason(input.reason);
  const packs = await loadStatutoryEvidencePackInputs(input.root ?? process.cwd());
  const registrations = [];
  for (const pack of packs) {
    registrations.push(await registerCanonicalCandidate(pack, input.actor, input.reason, database));
  }
  return registrations;
}

export async function registerPcbReviewDraft(
  input: {
    actor: StatutoryHumanActor;
    reason: string;
    root?: string;
  },
  database: GovernanceDatabase = prisma,
) {
  assertReviewActor(input.actor);
  assertReason(input.reason);
  const pack = (await loadStatutoryHumanReviewPackages(input.root ?? process.cwd()))
    .find((candidate) => candidate.scheme === "PCB");
  if (!pack) throw new Error("PCB_EVIDENCE_PACKAGE_NOT_FOUND");

  const primary = pack.artifacts.find((artifact) => artifact.verified && artifact.sha256) ?? null;
  if (!primary?.sha256) throw new Error("PCB_VERIFIED_PRIMARY_ARTIFACT_REQUIRED");

  const existing = await database.statutoryRuleSet.findUnique({
    where: { scheme_version: { scheme: "PCB", version: pack.classification.version } },
    select: { id: true, ruleData: true },
  });
  if (existing) {
    const digest = (existing.ruleData as { evidencePackDigest?: unknown } | null)?.evidencePackDigest;
    if (digest !== pack.evidenceDigest) throw new Error("PCB_REVIEW_DRAFT_EVIDENCE_CHANGED");
    return { ruleSetId: existing.id, status: "EXISTING" as const };
  }

  const classifications = pcbReviewDraftClassificationRows(pack, primary.sourceUrl);
  const ruleData = {
    id: pack.dataset.id,
    reviewDraft: true,
    evidencePackDigest: pack.evidenceDigest,
    eligibilityLogicRevision: pack.classification.version,
    officialArtifacts: pack.artifacts.map((artifact) => ({
      id: artifact.id,
      authority: artifact.authority,
      title: artifact.title,
      sha256: artifact.sha256,
      sourceUrl: artifact.sourceUrl,
      retainedPath: artifact.retainedPath,
      verified: artifact.verified,
    })),
    knownLimitations: pack.knownLimitations,
  } satisfies Prisma.InputJsonObject;
  const verificationEvidence = {
    scheme: "PCB",
    ruleVersion: pack.classification.version,
    effectiveFrom: pack.effectiveFrom,
    effectiveTo: pack.effectiveTo,
    artifactStatus: "VERIFIED",
    datasetStatus: pack.dataset.verificationStatus,
    independentReviewStatus: pack.independentReview.status,
    fixtureStatus: "PARTIAL",
    classificationStatus: "HR_REVIEW_ALLOWED",
    calculatorStatus: "PARTIAL",
    artifactSha256: primary.sha256,
    datasetDigest: pack.dataset.digest,
    independentReviewDigest: pack.independentReview.digest,
    fixtureDigest: pack.fixtureDigest,
    classificationVersion: pack.classification.version,
    classificationDigest: pack.classification.digest,
    parserName: pack.dataset.parserName,
    parserVersion: pack.dataset.parserVersion,
    calculatorVersion: pack.calculator.version,
    calculatorTestDigest: pack.calculator.testDigest,
    datasetRowCount: pack.dataset.actualRowCount,
    goldenFixtureCount: pack.fixtures.length,
    unresolvedBlockers: pack.knownLimitations,
    signOffAllowed: false,
    activationAllowed: false,
  } satisfies Prisma.InputJsonObject;

  return database.$transaction(async (transaction) => {
    await assertStoredReviewActor(transaction, input.actor);
    const rule = await transaction.statutoryRuleSet.create({
      data: {
        scheme: "PCB",
        version: pack.classification.version,
        effectiveFrom: dateValue(pack.effectiveFrom),
        effectiveTo: pack.effectiveTo ? dateValue(pack.effectiveTo) : null,
        authority: primary.authority,
        sourceReference: primary.sourceUrl,
        sourceDocumentName: primary.title,
        sourceDigest: primary.sha256,
        datasetDigest: pack.dataset.digest,
        goldenFixtureDigest: pack.fixtureDigest,
        independentReviewDigest: pack.independentReview.digest,
        classificationVersion: pack.classification.version,
        classificationDigest: pack.classification.digest,
        parserName: pack.dataset.parserName,
        parserVersion: pack.dataset.parserVersion,
        calculatorVersion: pack.calculator.version,
        calculatorTestDigest: pack.calculator.testDigest,
        datasetRowCount: pack.dataset.actualRowCount,
        readiness: "DATASET_VERIFIED",
        status: "ENGINEERING_VERIFIED",
        humanReviewStatus: "PENDING",
        ruleData,
        verificationEvidence,
        createdById: input.actor.id,
        classifications: { create: classifications },
      },
    });
    await transaction.statutoryRuleLifecycleAudit.create({
      data: {
        ruleSetId: rule.id,
        scheme: rule.scheme,
        ruleVersion: rule.version,
        action: "RULESET_REGISTERED",
        actorId: input.actor.id,
        reason: input.reason.trim(),
        evidenceDigest: pack.evidenceDigest,
        previousStatus: rule.status,
        nextStatus: rule.status,
      },
    });
    return { ruleSetId: rule.id, status: "REGISTERED" as const };
  }, { isolationLevel: "Serializable" });
}

async function registerCanonicalCandidate(
  pack: StatutoryEvidencePackInput,
  actor: RegistrationActor,
  reason: string,
  database: GovernanceDatabase,
) {
  const result = evaluateStatutoryEvidencePack(pack);
  if (result.evidencePack !== "COMPLETE" || result.engineering !== "READY") {
    throw new Error(`STATUTORY_EVIDENCE_PACK_INCOMPLETE:${pack.registry.scheme}`);
  }
  const primary = pack.artifacts.find(
    ({ manifest }) => manifest.id === pack.registry.primaryArtifactId,
  )?.manifest;
  if (!primary?.sha256) throw new Error("STATUTORY_PRIMARY_ARTIFACT_REQUIRED");

  const existing = await database.statutoryRuleSet.findUnique({
    where: {
      scheme_version: {
        scheme: pack.registry.scheme as StatutoryScheme,
        version: pack.classification.version,
      },
    },
    include: { classifications: true },
  });
  if (existing) {
    const storedDigest = (existing.ruleData as { evidencePackDigest?: unknown } | null)
      ?.evidencePackDigest;
    if (storedDigest !== result.evidenceDigest) {
      throw new Error(`CANONICAL_RULESET_REGISTRATION_CONFLICT:${pack.registry.scheme}`);
    }
    return { scheme: pack.registry.scheme, ruleSetId: existing.id, status: "EXISTING" as const };
  }

  const evidence = activationEvidence(pack, primary.sha256, result.unknownComponents);
  const calculationAuditDigest = canonicalDigest({
    action: "CALCULATION_VERIFIED",
    actorId: actor.id,
    reason: reason.trim(),
    evidence: engineeringEvidence(evidence),
  });
  const classificationRows = candidateClassificationRows(pack, primary.sourceUrl);
  const ruleData = {
    ...pack.dataset,
    eligibilityLogicRevision: pack.registry.calculatorVersion,
    officialArtifacts: pack.artifacts.map(({ manifest }) => ({
      id: manifest.id,
      authority: manifest.authority,
      title: manifest.title,
      sha256: manifest.sha256,
      sourceUrl: manifest.sourceUrl,
      retainedPath: manifest.retainedPath ?? null,
    })),
    evidencePackDigest: result.evidenceDigest,
    baseClassificationDigest: pack.classification.classificationDigest,
    knownLimitations: pack.registry.knownLimitations,
  } satisfies Prisma.InputJsonObject;

  return database.$transaction(async (transaction) => {
    const rule = await transaction.statutoryRuleSet.create({
      data: {
        scheme: pack.registry.scheme as StatutoryScheme,
        version: pack.classification.version,
        effectiveFrom: dateValue(pack.registry.effectiveFrom),
        effectiveTo: pack.registry.effectiveTo ? dateValue(pack.registry.effectiveTo) : null,
        authority: primary.authority,
        sourceReference: primary.sourceUrl,
        sourceDocumentName: primary.title,
        sourceDigest: primary.sha256,
        datasetDigest: pack.dataset.datasetDigest,
        goldenFixtureDigest: pack.fixtures.fixtureDigest,
        independentReviewDigest: pack.review.reviewDigest,
        classificationVersion: pack.classification.version,
        classificationDigest: pack.classification.classificationDigest,
        parserName: pack.dataset.parserName,
        parserVersion: pack.dataset.parserVersion,
        calculatorVersion: pack.registry.calculatorVersion,
        calculatorTestDigest: pack.registry.calculatorTestDigest,
        datasetRowCount: pack.dataset.rows.length,
        readiness: "CALCULATION_VERIFIED",
        status: "READY_FOR_HUMAN_SIGN_OFF",
        humanReviewStatus: "PENDING",
        ruleData,
        verificationEvidence: evidence as unknown as Prisma.InputJsonObject,
        calculationVerifiedAt: new Date(),
        calculationVerifiedById: actor.id,
        createdById: null,
        classifications: { create: classificationRows },
      },
      include: { classifications: true },
    });
    const auditBase = {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      actorId: actor.id,
      reason: reason.trim(),
      previousStatus: rule.status,
      nextStatus: rule.status,
    };
    await transaction.statutoryRuleLifecycleAudit.createMany({
      data: [
        { ...auditBase, action: "RULESET_REGISTERED", evidenceDigest: result.evidenceDigest },
        { ...auditBase, action: "CALCULATION_VERIFIED", evidenceDigest: calculationAuditDigest },
        { ...auditBase, action: "READY_FOR_REVIEW", evidenceDigest: result.evidenceDigest },
      ],
    });
    return { scheme: pack.registry.scheme, ruleSetId: rule.id, status: "REGISTERED" as const };
  }, { isolationLevel: "Serializable" });
}

export async function recordStatutoryComponentReviewDecision(
  input: {
    ruleSetId: string;
    classificationId: string;
    decision: StatutoryComponentReviewDecisionValue;
    evidenceReference: string;
    reason: string;
    expectedEvidenceDigest: string;
    expectedReviewRevision: number;
    actor: StatutoryHumanActor;
  },
  database: GovernanceDatabase = prisma,
) {
  const saved = await recordStatutoryComponentReviewDecisions({
    ruleSetId: input.ruleSetId,
    decisions: [{
      classificationId: input.classificationId,
      decision: input.decision,
      evidenceReference: input.evidenceReference,
      reason: input.reason,
    }],
    expectedEvidenceDigest: input.expectedEvidenceDigest,
    expectedReviewRevision: input.expectedReviewRevision,
    actor: input.actor,
  }, database);
  return {
    decision: saved.decisions[0],
    humanClassificationDigest: saved.humanClassificationDigest,
    reviewRevision: saved.reviewRevision,
  };
}

export async function recordStatutoryComponentReviewDecisions(
  input: {
    ruleSetId: string;
    decisions: Array<{
      classificationId: string;
      decision: StatutoryComponentReviewDecisionValue;
      evidenceReference: string;
      reason: string;
    }>;
    expectedEvidenceDigest: string;
    expectedReviewRevision: number;
    actor: StatutoryHumanActor;
  },
  database: GovernanceDatabase = prisma,
) {
  assertReviewActor(input.actor);
  if (input.decisions.length === 0) {
    throw new Error("STATUTORY_REVIEW_DECISION_REQUIRED");
  }
  const classificationIds = new Set<string>();
  for (const decision of input.decisions) {
    assertReason(decision.reason);
    if (decision.evidenceReference.trim().length < 5) {
      throw new Error("STATUTORY_REVIEW_EVIDENCE_REFERENCE_REQUIRED");
    }
    if (classificationIds.has(decision.classificationId)) {
      throw new Error("STATUTORY_REVIEW_DUPLICATE_CLASSIFICATION");
    }
    classificationIds.add(decision.classificationId);
  }
  return database.$transaction(async (transaction) => {
    await assertStoredReviewActor(transaction, input.actor);
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: {
        classifications: { include: { reviewDecisions: { orderBy: { decisionRevision: "asc" } } } },
        reviewDecisions: true,
      },
    });
    if (!isHumanReviewState(rule)) {
      throw new Error("STATUTORY_HUMAN_REVIEW_REQUIRED_STATE");
    }
    if (rule.humanReviewStatus === "COMPLETED") {
      throw new Error("STATUTORY_HUMAN_REVIEW_ALREADY_COMPLETED");
    }
    if (rule.humanReviewRevision !== input.expectedReviewRevision) {
      throw new Error("STATUTORY_HUMAN_REVIEW_STALE");
    }
    const currentEvidenceDigest = statutoryRuleEvidenceDigest(rule);
    if (currentEvidenceDigest !== input.expectedEvidenceDigest) {
      throw new Error("STATUTORY_HUMAN_REVIEW_STALE");
    }
    const reviewedAt = new Date();
    const created = [];
    for (const requestedDecision of input.decisions) {
      const classification = rule.classifications.find(
        (item) => item.id === requestedDecision.classificationId,
      );
      if (!classification || classification.treatment !== "UNKNOWN") {
        throw new Error("STATUTORY_UNKNOWN_CLASSIFICATION_REQUIRED");
      }
      assertArrearsDecision(classification.componentCode, requestedDecision.decision);
      const decisionRevision = (classification.reviewDecisions.at(-1)?.decisionRevision ?? 0) + 1;
      const blockingScope = classificationBlockingScope({
        componentCode: classification.componentCode,
        currentTreatment: classification.treatment,
        latestDecision: requestedDecision.decision,
      }) ?? "CONDITIONAL_RUNTIME_BLOCKER";
      const decisionDigest = canonicalDigest({
        ruleSetId: rule.id,
        classificationId: classification.id,
        scheme: rule.scheme,
        componentCode: classification.componentCode,
        classificationRevision: rule.classificationVersion,
        previousClassification: classification.treatment,
        decision: requestedDecision.decision,
        blockingScope,
        evidenceReference: requestedDecision.evidenceReference.trim(),
        reason: requestedDecision.reason.trim(),
        reviewerUserId: input.actor.id,
        reviewedAt: reviewedAt.toISOString(),
        decisionRevision,
        evidenceDigest: currentEvidenceDigest,
      });
      created.push(await transaction.statutoryComponentReviewDecision.create({
        data: {
          ruleSetId: rule.id,
          classificationId: classification.id,
          scheme: rule.scheme,
          componentCode: classification.componentCode,
          classificationRevision: rule.classificationVersion ?? rule.version,
          previousClassification: classification.treatment,
          decision: requestedDecision.decision,
          blockingScope,
          evidenceReference: requestedDecision.evidenceReference.trim(),
          reason: requestedDecision.reason.trim(),
          reviewerUserId: input.actor.id,
          reviewedAt,
          decisionRevision,
          evidenceDigest: currentEvidenceDigest,
          decisionDigest,
        },
      }));
    }
    const latest = latestDecisions([
      ...rule.classifications.flatMap((item) => item.reviewDecisions),
      ...created,
    ]);
    const humanClassificationDigest = humanDecisionDigest(rule.classificationDigest, latest);
    const nextRevision = rule.humanReviewRevision + 1;
    const update = await transaction.statutoryRuleSet.updateMany({
      where: { id: rule.id, humanReviewRevision: input.expectedReviewRevision },
      data: {
        humanReviewStatus: "IN_PROGRESS",
        humanReviewRevision: nextRevision,
        humanClassificationDigest,
        humanReviewStartedAt: rule.humanReviewStartedAt ?? reviewedAt,
        humanReviewStartedById: rule.humanReviewStartedById ?? input.actor.id,
      },
    });
    if (update.count !== 1) throw new Error("STATUTORY_HUMAN_REVIEW_STALE");
    if (rule.humanReviewStatus === "PENDING") {
      await writeReviewAudit(
        transaction,
        rule,
        "HUMAN_REVIEW_STARTED",
        input.actor.id,
        `Started HR review with ${created.length} payroll item decision(s).`,
        humanClassificationDigest,
      );
    }
    for (let index = 0; index < created.length; index += 1) {
      const requestedDecision = input.decisions[index];
      const savedDecision = created[index];
      await writeReviewAudit(transaction, rule,
        requestedDecision.decision === "KEEP_UNKNOWN"
          ? "COMPONENT_CLASSIFICATION_KEPT_UNKNOWN"
          : "COMPONENT_CLASSIFICATION_REVIEWED",
        input.actor.id, requestedDecision.reason, savedDecision.decisionDigest);
    }
    return { decisions: created, humanClassificationDigest, reviewRevision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

export async function completeStatutoryHumanReview(
  input: {
    ruleSetId: string;
    reason: string;
    expectedEvidenceDigest: string;
    expectedReviewRevision: number;
    actor: StatutoryHumanActor;
  },
  database: GovernanceDatabase = prisma,
) {
  assertReviewActor(input.actor);
  assertReason(input.reason);
  return database.$transaction(async (transaction) => {
    await assertStoredReviewActor(transaction, input.actor);
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: {
        classifications: { include: { reviewDecisions: { orderBy: { decisionRevision: "asc" } } } },
        reviewDecisions: true,
      },
    });
    const pcbReviewDraft = isPcbReviewDraft(rule);
    const canCompleteReview = pcbReviewDraft ||
      (rule.status === "READY_FOR_HUMAN_SIGN_OFF" && rule.readiness === "CALCULATION_VERIFIED");
    if (!canCompleteReview) {
      throw new Error("STATUTORY_HUMAN_REVIEW_REQUIRED_STATE");
    }
    if (rule.humanReviewStatus !== "IN_PROGRESS") {
      throw new Error("STATUTORY_HUMAN_REVIEW_NOT_IN_PROGRESS");
    }
    if (rule.humanReviewRevision !== input.expectedReviewRevision ||
      statutoryRuleEvidenceDigest(rule) !== input.expectedEvidenceDigest) {
      throw new Error("STATUTORY_HUMAN_REVIEW_STALE");
    }
    const missing = rule.classifications.filter(
      (item) => item.treatment === "UNKNOWN" && item.reviewDecisions.length === 0,
    );
    if (missing.length > 0) {
      throw new Error(`STATUTORY_UNKNOWN_REVIEW_INCOMPLETE:${missing.map((item) => item.componentCode).sort().join(",")}`);
    }
    const latest = latestDecisions(rule.classifications.flatMap((item) => item.reviewDecisions));
    const humanClassificationDigest = humanDecisionDigest(rule.classificationDigest, latest);
    const completedAt = new Date();
    const nextRevision = rule.humanReviewRevision + 1;
    const updated = await transaction.statutoryRuleSet.update({
      where: { id: rule.id },
      data: {
        humanReviewStatus: "COMPLETED",
        humanReviewRevision: nextRevision,
        humanClassificationDigest,
        humanReviewCompletedAt: completedAt,
        humanReviewCompletedById: input.actor.id,
      },
    });
    await writeReviewAudit(transaction, rule, "HUMAN_REVIEW_COMPLETED", input.actor.id,
      input.reason, humanClassificationDigest);
    return { rule: updated, humanClassificationDigest, reviewRevision: nextRevision };
  }, { isolationLevel: "Serializable" });
}

function pcbReviewDraftClassificationRows(
  pack: StatutoryHumanReviewPackage,
  sourceReference: string,
) {
  const rows = new Map<string, Prisma.StatutoryComponentClassificationCreateWithoutRuleSetInput>();
  for (const entry of pack.classification.entries) {
    rows.set(entry.componentCode, {
      scheme: "PCB",
      componentCode: entry.componentCode,
      sourceType: null,
      treatment: pcbTreatment(entry.treatments.PCB),
      pcbNature: pcbNature(entry.treatments.PCB),
      effectiveFrom: new Date(`${pack.effectiveFrom}T00:00:00.000Z`),
      effectiveTo: pack.effectiveTo
        ? new Date(`${pack.effectiveTo}T00:00:00.000Z`)
        : null,
      evidenceStatus: entry.treatments.PCB === "UNKNOWN" || entry.humanDecisionRequired
        ? "NEEDS_EVIDENCE"
        : "REVIEWED",
      evidenceReference: entry.officialEvidence.join("; ") || sourceReference,
      semanticMetadata: {
        officialTreatment: entry.treatments.PCB ?? "UNKNOWN",
        humanReviewStatus: entry.humanReviewStatus,
        humanDecisionRequired: entry.humanDecisionRequired,
      },
      rationale: limitedText(entry.reason || "PCB pay-item treatment requires HR review.", 500),
      authorityRef: limitedText(entry.officialEvidence.join("; ") || sourceReference, 500),
    });
  }
  for (const componentCode of pack.unknownComponents) {
    const existing = rows.get(componentCode);
    if (existing) {
      existing.treatment = "UNKNOWN";
      existing.pcbNature = "UNKNOWN";
      existing.evidenceStatus = "NEEDS_EVIDENCE";
      continue;
    }
    rows.set(componentCode, {
      scheme: "PCB",
      componentCode,
      sourceType: null,
      treatment: "UNKNOWN",
      pcbNature: "UNKNOWN",
      effectiveFrom: new Date(`${pack.effectiveFrom}T00:00:00.000Z`),
      effectiveTo: pack.effectiveTo
        ? new Date(`${pack.effectiveTo}T00:00:00.000Z`)
        : null,
      evidenceStatus: "NEEDS_EVIDENCE",
      evidenceReference: sourceReference,
      rationale: "PCB treatment is not proven by the retained official evidence.",
      authorityRef: sourceReference,
    });
  }
  return [...rows.values()].sort((left, right) => left.componentCode.localeCompare(right.componentCode));
}

function pcbNature(value: string | undefined) {
  if (value === "NORMAL_REMUNERATION" || value === "INCLUDED") return "NORMAL_TAXABLE" as const;
  if (value === "ADDITIONAL_REMUNERATION") return "ADDITIONAL_TAXABLE" as const;
  if (value === "EXCLUDED") return "EXCLUDED" as const;
  return "UNKNOWN" as const;
}

function pcbTreatment(value: string | undefined): StatutoryComponentTreatment {
  if (value === "NORMAL_REMUNERATION" || value === "INCLUDED") return "INCLUDED";
  if (value === "ADDITIONAL_REMUNERATION") return "ADDITIONAL_REMUNERATION";
  if (value === "EXCLUDED") return "EXCLUDED";
  return "UNKNOWN";
}

function isHumanReviewState(rule: {
  scheme: StatutoryScheme;
  status: string;
  readiness: string;
  ruleData: Prisma.JsonValue | null;
}) {
  return (rule.status === "READY_FOR_HUMAN_SIGN_OFF" && rule.readiness === "CALCULATION_VERIFIED") ||
    isPcbReviewDraft(rule);
}

function isPcbReviewDraft(rule: {
  scheme: StatutoryScheme;
  status: string;
  readiness: string;
  ruleData: Prisma.JsonValue | null;
}) {
  return rule.scheme === "PCB" && rule.status === "ENGINEERING_VERIFIED" &&
    rule.readiness === "DATASET_VERIFIED" &&
    (rule.ruleData as { reviewDraft?: unknown } | null)?.reviewDraft === true;
}

function limitedText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function statutoryClassificationGovernance(
  classifications: ClassificationWithDecisions[],
) {
  return classifications.map((classification) => {
    const latestDecision = classification.reviewDecisions.at(-1) ?? null;
    return {
      classification,
      latestDecision,
      effectiveTreatment: effectiveClassificationTreatment({
        currentTreatment: classification.treatment,
        latestDecision: latestDecision?.decision ?? null,
      }),
      blockingScope: classificationBlockingScope({
        componentCode: classification.componentCode,
        currentTreatment: classification.treatment,
        latestDecision: latestDecision?.decision ?? null,
      }),
    };
  });
}

function candidateClassificationRows(pack: StatutoryEvidencePackInput, sourceReference: string) {
  const rows = new Map<string, Prisma.StatutoryComponentClassificationCreateWithoutRuleSetInput>();
  for (const raw of pack.classification.classifications) {
    const treatment = candidateTreatment(raw, pack.registry.scheme);
    const officialBasis = Array.isArray(raw.officialBasis)
      ? raw.officialBasis.filter((value): value is string => typeof value === "string")
      : [];
    rows.set(raw.componentCode, {
      scheme: pack.registry.scheme as StatutoryScheme,
      componentCode: raw.componentCode,
      sourceType: null,
      treatment,
      rationale: textValue(raw.rationale) ?? textValue(raw.notes) ??
        textValue(raw.technicalRecommendation) ?? "Human classification review required.",
      authorityRef: officialBasis.length > 0 ? officialBasis.join("; ") : sourceReference,
    });
  }
  for (const componentCode of pack.classification.unresolvedComponents) {
    if (!rows.has(componentCode)) {
      rows.set(componentCode, {
        scheme: pack.registry.scheme as StatutoryScheme,
        componentCode,
        sourceType: null,
        treatment: "UNKNOWN",
        rationale: "No final legal treatment is encoded; human evidence review is required.",
        authorityRef: sourceReference,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.componentCode.localeCompare(b.componentCode));
}

function candidateTreatment(raw: Record<string, unknown>, scheme: EvidencePackScheme) {
  const value = scheme === "LINDUNG24" ? raw.treatment : raw[scheme];
  if (value === "INCLUDED" || value === "EXCLUDED" || value === "UNKNOWN" ||
    value === "ADDITIONAL_REMUNERATION") return value;
  return "UNKNOWN";
}

function activationEvidence(
  pack: StatutoryEvidencePackInput,
  artifactSha256: string,
  unresolvedBlockers: string[],
): RuleActivationEvidence {
  return {
    scheme: pack.registry.scheme,
    ruleVersion: pack.classification.version,
    effectiveFrom: pack.registry.effectiveFrom,
    effectiveTo: pack.registry.effectiveTo,
    artifactStatus: "VERIFIED",
    datasetStatus: pack.dataset.verificationStatus,
    independentReviewStatus: pack.review.status,
    fixtureStatus: pack.fixtures.verificationStatus,
    classificationStatus: "READY_FOR_HUMAN_SIGN_OFF",
    classificationApprovalStatus: "READY_FOR_HUMAN_SIGN_OFF",
    classificationApprovalRecordDigest: null,
    classificationApprovedByActorId: null,
    classificationApprovedAt: null,
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256,
    datasetDigest: pack.dataset.datasetDigest,
    independentReviewDigest: pack.review.reviewDigest,
    fixtureDigest: pack.fixtures.fixtureDigest,
    classificationVersion: pack.classification.version,
    classificationDigest: pack.classification.classificationDigest,
    parserName: pack.dataset.parserName,
    parserVersion: pack.dataset.parserVersion,
    calculatorVersion: pack.registry.calculatorVersion,
    calculatorTestDigest: pack.registry.calculatorTestDigest,
    datasetRowCount: pack.dataset.rows.length,
    goldenFixtureCount: pack.fixtures.fixtures.length,
    unresolvedBlockers,
  };
}

function engineeringEvidence(evidence: RuleActivationEvidence) {
  const value: Partial<RuleActivationEvidence> = { ...evidence };
  delete value.classificationApprovalStatus;
  delete value.classificationApprovalRecordDigest;
  delete value.classificationApprovedByActorId;
  delete value.classificationApprovedAt;
  delete value.unresolvedBlockers;
  return value;
}

function latestDecisions<T extends { classificationId: string; decisionRevision: number }>(values: T[]) {
  const latest = new Map<string, T>();
  for (const value of values) {
    const current = latest.get(value.classificationId);
    if (!current || current.decisionRevision < value.decisionRevision) latest.set(value.classificationId, value);
  }
  return [...latest.values()].sort((a, b) => a.classificationId.localeCompare(b.classificationId));
}

function humanDecisionDigest(
  baseClassificationDigest: string | null,
  decisions: Array<{ classificationId: string; decisionRevision: number; decisionDigest: string }>,
) {
  return canonicalDigest({
    baseClassificationDigest,
    decisions: decisions.map((item) => ({
      classificationId: item.classificationId,
      decisionRevision: item.decisionRevision,
      decisionDigest: item.decisionDigest,
    })),
  });
}

async function writeReviewAudit(
  transaction: Prisma.TransactionClient,
  rule: { id: string; scheme: StatutoryScheme; version: string; status: Prisma.StatutoryRuleSetUncheckedUpdateInput["status"] },
  action: "HUMAN_REVIEW_STARTED" | "COMPONENT_CLASSIFICATION_REVIEWED" |
    "COMPONENT_CLASSIFICATION_KEPT_UNKNOWN" | "HUMAN_REVIEW_COMPLETED",
  actorId: string,
  reason: string,
  evidenceDigest: string,
) {
  await transaction.statutoryRuleLifecycleAudit.create({
    data: {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      action,
      actorId,
      reason: reason.trim(),
      evidenceDigest,
      previousStatus: rule.status as never,
      nextStatus: rule.status as never,
    },
  });
}

function assertRegistrationActor(actor: RegistrationActor) {
  if (actor.role !== "PLATFORM_ADMIN" || !actor.id.trim() ||
    (actor.actorType !== "SYSTEM" && actor.actorType !== "SCRIPT")) {
    throw new Error("STATUTORY_REGISTRATION_ACTOR_REQUIRED");
  }
}

function assertReviewActor(actor: StatutoryHumanActor) {
  if (actor.role !== "PLATFORM_ADMIN" || actor.actorType !== "HUMAN_USER" ||
    !actor.capabilities.includes(REVIEW_STATUTORY_CLASSIFICATION)) {
    throw new Error(`STATUTORY_CAPABILITY_REQUIRED:${REVIEW_STATUTORY_CLASSIFICATION}`);
  }
}

async function assertStoredReviewActor(
  transaction: Prisma.TransactionClient,
  actor: StatutoryHumanActor,
) {
  const user = await transaction.user.findUnique({
    where: { id: actor.id },
    select: { role: true, status: true, loginEnabled: true, permissions: true },
  });
  if (!user || user.role !== "PLATFORM_ADMIN" || user.status !== "active" ||
    !user.loginEnabled || !user.permissions.includes(REVIEW_STATUTORY_CLASSIFICATION)) {
    throw new Error(`STATUTORY_CAPABILITY_REQUIRED:${REVIEW_STATUTORY_CLASSIFICATION}`);
  }
}

function assertReason(reason: string) {
  if (reason.trim().length < 10) throw new Error("STATUTORY_REVIEW_REASON_REQUIRED");
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
