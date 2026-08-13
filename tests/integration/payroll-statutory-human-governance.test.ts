import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import {
  SIGN_OFF_STATUTORY_RULESET,
  signOffStatutoryRule,
  statutoryRuleEvidenceDigest,
  type StatutoryHumanActor,
} from "../../src/lib/payroll/statutory-activation-service";
import {
  LOCAL_REGISTRATION_ACTOR_ID,
  REVIEW_STATUTORY_CLASSIFICATION,
  completeStatutoryHumanReview,
  recordStatutoryComponentReviewDecision,
  registerCanonicalStatutoryCandidates,
} from "../../src/lib/payroll/statutory-governance-service";

test("four verified canonical candidates register idempotently without sign-off or activation", async () => {
  const input = {
    actor: {
      id: LOCAL_REGISTRATION_ACTOR_ID,
      role: "PLATFORM_ADMIN" as const,
      actorType: "SCRIPT" as const,
    },
    reason: "Integration verifies idempotent canonical candidate registration.",
  };
  const first = await registerCanonicalStatutoryCandidates(input);
  const second = await registerCanonicalStatutoryCandidates(input);
  assert.deepEqual(first.map((item) => item.scheme), ["EPF", "SOCSO", "EIS", "LINDUNG24"]);
  assert.deepEqual(first.map((item) => item.ruleSetId), second.map((item) => item.ruleSetId));
  const ids = first.map((item) => item.ruleSetId);
  assert.equal(await prisma.statutoryRuleSet.count({ where: { id: { in: ids }, status: "ACTIVE" } }), 0);
  assert.equal(await prisma.statutoryRuleSetSignOff.count({ where: { ruleSetId: { in: ids } } }), 0);
});

test("UNKNOWN review decisions are immutable and a legacy step-up reference cannot satisfy MFA", async () => {
  const token = randomUUID();
  const reviewer = await prisma.user.create({
    data: {
      name: "Governance QA Reviewer",
      email: `governance-reviewer-${token}@test.local`,
      role: "PLATFORM_ADMIN",
      permissions: [REVIEW_STATUTORY_CLASSIFICATION, SIGN_OFF_STATUTORY_RULESET],
    },
  });
  const rule = await createRule(token, "TEST_ONLY", ["CUSTOM_UNKNOWN_EARNING", "PHONE_ALLOWANCE"]);
  const actor = reviewActor(reviewer.id, [REVIEW_STATUTORY_CLASSIFICATION, SIGN_OFF_STATUTORY_RULESET]);
  try {
    const firstDigest = await ruleDigest(rule.id);
    const first = await recordStatutoryComponentReviewDecision({
      ruleSetId: rule.id,
      classificationId: rule.classifications[0].id,
      decision: "KEEP_UNKNOWN",
      evidenceReference: "QA-EVIDENCE-CUSTOM-1",
      reason: "Official evidence remains insufficient for this custom component.",
      expectedEvidenceDigest: firstDigest,
      expectedReviewRevision: 0,
      actor,
    });
    assert.equal(first.decision.blockingScope, "CONDITIONAL_RUNTIME_BLOCKER");
    await assert.rejects(recordStatutoryComponentReviewDecision({
      ruleSetId: rule.id,
      classificationId: rule.classifications[1].id,
      decision: "INCLUDED",
      evidenceReference: "QA-EVIDENCE-PHONE-STALE",
      reason: "This replay intentionally uses a stale governance revision.",
      expectedEvidenceDigest: firstDigest,
      expectedReviewRevision: 0,
      actor,
    }), /STATUTORY_HUMAN_REVIEW_STALE/);

    const secondDigest = await ruleDigest(rule.id);
    const second = await recordStatutoryComponentReviewDecision({
      ruleSetId: rule.id,
      classificationId: rule.classifications[1].id,
      decision: "EXCLUDED",
      evidenceReference: "QA-EVIDENCE-PHONE-2",
      reason: "The isolated QA fixture records an explicit excluded decision.",
      expectedEvidenceDigest: secondDigest,
      expectedReviewRevision: 1,
      actor,
    });
    assert.equal(second.decision.decision, "EXCLUDED");
    await assert.rejects(
      prisma.statutoryComponentReviewDecision.update({
        where: { id: second.decision.id }, data: { reason: "Mutation must be denied by DB." },
      }),
      /STATUTORY_COMPONENT_REVIEW_DECISION_IMMUTABLE/,
    );

    const completionDigest = await ruleDigest(rule.id);
    await completeStatutoryHumanReview({
      ruleSetId: rule.id,
      reason: "All UNKNOWN items in this isolated QA rule have explicit decisions.",
      expectedEvidenceDigest: completionDigest,
      expectedReviewRevision: 2,
      actor,
    });
    const signDigest = await ruleDigest(rule.id);
    await assert.rejects(signOffStatutoryRule({
      ruleSetId: rule.id,
      actor,
      reason: "QA review completion must not bypass the statutory MFA policy.",
      expectedEvidenceDigest: signDigest,
      stepUpReference: "QA_TEST_ONLY:INTEGRATION_GOVERNANCE",
    }), /MFA_REQUIRED/);
    assert.equal(
      await prisma.statutoryRuleSetSignOff.count({ where: { ruleSetId: rule.id } }),
      0,
    );
  } finally {
    await cleanupRule(rule.id, reviewer.id);
  }
});

test("core wage Keep UNKNOWN remains a global blocker and arrears cannot be generically classified", async () => {
  const token = randomUUID();
  const reviewer = await prisma.user.create({
    data: {
      name: "Governance Blocker QA",
      email: `governance-blocker-${token}@test.local`,
      role: "PLATFORM_ADMIN",
      permissions: [REVIEW_STATUTORY_CLASSIFICATION, SIGN_OFF_STATUTORY_RULESET],
    },
  });
  const rule = await createRule(token, "TEST_ONLY", ["BASIC_SALARY", "ARREARS"]);
  const actor = reviewActor(reviewer.id, [REVIEW_STATUTORY_CLASSIFICATION, SIGN_OFF_STATUTORY_RULESET]);
  const arrears = rule.classifications.find((item) => item.componentCode === "ARREARS")!;
  const basicSalary = rule.classifications.find((item) => item.componentCode === "BASIC_SALARY")!;
  try {
    await assert.rejects(recordStatutoryComponentReviewDecision({
      ruleSetId: rule.id,
      classificationId: arrears.id,
      decision: "INCLUDED",
      evidenceReference: "QA-ARREARS-EVIDENCE",
      reason: "A generic arrears decision must be rejected by policy.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
      expectedReviewRevision: 0,
      actor,
    }), /ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED/);
    await recordDecision(rule.id, basicSalary.id, "KEEP_UNKNOWN", 0, actor);
    await recordDecision(rule.id, arrears.id, "KEEP_UNKNOWN", 1, actor);
    await completeStatutoryHumanReview({
      ruleSetId: rule.id,
      reason: "Both global and source-nature UNKNOWN items were explicitly retained.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
      expectedReviewRevision: 2,
      actor,
    });
    await assert.rejects(signOffStatutoryRule({
      ruleSetId: rule.id,
      actor,
      reason: "Core wage UNKNOWN must still block this QA sign-off attempt.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
      stepUpReference: "QA_TEST_ONLY:GLOBAL_BLOCKER",
    }), /COMPONENT_CLASSIFICATION_REQUIRED/);
  } finally {
    await cleanupRule(rule.id, reviewer.id);
  }
});

test("canonical-authority sign-off requires a scoped genuine MFA authorization", async () => {
  const token = randomUUID();
  const reviewer = await prisma.user.create({
    data: {
      name: "Step-up QA Reviewer",
      email: `step-up-reviewer-${token}@test.local`,
      role: "PLATFORM_ADMIN",
      permissions: [SIGN_OFF_STATUTORY_RULESET],
    },
  });
  const rule = await createRule(token, "KWSP", []);
  await prisma.statutoryRuleSet.update({
    where: { id: rule.id },
    data: { humanReviewStatus: "COMPLETED", humanClassificationDigest: "9".repeat(64) },
  });
  try {
    await assert.rejects(signOffStatutoryRule({
      ruleSetId: rule.id,
      actor: reviewActor(reviewer.id, [SIGN_OFF_STATUTORY_RULESET]),
      reason: "A normal authenticated session is not sufficient step-up evidence.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
    }), /MFA_REQUIRED/);
  } finally {
    await cleanupRule(rule.id, reviewer.id);
  }
});

test("unauthorised reviewer and sign-off without completed review are denied", async () => {
  const token = randomUUID();
  const user = await prisma.user.create({
    data: {
      name: "Unauthorised Governance QA",
      email: `governance-unauthorised-${token}@test.local`,
      role: "PLATFORM_ADMIN",
      permissions: [],
    },
  });
  const rule = await createRule(token, "TEST_ONLY", ["CUSTOM_UNKNOWN_EARNING"]);
  try {
    await assert.rejects(recordStatutoryComponentReviewDecision({
      ruleSetId: rule.id,
      classificationId: rule.classifications[0].id,
      decision: "KEEP_UNKNOWN",
      evidenceReference: "QA-UNAUTHORISED-EVIDENCE",
      reason: "A claimed client capability must not bypass stored permissions.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
      expectedReviewRevision: 0,
      actor: reviewActor(user.id, [REVIEW_STATUTORY_CLASSIFICATION]),
    }), /STATUTORY_CAPABILITY_REQUIRED:REVIEW_STATUTORY_CLASSIFICATION/);
    await prisma.user.update({
      where: { id: user.id }, data: { permissions: [SIGN_OFF_STATUTORY_RULESET] },
    });
    await assert.rejects(signOffStatutoryRule({
      ruleSetId: rule.id,
      actor: reviewActor(user.id, [SIGN_OFF_STATUTORY_RULESET]),
      reason: "Sign-off must not bypass the incomplete human review workflow.",
      expectedEvidenceDigest: await ruleDigest(rule.id),
      stepUpReference: "QA_TEST_ONLY:INCOMPLETE_REVIEW",
    }), /STATUTORY_HUMAN_REVIEW_INCOMPLETE/);
    await assert.rejects(signOffStatutoryRule({
      ruleSetId: randomUUID(),
      actor: reviewActor(user.id, [SIGN_OFF_STATUTORY_RULESET]),
      reason: "A sign-off request without a stored RuleSet must be denied.",
      expectedEvidenceDigest: "0".repeat(64),
      stepUpReference: "QA_TEST_ONLY:MISSING_RULESET",
    }));
  } finally {
    await cleanupRule(rule.id, user.id);
  }
});

async function createRule(token: string, authority: string, unknownComponents: string[]) {
  return prisma.statutoryRuleSet.create({
    data: {
      scheme: "SOCSO",
      version: `TEST_GOVERNANCE_${token.slice(0, 8)}_${authority}`,
      effectiveFrom: new Date("2197-01-01T00:00:00.000Z"),
      authority,
      sourceReference: "QA governance fixture",
      sourceDocumentName: "QA governance fixture",
      sourceDigest: "1".repeat(64),
      datasetDigest: "2".repeat(64),
      goldenFixtureDigest: "3".repeat(64),
      independentReviewDigest: "4".repeat(64),
      classificationVersion: "QA_CLASSIFICATION_1",
      classificationDigest: "5".repeat(64),
      parserName: "qa-parser",
      parserVersion: "1",
      calculatorVersion: "qa-calculator",
      calculatorTestDigest: "6".repeat(64),
      datasetRowCount: 1,
      readiness: "CALCULATION_VERIFIED",
      status: "READY_FOR_HUMAN_SIGN_OFF",
      ruleData: { id: "QA_DATASET" },
      classifications: {
        create: unknownComponents.map((componentCode) => ({
          scheme: "SOCSO" as const,
          componentCode,
          treatment: "UNKNOWN" as const,
          rationale: "Isolated QA UNKNOWN classification.",
          authorityRef: "QA evidence only",
        })),
      },
    },
    include: { classifications: { orderBy: { componentCode: "asc" } } },
  });
}

async function ruleDigest(ruleSetId: string) {
  const rule = await prisma.statutoryRuleSet.findUniqueOrThrow({
    where: { id: ruleSetId },
    include: { classifications: true, reviewDecisions: true },
  });
  return statutoryRuleEvidenceDigest(rule);
}

async function recordDecision(
  ruleSetId: string,
  classificationId: string,
  decision: "INCLUDED" | "EXCLUDED" | "KEEP_UNKNOWN",
  revision: number,
  actor: StatutoryHumanActor,
) {
  return recordStatutoryComponentReviewDecision({
    ruleSetId,
    classificationId,
    decision,
    evidenceReference: `QA-EVIDENCE-${classificationId}`,
    reason: "Explicit evidence-bound decision for isolated governance QA.",
    expectedEvidenceDigest: await ruleDigest(ruleSetId),
    expectedReviewRevision: revision,
    actor,
  });
}

function reviewActor(id: string, capabilities: string[]): StatutoryHumanActor {
  return { id, role: "PLATFORM_ADMIN", actorType: "HUMAN_USER", capabilities };
}

async function cleanupRule(ruleSetId: string, userId: string) {
  await prisma.statutoryRuleSet.updateMany({ where: { id: ruleSetId }, data: { status: "RETIRED" } });
  await prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentReviewDecision.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryComponentClassification.deleteMany({ where: { ruleSetId } });
  await prisma.statutoryRuleSet.deleteMany({ where: { id: ruleSetId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}
