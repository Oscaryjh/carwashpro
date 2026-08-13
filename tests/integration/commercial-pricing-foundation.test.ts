import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma";
import type { AppSession } from "../../src/lib/auth/session";
import { activateCommercialPlanVersion, addCommercialSubscriptionItem, assertCommercialBranchCapacity, createCommercialOverride, createCommercialPlan, createCommercialPlanVersion, createCommercialSubscription, getEffectiveCommercialConfiguration, projectCommercialConfiguration, reconcileCommercialState, renewCommercialSubscription, scheduleCommercialPlanChange, applyDueCommercialPlanChange, createCommercialPromotion } from "../../src/lib/commercial/service";

const ids: string[] = [];
after(async () => { await prisma.$disconnect(); });

async function fixture() {
  const token = randomUUID().slice(0, 8);
  const actorRow = await prisma.user.create({ data: { name: `Commercial Admin ${token}`, email: `commercial-${token}@test.local`, role: "PLATFORM_ADMIN", status: "active" } });
  const actor: AppSession = { userId: actorRow.id, name: actorRow.name, email: actorRow.email!, role: actorRow.role, status: actorRow.status, permissions: [], homeBusinessId: null, activeBusinessId: null, businessId: null, contextVersion: 1 };
  const businessA = await prisma.business.create({ data: { name: `Commercial A ${token}`, slug: `commercial-a-${token}` } }); ids.push(businessA.id);
  const businessB = await prisma.business.create({ data: { name: `Commercial B ${token}`, slug: `commercial-b-${token}` } }); ids.push(businessB.id);
  await prisma.branch.createMany({ data: [{ businessId: businessA.id, name: "Main" }, { businessId: businessB.id, name: "Main" }] });
  return { actor, actorRow, businessA, businessB, token };
}

async function version(actor: Awaited<ReturnType<typeof fixture>>["actor"], planId: string, price: number, effectiveFrom: Date, ai = 50, branches = 1) {
  const row = await createCommercialPlanVersion(actor, { planId, operationKey: `VERSION:${randomUUID()}`, effectiveFrom, monthlyListPriceCents: price, annualListPriceCents: price * 10, setupFeeCents: 30_000, includedBranches: branches, includedEmployees: 10, extraBranchUnitPriceCents: 3_900, extraEmployeeUnitPriceCents: 400, businessAiAllowance: ai, groupAiAllowance: null, modules: ["POS", "INVENTORY", "EXPENSE", "AI"] });
  return activateCommercialPlanVersion(actor, row.id, `ACTIVATE:${row.id}`, effectiveFrom);
}

test("versioned price preserves Customer A while Customer B receives the active v2", async () => {
  const f = await fixture(); const plan = await createCommercialPlan(f.actor, { code: `OPS-${f.token}`, displayName: "Operations", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:${f.token}` });
  const v1 = await version(f.actor, plan.id, 16_900, new Date("2026-08-01T00:00:00Z"));
  const a = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: v1.id, billingInterval: "MONTHLY", startDate: new Date("2026-08-01T00:00:00Z"), renewalDate: new Date("2026-09-01T00:00:00Z"), operationKey: `SUB:A:${f.token}` });
  await projectCommercialConfiguration(f.actor, a.id, new Date("2026-08-12T00:00:00Z"));
  const v2 = await version(f.actor, plan.id, 19_900, new Date("2026-08-10T00:00:00Z"));
  const b = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessB.id, basePlanVersionId: v2.id, billingInterval: "MONTHLY", startDate: new Date("2026-08-11T00:00:00Z"), renewalDate: new Date("2026-09-11T00:00:00Z"), operationKey: `SUB:B:${f.token}` });
  const stateA = await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-08-12T00:00:00Z") }); const stateB = await getEffectiveCommercialConfiguration({ businessId: f.businessB.id, now: new Date("2026-08-12T00:00:00Z") });
  assert.equal(stateA.price?.effectiveRecurringPriceCents, 16_900); assert.equal(stateA.subscription?.items[0]?.planVersion.version, 1);
  assert.equal(stateB.price?.effectiveRecurringPriceCents, 19_900); assert.equal(stateB.subscription?.items[0]?.planVersion.version, 2);
  await createCommercialOverride(f.actor, { subscriptionId: b.id, type: "PRICE", value: 15_900, effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: new Date("2026-12-31T00:00:00Z"), reason: "Launch customer", operationKey: `OVERRIDE:${f.token}` });
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessB.id, now: new Date("2026-10-01T00:00:00Z") })).price?.effectiveRecurringPriceCents, 15_900);
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessB.id, now: new Date("2027-01-01T00:00:00Z") })).price?.effectiveRecurringPriceCents, 19_900);
});

test("add-on aggregates AI and scheduled change keeps historical base until effective", async () => {
  const f = await fixture(); const base = await createCommercialPlan(f.actor, { code: `BASE-${f.token}`, displayName: "Base", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:BASE:${f.token}` }); const add = await createCommercialPlan(f.actor, { code: `AI-${f.token}`, displayName: "AI Add-on", scopeType: "BUSINESS", planType: "ADD_ON", operationKey: `PLAN:AI:${f.token}` });
  const baseV1 = await version(f.actor, base.id, 9_900, new Date("2026-08-01Z"), 50);
  const addDraft = await createCommercialPlanVersion(f.actor, { planId: add.id, operationKey: `VERSION:AI:${f.token}`, effectiveFrom: new Date("2026-08-01Z"), monthlyListPriceCents: 3_900, annualListPriceCents: 39_000, setupFeeCents: 0, includedBranches: 0, includedEmployees: 0, extraBranchUnitPriceCents: null, extraEmployeeUnitPriceCents: null, businessAiAllowance: 300, groupAiAllowance: null, modules: ["AI"] }); const addV = await activateCommercialPlanVersion(f.actor, addDraft.id, `ACTIVATE:${addDraft.id}`);
  const sub = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: baseV1.id, addOnPlanVersionIds: [addV.id], billingInterval: "MONTHLY", startDate: new Date("2026-08-01Z"), renewalDate: new Date("2026-09-01Z"), operationKey: `SUB:${f.token}` }); await projectCommercialConfiguration(f.actor, sub.id, new Date("2026-08-12Z"));
  const baseV2 = await version(f.actor, base.id, 16_900, new Date("2026-08-20Z"), 100);
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-08-12Z") })).allowances?.businessAi, 350);
  const policy = await prisma.aiAllowancePolicy.findFirst({ where: { scopeKey: `BUSINESS:${f.businessA.id}`, source: "PLAN" }, orderBy: { revision: "desc" } }); assert.equal(policy?.requestLimit, 350);
  await scheduleCommercialPlanChange(f.actor, { subscriptionId: sub.id, newBasePlanVersionId: baseV2.id, effectiveAt: new Date("2026-09-01Z"), reason: "Renewal upgrade", operationKey: `SCHEDULE:${f.token}` });
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-08-31Z") })).price?.listSubtotalCents, 13_800);
  await applyDueCommercialPlanChange(f.actor, sub.id, new Date("2026-09-01Z"));
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-09-02Z") })).price?.listSubtotalCents, 20_800);
});

test("commercial limits preserve legacy and block unsafe growth without deleting facts", async () => {
  const f = await fixture(); const legacy = await getEffectiveCommercialConfiguration({ businessId: f.businessA.id }); assert.equal(legacy.state, "LEGACY_REVIEW_REQUIRED"); await assertCommercialBranchCapacity(f.businessA.id);
  const plan = await createCommercialPlan(f.actor, { code: `LIMIT-${f.token}`, displayName: "Limit", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:${f.token}` }); const v = await version(f.actor, plan.id, 9_900, new Date("2026-01-01Z"), 20, 1); const sub = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: v.id, billingInterval: "MONTHLY", startDate: new Date("2026-01-01Z"), renewalDate: new Date("2027-01-01Z"), operationKey: `SUB:${f.token}` }); await projectCommercialConfiguration(f.actor, sub.id);
  await assert.rejects(() => assertCommercialBranchCapacity(f.businessA.id), /COMMERCIAL_BRANCH_LIMIT_REACHED/); assert.equal(await prisma.branch.count({ where: { businessId: f.businessA.id } }), 1);
  await createCommercialOverride(f.actor, { subscriptionId: sub.id, type: "BRANCH_ALLOWANCE", value: 3, effectiveFrom: new Date("2026-01-01Z"), reason: "Contract branch allowance", operationKey: `BRANCH:${f.token}` }); await assertCommercialBranchCapacity(f.businessA.id);
  const reconciliation = await reconcileCommercialState({ businessId: f.businessA.id }); assert.equal(reconciliation.status, "MATCH");
});

test("promotion keeps list price and explicit price override has highest precedence", async () => {
  const f = await fixture(); const plan = await createCommercialPlan(f.actor, { code: `PROMO-${f.token}`, displayName: "Promo plan", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:${f.token}` }); const v = await version(f.actor, plan.id, 19_900, new Date("2026-01-01Z"));
  const promo = await createCommercialPromotion(f.actor, { name: "Launch 20%", discountType: "PERCENT", discountValue: 2_000, effectiveFrom: new Date("2026-01-01Z"), effectiveTo: new Date("2027-01-01Z"), eligiblePlanVersionIds: [v.id], operationKey: `PROMO:${f.token}` });
  const sub = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: v.id, promotionId: promo.id, billingInterval: "MONTHLY", startDate: new Date("2026-01-01Z"), renewalDate: new Date("2027-01-01Z"), operationKey: `SUB:${f.token}` });
  const discounted = await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-06-01Z") }); assert.equal(discounted.price?.listSubtotalCents, 19_900); assert.equal(discounted.price?.promotionDiscountCents, 3_980); assert.equal(discounted.price?.effectiveRecurringPriceCents, 15_920);
  await createCommercialOverride(f.actor, { subscriptionId: sub.id, type: "PRICE", value: 15_900, effectiveFrom: new Date("2026-01-01Z"), reason: "Strategic launch price", operationKey: `OVERRIDE:${f.token}` }); const overridden = await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-06-01Z") }); assert.equal(overridden.price?.promotionDiscountCents, 0); assert.equal(overridden.price?.effectiveRecurringPriceCents, 15_900);
});

test("concurrent subscription attempts cannot create two active bases", async () => {
  const f = await fixture(); const plan = await createCommercialPlan(f.actor, { code: `RACE-${f.token}`, displayName: "Race plan", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:${f.token}` }); const v = await version(f.actor, plan.id, 9_900, new Date("2026-01-01Z"));
  const attempts = await Promise.allSettled(["A", "B"].map(suffix => createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: v.id, billingInterval: "MONTHLY", startDate: new Date("2026-01-01Z"), renewalDate: new Date("2027-01-01Z"), operationKey: `SUB:${suffix}:${f.token}` })));
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1); assert.equal(await prisma.commercialSubscription.count({ where: { businessId: f.businessA.id, status: "ACTIVE" } }), 1); assert.equal(await prisma.commercialSubscriptionItem.count({ where: { subscription: { businessId: f.businessA.id }, itemType: "BASE", status: "ACTIVE" } }), 1);
});

test("post-subscription add-on and renewal are idempotent canonical commands", async () => {
  const f = await fixture();
  const base = await createCommercialPlan(f.actor, { code: `POST-${f.token}`, displayName: "Post base", scopeType: "BUSINESS", planType: "BASE", operationKey: `PLAN:POST:${f.token}` });
  const add = await createCommercialPlan(f.actor, { code: `POST-AI-${f.token}`, displayName: "Post AI", scopeType: "BUSINESS", planType: "ADD_ON", operationKey: `PLAN:POST-AI:${f.token}` });
  const baseVersion = await version(f.actor, base.id, 9_900, new Date("2026-01-01Z"), 50);
  const draft = await createCommercialPlanVersion(f.actor, { planId: add.id, operationKey: `VERSION:POST-AI:${f.token}`, effectiveFrom: new Date("2026-01-01Z"), monthlyListPriceCents: 3_900, annualListPriceCents: 39_000, setupFeeCents: 0, includedBranches: 0, includedEmployees: 0, extraBranchUnitPriceCents: null, extraEmployeeUnitPriceCents: null, businessAiAllowance: 300, groupAiAllowance: null, modules: ["AI"] });
  const addVersion = await activateCommercialPlanVersion(f.actor, draft.id, `ACTIVATE:${draft.id}`);
  const sub = await createCommercialSubscription(f.actor, { scopeType: "BUSINESS", businessId: f.businessA.id, basePlanVersionId: baseVersion.id, billingInterval: "MONTHLY", startDate: new Date("2026-01-01Z"), renewalDate: new Date("2026-09-01Z"), operationKey: `SUB:POST:${f.token}` });
  const addKey = `ADD:POST:${f.token}`;
  const firstItem = await addCommercialSubscriptionItem(f.actor, { subscriptionId: sub.id, planVersionId: addVersion.id, operationKey: addKey, startDate: new Date("2026-08-01Z") });
  const replayItem = await addCommercialSubscriptionItem(f.actor, { subscriptionId: sub.id, planVersionId: addVersion.id, operationKey: addKey, startDate: new Date("2026-08-01Z") });
  assert.equal(replayItem.id, firstItem.id);
  assert.equal((await getEffectiveCommercialConfiguration({ businessId: f.businessA.id, now: new Date("2026-08-12Z") })).allowances?.businessAi, 350);
  const renewalKey = `RENEW:POST:${f.token}`;
  const renewed = await renewCommercialSubscription(f.actor, { subscriptionId: sub.id, renewalDate: new Date("2027-09-01Z"), reason: "Annual QA renewal", expectedRevision: 2, operationKey: renewalKey });
  const replayRenewed = await renewCommercialSubscription(f.actor, { subscriptionId: sub.id, renewalDate: new Date("2027-09-01Z"), reason: "Annual QA renewal", expectedRevision: 2, operationKey: renewalKey });
  assert.equal(replayRenewed.id, renewed.id);
  assert.equal(replayRenewed.revision, renewed.revision);
  assert.equal(await prisma.commercialSubscriptionItem.count({ where: { subscriptionId: sub.id, planVersionId: addVersion.id, status: "ACTIVE" } }), 1);
});
