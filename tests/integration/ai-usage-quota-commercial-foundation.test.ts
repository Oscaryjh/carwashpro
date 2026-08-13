import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import {
  AiCommercialError,
  createAiAllowancePolicy,
  getAiCommercialSummary,
  reconcileAiCommercialUsage,
  releaseAiQuota,
  reserveAiQuota,
  consumeAiQuota,
} from "../../src/lib/ai/commercial";

async function fixture(limit = 2) {
  const suffix = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `AI quota ${suffix}`, slug: `ai-quota-${suffix}` } });
  const user = await prisma.user.create({ data: {
    name: "Platform AI quota QA",
    email: `ai-platform-${suffix}@example.test`,
    role: "PLATFORM_ADMIN",
  } });
  await createAiAllowancePolicy({
    actorUserId: user.id,
    scopeType: "BUSINESS",
    businessId: business.id,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    requestLimit: limit,
    tokenLimit: 1000,
    source: "PLATFORM_OVERRIDE",
    reason: "Local integration quota verification.",
  });
  return {
    business,
    user,
    scope: { scopeType: "BUSINESS" as const, scopeKey: `BUSINESS:${business.id}`, businessId: business.id, groupId: null },
  };
}

function request(row: Awaited<ReturnType<typeof fixture>>, id = randomUUID()) {
  return {
    scope: row.scope,
    userId: row.user.id,
    requestKey: `${row.scope.scopeKey}:${id}`,
    provider: "openai",
    model: "test-model",
  };
}

test("commercial request allowance consumes only successful reservations", async () => {
  const row = await fixture(2);
  const firstInput = request(row);
  const first = await reserveAiQuota({ ...firstInput, now: new Date("2026-08-12T04:00:00.000Z") });
  await consumeAiQuota({ ...firstInput, reservationId: first.id, totalTokens: 44 });
  const secondInput = request(row);
  const second = await reserveAiQuota({ ...secondInput, now: new Date("2026-08-12T04:01:00.000Z") });
  await releaseAiQuota({ ...secondInput, reservationId: second.id, errorCategory: "PROVIDER_UNAVAILABLE" });
  const replacementInput = request(row);
  const replacement = await reserveAiQuota({ ...replacementInput, now: new Date("2026-08-12T04:02:00.000Z") });
  await consumeAiQuota({ ...replacementInput, reservationId: replacement.id, totalTokens: 55 });

  const summary = await getAiCommercialSummary(row.scope, new Date("2026-08-12T05:00:00.000Z"));
  assert.equal(summary.configured, true);
  if (!summary.configured) return;
  assert.equal(summary.usedRequests, 2);
  assert.equal(summary.remainingRequests, 0);
  assert.equal(summary.totalTokens, 99);

  await assert.rejects(
    reserveAiQuota({ ...request(row), now: new Date("2026-08-12T05:00:00.000Z") }),
    (error: unknown) => error instanceof AiCommercialError && error.code === "AI_QUOTA_EXCEEDED",
  );
});

test("parallel reservation permits exactly one provider slot when one remains", async () => {
  const row = await fixture(1);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, () => reserveAiQuota({
    ...request(row),
    now: new Date("2026-08-12T06:00:00.000Z"),
  })));
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected" && item.reason instanceof AiCommercialError && item.reason.code === "AI_QUOTA_EXCEEDED").length, 7);
});

test("request keys are idempotent across reservations", async () => {
  const row = await fixture(5);
  const input = request(row);
  await reserveAiQuota({ ...input, now: new Date("2026-08-12T07:00:00.000Z") });
  await assert.rejects(
    reserveAiQuota({ ...input, now: new Date("2026-08-12T07:00:00.000Z") }),
    (error: unknown) => error instanceof AiCommercialError && error.code === "AI_REQUEST_DUPLICATE",
  );
});

test("business and group allowances are isolated and timezone is snapshotted", async () => {
  const row = await fixture(2);
  const suffix = randomUUID().slice(0, 8);
  const group = await prisma.businessGroup.create({ data: { name: `Quota group ${suffix}`, code: `QG-${suffix}` } });
  await createAiAllowancePolicy({
    actorUserId: row.user.id,
    scopeType: "GROUP",
    groupId: group.id,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    requestLimit: 3,
    tokenLimit: null,
    timezone: "Asia/Kuching",
    source: "TRIAL",
    reason: "Local group isolation verification.",
  });
  const groupSummary = await getAiCommercialSummary({ scopeType: "GROUP", scopeKey: `GROUP:${group.id}`, businessId: null, groupId: group.id }, new Date("2026-08-12T04:00:00.000Z"));
  assert.equal(groupSummary.configured && groupSummary.requestLimit, 3);
  assert.equal(groupSummary.configured && groupSummary.timezone, "Asia/Kuching");
  const businessSummary = await getAiCommercialSummary(row.scope, new Date("2026-08-12T04:00:00.000Z"));
  assert.equal(businessSummary.configured && businessSummary.requestLimit, 2);
});

test("policy writes require platform authority and reconciliation matches ledger", async () => {
  const row = await fixture(2);
  const owner = await prisma.user.create({ data: { businessId: row.business.id, name: "Owner", role: "BUSINESS_OWNER" } });
  await assert.rejects(createAiAllowancePolicy({
    actorUserId: owner.id,
    scopeType: "BUSINESS",
    businessId: row.business.id,
    effectiveFrom: new Date("2026-08-12T00:00:00.000Z"),
    requestLimit: 99,
    source: "PLATFORM_OVERRIDE",
    reason: "Owner must not control quota.",
  }), (error: unknown) => error instanceof AiCommercialError && error.code === "AI_ALLOWANCE_PLATFORM_AUTHORITY_REQUIRED");
  const reconciliation = await reconcileAiCommercialUsage(row.scope.scopeKey);
  assert.equal(reconciliation.ready, true);
});
