import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import {
  activateStatutoryRuleSet,
  installSabahStatutoryRulePackDraft,
  markStatutoryRuleSetReadyForHumanSignOff,
  submitStatutoryRuleSetForReview,
} from "../../src/lib/leave/statutory-service";
import {
  SABAH_LEAVE_JURISDICTION,
  SABAH_LEAVE_OFFICIAL_SOURCES,
  SABAH_LEAVE_RULE_PACK_VERSION,
} from "../../src/lib/leave/sabah-statutory-rule-pack";
import { prisma } from "../../src/lib/prisma";

test("Phase 2C installs a source-backed Sabah candidate and stops at human sign-off", async () => {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Sabah Leave P2C ${token}`, slug: `sabah-leave-p2c-${token}`, timezone: "Asia/Kuala_Lumpur" },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Sabah exact workplace", countryCode: "MY", stateCode: "SABAH" },
  });
  const [creator, reviewer] = await Promise.all([
    prisma.user.create({
      data: { businessId: business.id, branchId: branch.id, name: "Pack creator", email: `creator-${token}@phase2c.test`, role: "BUSINESS_OWNER" },
    }),
    prisma.user.create({
      data: { businessId: business.id, branchId: branch.id, name: "Independent reviewer", email: `reviewer-${token}@phase2c.test`, role: "BUSINESS_OWNER" },
    }),
  ]);
  const creatorSession = appSession(creator, business.id, branch.id);
  const reviewerSession = appSession(reviewer, business.id, branch.id);

  const draft = await installSabahStatutoryRulePackDraft({ businessId: business.id, actor: creatorSession });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.version, SABAH_LEAVE_RULE_PACK_VERSION);
  assert.equal(draft.jurisdictionCode, SABAH_LEAVE_JURISDICTION);
  assert.equal(draft.sources.length, 3);
  assert.equal(draft.rules.length, 6);
  assert.equal(draft.sources.find((source) => source.sourceTitle.includes("Act A1753"))?.sourceSection, SABAH_LEAVE_OFFICIAL_SOURCES[0].section);
  assert.doesNotMatch(draft.sources.find((source) => source.sourceTitle.includes("Act A1753"))?.sourceSection ?? "", /\b104D\b/);
  const maternityRule = draft.rules.find((rule) => rule.category === "MATERNITY_LEAVE");
  assert.equal(maternityRule?.tiers.length, 0);
  assert.match(maternityRule?.statutorySection ?? "", /section 84 deleted/i);
  assert.ok(maternityRule?.eventRules && typeof maternityRule.eventRules === "object" && !Array.isArray(maternityRule.eventRules));
  const maternityEventRules = maternityRule.eventRules as Record<string, unknown>;
  assert.equal(maternityEventRules.durationCalendarDays, 98);
  assert.equal(maternityEventRules.leaveEntitlementSource, "SECTION_83_1_2");
  assert.equal(maternityEventRules.leaveCommencementSource, "SECTION_83_3_4");
  assert.equal(maternityEventRules.allowanceEligibilitySource, "SECTION_83_5_6");
  assert.equal(maternityEventRules.noticeSource, "SECTION_87");
  assert.equal(maternityEventRules.allowanceEligibilityNotInferredFromPaidFlag, true);
  assert.equal(draft.rules.find((rule) => rule.category === "PATERNITY_LEAVE")?.tiers.length, 0);
  assert.equal(draft.rules.find((rule) => rule.category === "UNPAID_LEAVE")?.tiers.length, 0);

  const idempotentDraft = await installSabahStatutoryRulePackDraft({ businessId: business.id, actor: creatorSession });
  assert.equal(idempotentDraft.id, draft.id);

  const reviewReady = await submitStatutoryRuleSetForReview({
    businessId: business.id,
    actor: creatorSession,
    rawInput: { ruleSetId: draft.id, expectedStatus: "DRAFT" },
  });
  assert.equal(reviewReady.status, "READY_FOR_REVIEW");

  await assert.rejects(
    markStatutoryRuleSetReadyForHumanSignOff({
      businessId: business.id,
      actor: creatorSession,
      rawInput: {
        ruleSetId: draft.id,
        expectedStatus: "READY_FOR_REVIEW",
        confirmed: true,
        reviewNote: "Creator must not review the same statutory candidate.",
      },
    }),
    /creator cannot review/i,
  );

  const signOffReady = await markStatutoryRuleSetReadyForHumanSignOff({
    businessId: business.id,
    actor: reviewerSession,
    rawInput: {
      ruleSetId: draft.id,
      expectedStatus: "READY_FOR_REVIEW",
      confirmed: true,
      reviewNote: "Independent engineering evidence review completed; authorised legal sign-off remains outstanding.",
    },
  });
  assert.equal(signOffReady.status, "READY_FOR_HUMAN_SIGN_OFF");
  assert.equal(signOffReady.reviewedById, reviewer.id);
  assert.equal(signOffReady.activatedAt, null);

  await assert.rejects(
    activateStatutoryRuleSet({
      businessId: business.id,
      actor: reviewerSession,
      rawInput: {
        ruleSetId: draft.id,
        expectedStatus: "READY_FOR_HUMAN_SIGN_OFF",
        confirmed: true,
        reviewNote: "Business owners cannot activate official statutory datasets.",
      },
    }),
    /Platform statutory administrator/i,
  );
  assert.equal(await prisma.leaveStatutoryRuleSet.count({ where: { id: draft.id, status: "ACTIVE" } }), 0);
});

test("Phase 2C does not install the Sabah candidate without an exact Sabah workplace", async () => {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Non Sabah Leave P2C ${token}`, slug: `non-sabah-leave-p2c-${token}`, timezone: "Asia/Kuala_Lumpur" },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Non-Sabah workplace", countryCode: "MY", stateCode: "SELANGOR" },
  });
  const owner = await prisma.user.create({
    data: { businessId: business.id, branchId: branch.id, name: "Non-Sabah owner", email: `non-sabah-${token}@phase2c.test`, role: "BUSINESS_OWNER" },
  });

  await assert.rejects(
    installSabahStatutoryRulePackDraft({ businessId: business.id, actor: appSession(owner, business.id, branch.id) }),
    /exact MY-SABAH jurisdiction/i,
  );
  assert.equal(await prisma.leaveStatutoryRuleSet.count({ where: { businessId: business.id } }), 0);
});

function appSession(
  user: { id: string; name: string; email: string | null },
  businessId: string,
  branchId: string,
): AppSession {
  return {
    userId: user.id,
    homeBusinessId: businessId,
    activeBusinessId: businessId,
    contextVersion: 1,
    businessId,
    branchId,
    name: user.name,
    email: user.email ?? "",
    role: "BUSINESS_OWNER",
    permissions: ["EDIT_LEAVE_POLICY"],
    status: "active",
  };
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  assert.match(url, /127\.0\.0\.1|localhost/i, "Integration tests require a local database.");
}
