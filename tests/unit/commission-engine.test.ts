import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateDiscountCents,
  calculateCommission,
  parseCommissionTiers,
  resolveCommissionRule,
  stableCommissionDigest,
  type CommissionRuleCandidate,
  type CommissionSource,
} from "../../src/lib/commission/calculation";

const source: CommissionSource = {
  id: "source-1",
  sourceType: "SERVICE",
  branchId: "branch-a",
  sourceItemId: "item-a",
  sourceCategoryId: "category-a",
  eventAt: new Date("2026-08-10T05:00:00.000Z"),
  quantity: 2,
  grossAmountCents: 10_000,
  discountAmountCents: 1_000,
  netAmountCents: 9_000,
  grossBasisOverride: false,
};

function rule(overrides: Partial<CommissionRuleCandidate> = {}): CommissionRuleCandidate {
  return {
    id: "rule-all",
    ruleId: "rule",
    revision: 1,
    sourceType: "SERVICE",
    branchId: null,
    scope: "ALL",
    scopeId: null,
    ruleType: "PERCENTAGE",
    basis: "NET_AFTER_DISCOUNT",
    rateBasisPoints: 1_000,
    fixedAmountCents: null,
    tiers: [],
    priority: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveUntil: null,
    ...overrides,
  };
}

test("discount allocation preserves integer cents deterministically", () => {
  assert.deepEqual(allocateDiscountCents([3_333, 3_333, 3_334], 1_001), [334, 333, 334]);
  assert.deepEqual(allocateDiscountCents([100, 200], 999), [100, 200]);
  assert.deepEqual(allocateDiscountCents([0, 0], 10), [0, 0]);
});

test("most specific effective rule wins without stacking", () => {
  const category = rule({ id: "rule-category", scope: "CATEGORY", scopeId: "category-a", priority: 2 });
  const item = rule({ id: "rule-item", scope: "ITEM", scopeId: "item-a", priority: -5 });
  const wrongBranch = rule({ id: "wrong", scope: "ITEM", scopeId: "item-a", branchId: "branch-b", priority: 99 });
  const resolved = resolveCommissionRule(source, [rule(), category, item, wrongBranch]);
  assert.equal(resolved.rule?.id, "rule-item");
  assert.equal(resolved.trace.policy, "MOST_SPECIFIC_THEN_BRANCH_THEN_PRIORITY_THEN_REVISION_NO_STACKING");
});

test("percentage, fixed and whole-period tier calculations use cents and frozen basis", () => {
  assert.equal(calculateCommission(source, rule()).commissionAmountCents, 900);
  assert.equal(calculateCommission(source, rule({ basis: "GROSS" })).commissionAmountCents, 1_000);
  assert.equal(calculateCommission(source, rule({ ruleType: "FIXED_AMOUNT", rateBasisPoints: null, fixedAmountCents: 250 })).commissionAmountCents, 500);
  const tiered = rule({ ruleType: "TIERED_PERCENTAGE", rateBasisPoints: null, tiers: [{ fromCents: 0, rateBasisPoints: 500 }, { fromCents: 20_000, rateBasisPoints: 800 }] });
  assert.equal(calculateCommission(source, tiered, 25_000).commissionAmountCents, 720);
});

test("training complimentary source uses original gross price for commission", () => {
  const result = calculateCommission({
    ...source,
    discountAmountCents: 10_000,
    netAmountCents: 0,
    grossBasisOverride: true,
  }, rule({ basis: "NET_AFTER_DISCOUNT" }));

  assert.equal(result.eligibleAmountCents, 10_000);
  assert.equal(result.commissionAmountCents, 1_000);
  assert.equal(result.trace.basisOverride, "TRAINING_COMPLIMENTARY_GROSS");
});

test("whole-period tiers are deterministic below, at and above a boundary", () => {
  const tiered = rule({
    ruleType: "TIERED_PERCENTAGE",
    rateBasisPoints: null,
    tiers: [
      { fromCents: 0, rateBasisPoints: 500 },
      { fromCents: 20_000, rateBasisPoints: 800 },
    ],
  });
  assert.equal(calculateCommission(source, tiered, 19_999).commissionAmountCents, 450);
  assert.equal(calculateCommission(source, tiered, 20_000).commissionAmountCents, 720);
  assert.equal(calculateCommission(source, tiered, 99_999).commissionAmountCents, 720);
});

test("product rules resolve only to product sources and rates cannot exceed 100%", () => {
  const productSource = { ...source, sourceType: "PRODUCT" as const };
  const productRule = rule({ sourceType: "PRODUCT", rateBasisPoints: 1_000 });
  assert.equal(resolveCommissionRule(productSource, [rule(), productRule]).rule?.id, productRule.id);
  assert.throws(
    () => calculateCommission(source, rule({ rateBasisPoints: 10_001 })),
    /100%/,
  );
});

test("tier validation and stable digest fail closed", () => {
  assert.throws(() => parseCommissionTiers([{ fromCents: 100, rateBasisPoints: 500 }]), /first tier/i);
  assert.throws(() => parseCommissionTiers([{ fromCents: 0, rateBasisPoints: 500 }, { fromCents: 0, rateBasisPoints: 700 }]), /unique/i);
  assert.equal(stableCommissionDigest({ b: 2, a: 1 }), stableCommissionDigest({ a: 1, b: 2 }));
});
