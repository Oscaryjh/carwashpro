import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  STATUTORY_ARTIFACT_ERRORS,
  assertRuleActivationReady,
  canonicalDigest,
  prepareControlledActivation,
  type RuleActivationEvidence,
} from "./statutory-artifact-pipeline";

type PlatformActor = { id: string; role: string };
type StatutoryDatabase = Pick<PrismaClient, "$transaction">;

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
  assertRuleActivationReady(input.evidence);
  const evidenceDigest = canonicalDigest({
    action: "CALCULATION_VERIFIED",
    actorId: input.actor.id,
    reason: input.reason.trim(),
    evidence: input.evidence,
  });

  return database.$transaction(
    async (transaction) => {
      const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
        where: { id: input.ruleSetId },
      });
      assertRuleIdentity(rule, input.evidence);
      if (rule.status !== "DRAFT") {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
      }

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
          readiness: "CALCULATION_VERIFIED",
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
      return { rule: updated, evidenceDigest };
    },
    { isolationLevel: "Serializable" },
  );
}

export async function activateStatutoryRule(
  input: {
    ruleSetId: string;
    actor: PlatformActor;
    reason: string;
    expectedScheme: RuleActivationEvidence["scheme"];
    expectedRuleVersion: string;
    expectedEffectiveFrom: string;
    evidence: RuleActivationEvidence;
  },
  database: StatutoryDatabase = prisma,
) {
  const prepared = prepareControlledActivation({
    actorId: input.actor.id,
    actorRole: input.actor.role,
    reason: input.reason,
    expectedScheme: input.expectedScheme,
    expectedRuleVersion: input.expectedRuleVersion,
    expectedEffectiveFrom: input.expectedEffectiveFrom,
    evidence: input.evidence,
  });

  return database.$transaction(
    async (transaction) => {
      const rule = await transaction.statutoryRuleSet.findUniqueOrThrow({
        where: { id: input.ruleSetId },
      });
      const verificationAudit = await transaction.statutoryRuleLifecycleAudit.findFirst({
        where: { ruleSetId: rule.id, action: "CALCULATION_VERIFIED" },
        orderBy: { createdAt: "desc" },
      });
      assertRuleIdentity(rule, input.evidence);
      assertStoredVerification(rule, input.evidence, verificationAudit);
      if (rule.status !== "DRAFT" || rule.readiness !== "CALCULATION_VERIFIED") {
        throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
      }

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
        evidenceDigest: prepared.evidenceDigest,
        previousStatus: rule.status,
        nextStatus: updated.status,
      });
      return { rule: updated, ...prepared };
    },
    { isolationLevel: "Serializable" },
  );
}

export async function retireStatutoryRule(
  input: { ruleSetId: string; actor: PlatformActor; reason: string },
  database: StatutoryDatabase = prisma,
) {
  assertPlatformActor(input.actor);
  assertLifecycleReason(input.reason);
  return database.$transaction(
    async (transaction) => {
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
        where: { id: rule.id },
        data: { status: "RETIRED" },
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
    },
    { isolationLevel: "Serializable" },
  );
}

function assertPlatformActor(actor: PlatformActor) {
  if (actor.role !== "PLATFORM_ADMIN" || !actor.id.trim()) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.PLATFORM_ACTOR_REQUIRED);
  }
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
  ) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
}

function assertStoredVerification(
  rule: {
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
  },
  evidence: RuleActivationEvidence,
  verificationAudit: {
    actorId: string;
    reason: string;
    evidenceDigest: string;
  } | null,
) {
  const stored = [
    rule.sourceDigest,
    rule.datasetDigest,
    rule.goldenFixtureDigest,
    rule.independentReviewDigest,
    rule.classificationVersion,
    rule.classificationDigest,
    rule.parserName,
    rule.parserVersion,
    rule.calculatorVersion,
    rule.calculatorTestDigest,
    rule.datasetRowCount,
  ];
  const expected = [
    evidence.artifactSha256,
    evidence.datasetDigest,
    evidence.fixtureDigest,
    evidence.independentReviewDigest,
    evidence.classificationVersion,
    evidence.classificationDigest,
    evidence.parserName,
    evidence.parserVersion,
    evidence.calculatorVersion,
    evidence.calculatorTestDigest,
    evidence.datasetRowCount,
  ];
  if (canonicalDigest(stored) !== canonicalDigest(expected)) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
  const expectedAuditDigest = verificationAudit && canonicalDigest({
    action: "CALCULATION_VERIFIED",
    actorId: verificationAudit.actorId,
    reason: verificationAudit.reason,
    evidence,
  });
  if (!verificationAudit || verificationAudit.evidenceDigest !== expectedAuditDigest) {
    throw new Error(STATUTORY_ARTIFACT_ERRORS.UNVERIFIED_ACTIVATION);
  }
}

async function writeLifecycleAudit(
  transaction: Prisma.TransactionClient,
  data: Prisma.StatutoryRuleLifecycleAuditUncheckedCreateInput,
) {
  return transaction.statutoryRuleLifecycleAudit.create({ data });
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
