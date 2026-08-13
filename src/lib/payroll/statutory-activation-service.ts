import type { Prisma, PrismaClient, StatutoryRuleSetStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeSensitiveActionAuthorizationInTransaction } from "@/lib/auth/sensitive-action-service";
import {
  getSensitiveActionPolicy,
  TRUE_MFA_CAPABILITY,
} from "@/lib/auth/sensitive-actions";
import {
  STATUTORY_REVIEW_CHECKLIST_VERSION,
  completeStatutoryReviewChecklistAnswers,
} from "./statutory-human-review";
import { classificationBlockingScope } from "./statutory-classification-policy";
import {
  STATUTORY_ARTIFACT_ERRORS,
  assertRuleEngineeringReady,
  canonicalDigest,
  prepareControlledActivation,
  type RuleActivationEvidence,
} from "./statutory-artifact-pipeline";

export { STATUTORY_REVIEW_CHECKLIST_VERSION } from "./statutory-human-review";
export const SIGN_OFF_STATUTORY_RULESET = "SIGN_OFF_STATUTORY_RULESET";
export const ACTIVATE_STATUTORY_RULESET = "ACTIVATE_STATUTORY_RULESET";

type PlatformActor = { id: string; role: string };
export type StatutoryHumanActor = PlatformActor & {
  actorType: "HUMAN_USER" | "SYSTEM" | "SCRIPT" | "CODEX" | "TEST_RUNNER" | "AUTOMATION";
  capabilities: readonly string[];
};
type StatutoryDatabase = Pick<PrismaClient, "$transaction" | "statutoryRuleSet">;

type DigestibleRule = {
  id: string;
  scheme: string;
  version: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  authority: string;
  sourceReference: string;
  sourceDocumentName: string;
  sourceDigest: string | null;
  datasetDigest: string | null;
  goldenFixtureDigest: string | null;
  independentReviewDigest: string | null;
  classificationVersion: string | null;
  classificationDigest: string | null;
  parserName: string | null;
  parserVersion: string | null;
  calculatorVersion: string | null;
  calculatorTestDigest: string | null;
  datasetRowCount: number | null;
  readiness: string;
  humanReviewStatus?: string;
  humanReviewRevision?: number;
  humanClassificationDigest?: string | null;
  ruleData: unknown;
  verificationEvidence?: unknown;
  classifications: Array<{
    scheme: string;
    componentCode: string;
    sourceType: string | null;
    treatment: string;
    rationale: string;
    authorityRef: string;
  }>;
  reviewDecisions?: Array<{
    classificationId: string;
    componentCode: string;
    classificationRevision: string;
    previousClassification: string;
    decision: string;
    blockingScope: string;
    evidenceReference: string;
    reason: string;
    reviewerUserId: string;
    reviewedAt: Date;
    decisionRevision: number;
    evidenceDigest: string;
    decisionDigest: string;
  }>;
};

export function statutoryRuleEvidenceDigest(rule: DigestibleRule) {
  const verificationEvidence = rule.verificationEvidence as Partial<RuleActivationEvidence> | null;
  return canonicalDigest({
    ruleSetId: rule.id,
    scheme: rule.scheme,
    version: rule.version,
    effectiveFrom: dateOnly(rule.effectiveFrom),
    effectiveTo: rule.effectiveTo ? dateOnly(rule.effectiveTo) : null,
    authority: rule.authority,
    sourceReference: rule.sourceReference,
    sourceDocumentName: rule.sourceDocumentName,
    officialArtifactHash: rule.sourceDigest,
    parserVersion: rule.parserVersion,
    datasetVersion: (rule.ruleData as { id?: unknown } | null)?.id ?? null,
    datasetDigest: rule.datasetDigest,
    goldenFixtureDigest: rule.goldenFixtureDigest,
    independentReviewDigest: rule.independentReviewDigest,
    calculatorVersion: rule.calculatorVersion,
    calculatorTestDigest: rule.calculatorTestDigest,
    goldenFixtureCount: verificationEvidence?.goldenFixtureCount ?? null,
    classificationVersion: rule.classificationVersion,
    classificationDigest: rule.classificationDigest,
    eligibilityLogicRevision:
      (rule.ruleData as { eligibilityLogicRevision?: unknown } | null)?.eligibilityLogicRevision ??
      verificationEvidence?.ruleVersion ?? null,
    datasetRowCount: rule.datasetRowCount,
    readiness: rule.readiness,
    humanReviewStatus: rule.humanReviewStatus ?? "PENDING",
    humanReviewRevision: rule.humanReviewRevision ?? 0,
    humanClassificationDigest: rule.humanClassificationDigest ?? null,
    classifications: [...rule.classifications]
      .sort((left, right) =>
        `${left.scheme}:${left.componentCode}:${left.sourceType ?? ""}`.localeCompare(
          `${right.scheme}:${right.componentCode}:${right.sourceType ?? ""}`,
        ),
      )
      .map((item) => ({
        scheme: item.scheme,
        componentCode: item.componentCode,
        sourceType: item.sourceType,
        treatment: item.treatment,
        rationale: item.rationale,
        authorityRef: item.authorityRef,
      })),
    reviewDecisions: [...(rule.reviewDecisions ?? [])]
      .sort((left, right) =>
        `${left.classificationId}:${left.decisionRevision}`.localeCompare(
          `${right.classificationId}:${right.decisionRevision}`,
        ),
      )
      .map((item) => ({
        classificationId: item.classificationId,
        componentCode: item.componentCode,
        classificationRevision: item.classificationRevision,
        previousClassification: item.previousClassification,
        decision: item.decision,
        blockingScope: item.blockingScope,
        evidenceReference: item.evidenceReference,
        reason: item.reason,
        reviewerUserId: item.reviewerUserId,
        reviewedAt: item.reviewedAt.toISOString(),
        decisionRevision: item.decisionRevision,
        evidenceDigest: item.evidenceDigest,
        decisionDigest: item.decisionDigest,
      })),
  });
}

export async function recordStatutoryCalculationVerification(
  input: {
    ruleSetId: string;
    actor: PlatformActor;
    reason: string;
    evidence: RuleActivationEvidence;
  },
  database: StatutoryDatabase = prisma,
) {
  assertPlatformActor(input.actor);
  assertLifecycleReason(input.reason);
  assertRuleEngineeringReady(input.evidence);

  return database.$transaction(
    async (transaction) => {
      const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
        where: { id: input.ruleSetId },
      });
      assertRuleIdentity(rule, input.evidence);
      if (rule.status !== "DRAFT" && rule.status !== "ENGINEERING_VERIFIED") {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
      }
      const evidenceDigest = canonicalDigest({
        action: "CALCULATION_VERIFIED",
        actorId: input.actor.id,
        reason: input.reason.trim(),
        evidence: engineeringEvidence(input.evidence),
      });
      const verifiedAt = new Date();
      const updated = await transaction.statutoryRuleSet.update({
        where: { id: rule.id },
        data: {
          sourceDigest: input.evidence.artifactSha256,
          datasetDigest: input.evidence.datasetDigest,
          goldenFixtureDigest: input.evidence.fixtureDigest,
          independentReviewDigest: input.evidence.independentReviewDigest,
          classificationVersion: input.evidence.classificationVersion,
          classificationDigest: input.evidence.classificationDigest,
          parserName: input.evidence.parserName,
          parserVersion: input.evidence.parserVersion,
          calculatorVersion: input.evidence.calculatorVersion,
          calculatorTestDigest: input.evidence.calculatorTestDigest,
          datasetRowCount: input.evidence.datasetRowCount,
          verificationEvidence: input.evidence as unknown as Prisma.InputJsonValue,
          readiness: "CALCULATION_VERIFIED",
          status: "READY_FOR_HUMAN_SIGN_OFF",
          calculationVerifiedAt: verifiedAt,
          calculationVerifiedById: input.actor.id,
        },
      });
      await writeLifecycleAudit(transaction, {
        ruleSetId: rule.id,
        scheme: rule.scheme,
        ruleVersion: rule.version,
        action: "CALCULATION_VERIFIED",
        actorId: input.actor.id,
        reason: input.reason.trim(),
        evidenceDigest,
        previousStatus: rule.status,
        nextStatus: updated.status,
      });
      await writeLifecycleAudit(transaction, {
        ruleSetId: rule.id,
        scheme: rule.scheme,
        ruleVersion: rule.version,
        action: "READY_FOR_REVIEW",
        actorId: input.actor.id,
        reason: input.reason.trim(),
        evidenceDigest,
        previousStatus: updated.status,
        nextStatus: updated.status,
      });
      return { rule: updated, evidenceDigest };
    },
    { isolationLevel: "Serializable" },
  );
}

export async function signOffStatutoryRule(
  input: {
    ruleSetId: string;
    actor: StatutoryHumanActor;
    reason: string;
    expectedEvidenceDigest: string;
    reviewChecklistVersion?: string;
    reviewChecklistAnswers?: Record<string, boolean>;
    /** Legacy callers may still pass a display reference; it never satisfies MFA. */
    stepUpReference?: string;
    stepUpAuthorization?: { sessionId: string; rawToken: string | null | undefined };
  },
  database: StatutoryDatabase = prisma,
) {
  assertHumanCapability(input.actor, SIGN_OFF_STATUTORY_RULESET);
  assertLifecycleReason(input.reason);
  return database.$transaction(async (transaction) => {
    await assertStoredHumanActor(transaction, input.actor, SIGN_OFF_STATUTORY_RULESET);
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: { classifications: true, reviewDecisions: true },
    });
    if (
      rule.status !== "READY_FOR_HUMAN_SIGN_OFF" ||
      rule.readiness !== "CALCULATION_VERIFIED"
    ) {
      throw new Error("HUMAN_SIGN_OFF_REQUIRED_STATE");
    }
    const evidenceDigest = statutoryRuleEvidenceDigest(rule);
    if (evidenceDigest !== input.expectedEvidenceDigest) {
      throw new Error("SIGN_OFF_STALE");
    }
    if (rule.humanReviewStatus !== "COMPLETED") {
      throw new Error("STATUTORY_HUMAN_REVIEW_INCOMPLETE");
    }
    if (hasGlobalClassificationBlocker(rule.classifications, rule.reviewDecisions)) {
      throw new Error("COMPONENT_CLASSIFICATION_REQUIRED");
    }
    assertStatutoryMfaReady("STATUTORY_RULESET_SIGNOFF");
    if (!input.stepUpAuthorization) throw new Error("MFA_REQUIRED");
    const stepUp = await consumeSensitiveActionAuthorizationInTransaction(
      {
        userId: input.actor.id,
        sessionId: input.stepUpAuthorization.sessionId,
        actionKey: "STATUTORY_RULESET_SIGNOFF",
        resourceType: "STATUTORY_RULESET",
        resourceId: rule.id,
        businessId: null,
        requestFingerprint: input.expectedEvidenceDigest,
        rawToken: input.stepUpAuthorization.rawToken,
      },
      transaction,
    );
    const stepUpReference = stepUp.id;
    const checklistAnswers = input.reviewChecklistAnswers ??
      completeStatutoryReviewChecklistAnswers();
    if (Object.values(checklistAnswers).some((answer) => answer !== true)) {
      throw new Error("STATUTORY_REVIEW_CHECKLIST_INCOMPLETE");
    }
    const humanClassificationDigest = rule.humanClassificationDigest ??
      rule.classificationDigest;
    if (!humanClassificationDigest) throw new Error("COMPONENT_CLASSIFICATION_REQUIRED");
    const signedAt = new Date();
    const signOff = await transaction.statutoryRuleSetSignOff.create({
      data: {
        ruleSetId: rule.id,
        scheme: rule.scheme,
        decision: "APPROVED",
        actorUserId: input.actor.id,
        actorRole: input.actor.role,
        actorCapabilities: [...input.actor.capabilities].sort(),
        signedAt,
        evidenceDigest,
        reviewChecklistVersion:
          input.reviewChecklistVersion ?? STATUTORY_REVIEW_CHECKLIST_VERSION,
        reviewChecklistAnswers: checklistAnswers,
        classificationRevision: rule.humanReviewRevision,
        humanClassificationDigest,
        stepUpReference,
        reason: input.reason.trim(),
      },
    });
    const updated = await transaction.statutoryRuleSet.update({
      where: { id: rule.id },
      data: { status: "HUMAN_SIGNED_OFF" },
    });
    await writeLifecycleAudit(transaction, {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      action: "SIGNED_OFF",
      actorId: input.actor.id,
      reason: input.reason.trim(),
      evidenceDigest,
      previousStatus: rule.status,
      nextStatus: updated.status,
    });
    return { rule: updated, signOff, evidenceDigest };
  }, { isolationLevel: "Serializable" });
}

export async function revokeStatutoryRuleSignOff(
  input: {
    ruleSetId: string;
    actor: StatutoryHumanActor;
    reason: string;
    expectedEvidenceDigest: string;
  },
  database: StatutoryDatabase = prisma,
) {
  assertHumanCapability(input.actor, SIGN_OFF_STATUTORY_RULESET);
  assertLifecycleReason(input.reason);
  return database.$transaction(async (transaction) => {
    await assertStoredHumanActor(transaction, input.actor, SIGN_OFF_STATUTORY_RULESET);
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: {
        classifications: true,
        reviewDecisions: true,
        signOffs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (rule.status !== "HUMAN_SIGNED_OFF") throw new Error("SIGN_OFF_NOT_REVOCABLE");
    const approved = rule.signOffs.find((item) => item.decision === "APPROVED");
    if (!approved || approved.evidenceDigest !== input.expectedEvidenceDigest) {
      throw new Error("SIGN_OFF_STALE");
    }
    const revokedAt = new Date();
    const revocation = await transaction.statutoryRuleSetSignOff.create({
      data: {
        ruleSetId: rule.id,
        scheme: rule.scheme,
        decision: "REVOKED",
        actorUserId: input.actor.id,
        actorRole: input.actor.role,
        actorCapabilities: [...input.actor.capabilities].sort(),
        signedAt: revokedAt,
        evidenceDigest: approved.evidenceDigest,
        reviewChecklistVersion: approved.reviewChecklistVersion,
        reviewChecklistAnswers: approved.reviewChecklistAnswers as Prisma.InputJsonValue,
        classificationRevision: approved.classificationRevision,
        humanClassificationDigest: approved.humanClassificationDigest,
        stepUpReference: approved.stepUpReference,
        reason: input.reason.trim(),
      },
    });
    const updated = await transaction.statutoryRuleSet.update({
      where: { id: rule.id },
      data: { status: "READY_FOR_HUMAN_SIGN_OFF" },
    });
    await writeLifecycleAudit(transaction, {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      action: "SIGNOFF_REVOKED",
      actorId: input.actor.id,
      reason: input.reason.trim(),
      evidenceDigest: approved.evidenceDigest,
      previousStatus: rule.status,
      nextStatus: updated.status,
    });
    return { rule: updated, revocation };
  }, { isolationLevel: "Serializable" });
}

export async function activateStatutoryRule(
  input: {
    ruleSetId: string;
    actor: StatutoryHumanActor;
    reason: string;
    expectedScheme: RuleActivationEvidence["scheme"];
    expectedRuleVersion: string;
    expectedEffectiveFrom: string;
    expectedEvidenceDigest: string;
    evidence: RuleActivationEvidence;
    stepUpAuthorization?: { sessionId: string; rawToken: string | null | undefined };
  },
  database: StatutoryDatabase = prisma,
) {
  assertHumanCapability(input.actor, ACTIVATE_STATUTORY_RULESET);
  const prepared = prepareControlledActivation({
    actorId: input.actor.id,
    actorRole: input.actor.role,
    actorType: input.actor.actorType,
    actorCapabilities: input.actor.capabilities,
    reviewerActorId: input.evidence.classificationApprovedByActorId,
    reason: input.reason,
    expectedScheme: input.expectedScheme,
    expectedRuleVersion: input.expectedRuleVersion,
    expectedEffectiveFrom: input.expectedEffectiveFrom,
    evidence: input.evidence,
  });

  return database.$transaction(async (transaction) => {
    await assertStoredHumanActor(transaction, input.actor, ACTIVATE_STATUTORY_RULESET);
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
      include: {
        classifications: true,
        reviewDecisions: true,
        signOffs: { orderBy: { createdAt: "desc" } },
      },
    });
    const verificationAudit = await transaction.statutoryRuleLifecycleAudit.findFirst({
      where: { ruleSetId: rule.id, action: "CALCULATION_VERIFIED" },
      orderBy: { createdAt: "desc" },
    });
    assertRuleIdentity(rule, input.evidence);
    assertStoredVerification(rule, input.evidence, verificationAudit);
    const latestDecision = rule.signOffs[0];
    const approved = rule.signOffs.find((item) => item.decision === "APPROVED");
    const currentDigest = statutoryRuleEvidenceDigest(rule);
    if (
      rule.status !== "HUMAN_SIGNED_OFF" ||
      rule.readiness !== "CALCULATION_VERIFIED" ||
      !approved ||
      latestDecision?.decision !== "APPROVED"
    ) throw new Error(STATUTORY_ARTIFACT_ERRORS.HUMAN_CLASSIFICATION_SIGN_OFF_REQUIRED);
    if (
      approved.actorUserId === input.actor.id ||
      input.evidence.classificationApprovedByActorId !== approved.actorUserId
    ) throw new Error("STATUTORY_REVIEWER_ACTIVATOR_SEPARATION_REQUIRED");
    if (
      currentDigest !== approved.evidenceDigest ||
      currentDigest !== input.expectedEvidenceDigest
    ) throw new Error("SIGN_OFF_STALE");
    if (hasGlobalClassificationBlocker(rule.classifications, rule.reviewDecisions)) {
      throw new Error("COMPONENT_CLASSIFICATION_REQUIRED");
    }
    assertStatutoryMfaReady("STATUTORY_RULESET_ACTIVATE");
    if (!input.stepUpAuthorization) throw new Error("MFA_REQUIRED");
    await consumeSensitiveActionAuthorizationInTransaction(
      {
        userId: input.actor.id,
        sessionId: input.stepUpAuthorization.sessionId,
        actionKey: "STATUTORY_RULESET_ACTIVATE",
        resourceType: "STATUTORY_RULESET",
        resourceId: rule.id,
        businessId: null,
        requestFingerprint: input.expectedEvidenceDigest,
        rawToken: input.stepUpAuthorization.rawToken,
      },
      transaction,
    );

    const overlap = await transaction.statutoryRuleSet.findFirst({
      where: {
        id: { not: rule.id },
        scheme: rule.scheme,
        status: "ACTIVE",
        effectiveFrom: { lt: rule.effectiveTo ?? new Date("9999-12-31T00:00:00.000Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: rule.effectiveFrom } }],
      },
      select: { id: true },
    });
    if (overlap) throw new Error("ACTIVE_RULE_OVERLAP");

    const updated = await transaction.statutoryRuleSet.update({
      where: { id: rule.id },
      data: {
        status: "ACTIVE",
        activatedAt: new Date(),
        activatedById: input.actor.id,
        activationReason: prepared.reason,
      },
    });
    await writeLifecycleAudit(transaction, {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      action: "ACTIVATED",
      actorId: input.actor.id,
      reason: prepared.reason,
      evidenceDigest: currentDigest,
      previousStatus: rule.status,
      nextStatus: updated.status,
    });
    return { rule: updated, signOff: approved, ...prepared, evidenceDigest: currentDigest };
  }, { isolationLevel: "Serializable" });
}

export async function activateStoredStatutoryRule(
  input: {
    ruleSetId: string;
    actor: StatutoryHumanActor;
    reason: string;
    expectedEvidenceDigest: string;
    stepUpAuthorization?: { sessionId: string; rawToken: string | null | undefined };
  },
  database: StatutoryDatabase = prisma,
) {
  const rule = await database.statutoryRuleSet.findUniqueOrThrow({
    where: { id: input.ruleSetId },
    include: { signOffs: { where: { decision: "APPROVED" }, orderBy: { createdAt: "desc" } } },
  });
  const evidence = rule.verificationEvidence as RuleActivationEvidence | null;
  const reviewerActorId = rule.signOffs[0]?.actorUserId ?? null;
  if (!evidence || !reviewerActorId) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
  return activateStatutoryRule({
    ...input,
    expectedScheme: rule.scheme,
    expectedRuleVersion: rule.version,
    expectedEffectiveFrom: dateOnly(rule.effectiveFrom),
    evidence: {
      ...evidence,
      classificationApprovalStatus: "HUMAN_SIGNED_OFF",
      classificationApprovalRecordDigest: input.expectedEvidenceDigest,
      classificationApprovedByActorId: reviewerActorId,
      classificationApprovedAt: rule.signOffs[0].signedAt.toISOString(),
      unresolvedBlockers: [],
    },
  }, database);
}

export async function retireStatutoryRule(
  input: { ruleSetId: string; actor: PlatformActor; reason: string },
  database: StatutoryDatabase = prisma,
) {
  assertPlatformActor(input.actor);
  assertLifecycleReason(input.reason);
  return database.$transaction(async (transaction) => {
    const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
      where: { id: input.ruleSetId },
    });
    if (rule.status !== "ACTIVE") {
      throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
    }
    const evidenceDigest = canonicalDigest({
      action: "RETIRED",
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      actorId: input.actor.id,
      reason: input.reason.trim(),
    });
    const updated = await transaction.statutoryRuleSet.update({
      where: { id: rule.id }, data: { status: "RETIRED" },
    });
    await writeLifecycleAudit(transaction, {
      ruleSetId: rule.id,
      scheme: rule.scheme,
      ruleVersion: rule.version,
      action: "RETIRED",
      actorId: input.actor.id,
      reason: input.reason.trim(),
      evidenceDigest,
      previousStatus: rule.status,
      nextStatus: updated.status,
    });
    return { rule: updated, evidenceDigest };
  }, { isolationLevel: "Serializable" });
}

function assertPlatformActor(actor: PlatformActor) {
  if (actor.role !== "PLATFORM_ADMIN" || !actor.id.trim()) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.PLATFORM_ACTOR_REQUIRED);
  }
}

function assertHumanCapability(actor: StatutoryHumanActor, capability: string) {
  assertPlatformActor(actor);
  if (actor.actorType !== "HUMAN_USER") throw new Error("STATUTORY_HUMAN_ACTOR_REQUIRED");
  if (!actor.capabilities.includes(capability)) {
    throw new Error(`STATUTORY_CAPABILITY_REQUIRED:${capability}`);
  }
}

async function assertStoredHumanActor(
  transaction: Prisma.TransactionClient,
  actor: StatutoryHumanActor,
  capability: string,
) {
  const stored = await transaction.user.findUnique({
    where: { id: actor.id },
    select: { role: true, status: true, loginEnabled: true, permissions: true },
  });
  if (
    !stored ||
    stored.role !== "PLATFORM_ADMIN" ||
    stored.status !== "active" ||
    !stored.loginEnabled ||
    !stored.permissions.includes(capability) ||
    !actor.capabilities.includes(capability)
  ) throw new Error(`STATUTORY_CAPABILITY_REQUIRED:${capability}`);
}

function assertLifecycleReason(reason: string) {
  if (reason.trim().length < 10) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.ACTIVATION_REASON_REQUIRED);
  }
}

function assertRuleIdentity(
  rule: { scheme: string; version: string; effectiveFrom: Date; effectiveTo: Date | null },
  evidence: RuleActivationEvidence,
) {
  if (
    rule.scheme !== evidence.scheme ||
    rule.version !== evidence.ruleVersion ||
    dateOnly(rule.effectiveFrom) !== evidence.effectiveFrom ||
    (rule.effectiveTo ? dateOnly(rule.effectiveTo) : null) !== evidence.effectiveTo
  ) throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
}

function assertStoredVerification(
  rule: {
    sourceDigest: string | null; datasetDigest: string | null;
    goldenFixtureDigest: string | null; independentReviewDigest: string | null;
    classificationVersion: string | null; classificationDigest: string | null;
    parserName: string | null; parserVersion: string | null;
    calculatorVersion: string | null; calculatorTestDigest: string | null;
    datasetRowCount: number | null;
  },
  evidence: RuleActivationEvidence,
  verificationAudit: { actorId: string; reason: string; evidenceDigest: string } | null,
) {
  const stored = [rule.sourceDigest, rule.datasetDigest, rule.goldenFixtureDigest,
    rule.independentReviewDigest, rule.classificationVersion, rule.classificationDigest,
    rule.parserName, rule.parserVersion, rule.calculatorVersion,
    rule.calculatorTestDigest, rule.datasetRowCount];
  const expected = [evidence.artifactSha256, evidence.datasetDigest, evidence.fixtureDigest,
    evidence.independentReviewDigest, evidence.classificationVersion,
    evidence.classificationDigest, evidence.parserName, evidence.parserVersion,
    evidence.calculatorVersion, evidence.calculatorTestDigest, evidence.datasetRowCount];
  if (canonicalDigest(stored) !== canonicalDigest(expected)) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
  const expectedAuditDigest = verificationAudit && canonicalDigest({
    action: "CALCULATION_VERIFIED", actorId: verificationAudit.actorId,
    reason: verificationAudit.reason, evidence: engineeringEvidence(evidence),
  });
  if (!verificationAudit || verificationAudit.evidenceDigest !== expectedAuditDigest) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
}

async function writeLifecycleAudit(
  transaction: Prisma.TransactionClient,
  data: Prisma.StatutoryRuleLifecycleAuditUncheckedCreateInput & {
    previousStatus: StatutoryRuleSetStatus;
    nextStatus: StatutoryRuleSetStatus;
  },
) {
  return transaction.statutoryRuleLifecycleAudit.create({ data });
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function engineeringEvidence(evidence: RuleActivationEvidence) {
  const engineering: Partial<RuleActivationEvidence> = { ...evidence };
  delete engineering.classificationApprovalStatus;
  delete engineering.classificationApprovalRecordDigest;
  delete engineering.classificationApprovedByActorId;
  delete engineering.classificationApprovedAt;
  delete engineering.unresolvedBlockers;
  return engineering;
}

function hasGlobalClassificationBlocker(
  classifications: Array<{
    id: string;
    componentCode: string;
    treatment: "INCLUDED" | "EXCLUDED" | "ADDITIONAL_REMUNERATION" | "UNKNOWN";
  }>,
  decisions: Array<{
    classificationId: string;
    decision: "INCLUDED" | "EXCLUDED" | "KEEP_UNKNOWN";
    decisionRevision: number;
  }>,
) {
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const decision of decisions) {
    const current = latest.get(decision.classificationId);
    if (!current || current.decisionRevision < decision.decisionRevision) {
      latest.set(decision.classificationId, decision);
    }
  }
  return classifications.some((classification) =>
    classificationBlockingScope({
      componentCode: classification.componentCode,
      currentTreatment: classification.treatment,
      latestDecision: latest.get(classification.id)?.decision ?? null,
    }) === "GLOBAL_ACTIVATION_BLOCKER",
  );
}

function assertStatutoryMfaReady(
  actionKey: "STATUTORY_RULESET_SIGNOFF" | "STATUTORY_RULESET_ACTIVATE",
) {
  const policy = getSensitiveActionPolicy(actionKey);
  if (
    policy.requiredAssurance !== "MFA" ||
    TRUE_MFA_CAPABILITY.status === "NOT_READY"
  ) {
    throw new Error("STATUTORY_STEP_UP_AUTH_NOT_READY");
  }
}
