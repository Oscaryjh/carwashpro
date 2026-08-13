import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import {
  recordStatutoryCalculationVerification,
  signOffStatutoryRule,
  statutoryRuleEvidenceDigest,
} from "../../src/lib/payroll/statutory-activation-service";
import type { RuleActivationEvidence } from "../../src/lib/payroll/statutory-artifact-pipeline";

test("database rejects overlapping ACTIVE statutory rules", async () => {
  const firstId = randomUUID();
  const secondId = randomUUID();
  const actorId = randomUUID();
  const suffix = firstId.slice(0, 8);
  await prisma.statutoryRuleSet.create({
    data: {
      id: firstId,
      scheme: "EPF",
      version: `TEST_OVERLAP_A_${suffix}`,
      effectiveFrom: new Date("2098-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2098-12-31T00:00:00.000Z"),
      authority: "TEST_ONLY",
      sourceReference: "test fixture",
      sourceDocumentName: "test fixture",
      status: "ACTIVE",
      readiness: "CALCULATION_VERIFIED",
      sourceDigest: "a".repeat(64),
      datasetDigest: "b".repeat(64),
      goldenFixtureDigest: "c".repeat(64),
      independentReviewDigest: "d".repeat(64),
      classificationVersion: "TEST_CLASSIFICATION_V1",
      classificationDigest: "e".repeat(64),
      parserName: "test-parser",
      parserVersion: "1.0.0",
      calculatorVersion: "1.0.0",
      calculatorTestDigest: "f".repeat(64),
      datasetRowCount: 1,
      calculationVerifiedAt: new Date(),
      calculationVerifiedById: actorId,
      activatedAt: new Date(),
      activatedById: actorId,
      activationReason: "Test-only verified rule activation",
    },
  });
  try {
    await assert.rejects(
      prisma.statutoryRuleSet.create({
        data: {
          id: secondId,
          scheme: "EPF",
          version: `TEST_OVERLAP_B_${suffix}`,
          effectiveFrom: new Date("2098-06-01T00:00:00.000Z"),
          effectiveTo: null,
          authority: "TEST_ONLY",
          sourceReference: "test fixture",
          sourceDocumentName: "test fixture",
          status: "ACTIVE",
          readiness: "CALCULATION_VERIFIED",
          sourceDigest: "d".repeat(64),
          datasetDigest: "e".repeat(64),
          goldenFixtureDigest: "f".repeat(64),
          independentReviewDigest: "1".repeat(64),
          classificationVersion: "TEST_CLASSIFICATION_V1",
          classificationDigest: "2".repeat(64),
          parserName: "test-parser",
          parserVersion: "1.0.0",
          calculatorVersion: "1.0.0",
          calculatorTestDigest: "3".repeat(64),
          datasetRowCount: 1,
          calculationVerifiedAt: new Date(),
          calculationVerifiedById: actorId,
          activatedAt: new Date(),
          activatedById: actorId,
          activationReason: "Test-only overlapping rule activation",
        },
      }),
      /STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP/,
    );
  } finally {
    await prisma.statutoryRuleSet.deleteMany({ where: { id: { in: [firstId, secondId] } } });
  }
});

test("database rejects activation without verified artifact, dataset and golden provenance", async () => {
  await assert.rejects(
    prisma.statutoryRuleSet.create({
      data: {
        scheme: "SOCSO",
        version: `TEST_UNVERIFIED_ACTIVE_${randomUUID()}`,
        effectiveFrom: new Date("2097-01-01T00:00:00.000Z"),
        authority: "TEST_ONLY",
        sourceReference: "test fixture",
        sourceDocumentName: "test fixture",
        status: "ACTIVE",
        readiness: "METADATA_ONLY",
      },
    }),
    /UNVERIFIED_STATUTORY_RULE_CANNOT_ACTIVATE/,
  );
});

test("database keeps ACTIVE artifact provenance immutable while allowing retirement", async () => {
  const id = randomUUID();
  const actorId = randomUUID();
  await prisma.statutoryRuleSet.create({
    data: {
      id,
      scheme: "LINDUNG24",
      version: `TEST_IMMUTABLE_${id.slice(0, 8)}`,
      effectiveFrom: new Date("2096-01-01T00:00:00.000Z"),
      authority: "TEST_ONLY",
      sourceReference: "test fixture",
      sourceDocumentName: "test fixture",
      status: "ACTIVE",
      readiness: "CALCULATION_VERIFIED",
      sourceDigest: "1".repeat(64),
      datasetDigest: "2".repeat(64),
      goldenFixtureDigest: "3".repeat(64),
      independentReviewDigest: "4".repeat(64),
      classificationVersion: "TEST_CLASSIFICATION_V1",
      classificationDigest: "5".repeat(64),
      parserName: "test-parser",
      parserVersion: "1.0.0",
      calculatorVersion: "1.0.0",
      calculatorTestDigest: "6".repeat(64),
      datasetRowCount: 1,
      calculationVerifiedAt: new Date(),
      calculationVerifiedById: actorId,
      activatedAt: new Date(),
      activatedById: actorId,
      activationReason: "Test-only immutable rule activation",
    },
  });
  try {
    await assert.rejects(
      prisma.statutoryRuleSet.update({
        where: { id },
        data: { sourceDigest: "4".repeat(64) },
      }),
      /STATUTORY_ACTIVE_ARTIFACT_IMMUTABLE/,
    );
    const retired = await prisma.statutoryRuleSet.update({
      where: { id },
      data: { status: "RETIRED" },
    });
    assert.equal(retired.status, "RETIRED");
  } finally {
    await prisma.statutoryRuleSet.deleteMany({ where: { id } });
  }
});

test("verified statutory dataset status requires a digest and positive row count", async () => {
  await assert.rejects(
    prisma.statutoryRuleSet.create({
      data: {
        scheme: "EIS",
        version: `TEST_UNVERIFIED_${randomUUID()}`,
        effectiveFrom: new Date("2099-01-01T00:00:00.000Z"),
        authority: "TEST_ONLY",
        sourceReference: "test fixture",
        sourceDocumentName: "test fixture",
        readiness: "DATASET_VERIFIED",
      },
    }),
  );
});

test("platform lifecycle verifies engineering but sign-off requires scoped MFA authorization", async () => {
  const id = randomUUID();
  const reviewer = await prisma.user.create({ data: { name: "QA Statutory Reviewer", email: `statutory-reviewer-${id}@test.local`, role: "PLATFORM_ADMIN", permissions: ["SIGN_OFF_STATUTORY_RULESET"] } });
  const activator = await prisma.user.create({ data: { name: "QA Statutory Activator", email: `statutory-activator-${id}@test.local`, role: "PLATFORM_ADMIN", permissions: ["ACTIVATE_STATUTORY_RULESET"] } });
  const version = `TEST_CONTROLLED_${id.slice(0, 8)}`;
  const engineeringEvidence = controlledEvidence(version);
  await prisma.statutoryRuleSet.create({
    data: {
      id,
      scheme: engineeringEvidence.scheme,
      version,
      effectiveFrom: new Date("2195-01-01T00:00:00.000Z"),
      authority: "TEST_ONLY",
      sourceReference: "test fixture",
      sourceDocumentName: "test fixture",
    },
  });
  try {
    const verified = await recordStatutoryCalculationVerification({
      ruleSetId: id,
      actor: { id: reviewer.id, role: "PLATFORM_ADMIN" },
      reason: "Independent review and golden fixtures verified for test",
      evidence: engineeringEvidence,
    });
    assert.equal(verified.rule.readiness, "CALCULATION_VERIFIED");
    assert.equal(verified.rule.status, "READY_FOR_HUMAN_SIGN_OFF");

    await prisma.statutoryRuleSet.update({
      where: { id },
      data: {
        humanReviewStatus: "COMPLETED",
        humanClassificationDigest: engineeringEvidence.classificationDigest,
      },
    });

    const digestRule = await prisma.statutoryRuleSet.findUniqueOrThrow({ where: { id }, include: { classifications: true } });
    const evidenceDigest = statutoryRuleEvidenceDigest(digestRule);

    await assert.rejects(signOffStatutoryRule({
      ruleSetId: id,
      actor: { id: reviewer.id, role: "PLATFORM_ADMIN", actorType: "SYSTEM", capabilities: ["SIGN_OFF_STATUTORY_RULESET"] },
      reason: "System identity must never count as human review",
      expectedEvidenceDigest: evidenceDigest,
    }), /STATUTORY_HUMAN_ACTOR_REQUIRED/);

    await assert.rejects(signOffStatutoryRule({
      ruleSetId: id,
      actor: { id: activator.id, role: "PLATFORM_ADMIN", actorType: "HUMAN_USER", capabilities: [] },
      reason: "User without the reviewer capability must be denied",
      expectedEvidenceDigest: evidenceDigest,
    }), /STATUTORY_CAPABILITY_REQUIRED:SIGN_OFF_STATUTORY_RULESET/);

    await assert.rejects(signOffStatutoryRule({
      ruleSetId: id,
      actor: { id: reviewer.id, role: "PLATFORM_ADMIN", actorType: "HUMAN_USER", capabilities: ["SIGN_OFF_STATUTORY_RULESET"] },
      reason: "Password-only or QA references cannot satisfy true MFA",
      expectedEvidenceDigest: evidenceDigest,
    }), /MFA_REQUIRED/);
    const blocked = await prisma.statutoryRuleSet.findUniqueOrThrow({ where: { id } });
    assert.equal(blocked.status, "READY_FOR_HUMAN_SIGN_OFF");
    assert.equal(await prisma.statutoryRuleSetSignOff.count({ where: { ruleSetId: id } }), 0);

    const audits = await prisma.statutoryRuleLifecycleAudit.findMany({
      where: { ruleSetId: id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      audits.map((audit) => audit.action),
      ["CALCULATION_VERIFIED", "READY_FOR_REVIEW"],
    );
    assert.ok(audits.every((audit) => audit.reason.length >= 10));
  } finally {
    await prisma.statutoryRuleSet.updateMany({ where: { id }, data: { status: "RETIRED" } });
    await prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId: id } });
    await prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId: id } });
    await prisma.statutoryRuleSet.deleteMany({ where: { id } });
    await prisma.user.deleteMany({ where: { id: { in: [reviewer.id, activator.id] } } });
  }
});

function controlledEvidence(ruleVersion: string): RuleActivationEvidence {
  return {
    scheme: "SOCSO",
    ruleVersion,
    effectiveFrom: "2195-01-01",
    effectiveTo: null,
    artifactStatus: "VERIFIED",
    datasetStatus: "VERIFIED",
    independentReviewStatus: "PASS",
    fixtureStatus: "VERIFIED",
    classificationStatus: "VERIFIED",
    classificationApprovalStatus: "HUMAN_SIGNED_OFF",
    classificationApprovalRecordDigest: "9".repeat(64),
    classificationApprovedByActorId: "00000000-0000-4000-8000-000000000001",
    classificationApprovedAt: "2194-12-01T00:00:00.000Z",
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256: "a".repeat(64),
    datasetDigest: "b".repeat(64),
    independentReviewDigest: "c".repeat(64),
    fixtureDigest: "d".repeat(64),
    classificationVersion: "TEST_CLASSIFICATION_V1",
    classificationDigest: "e".repeat(64),
    parserName: "test-parser",
    parserVersion: "1.0.0",
    calculatorVersion: "test-calculator/1.0.0",
    calculatorTestDigest: "f".repeat(64),
    datasetRowCount: 65,
    goldenFixtureCount: 12,
    unresolvedBlockers: [],
  };
}
