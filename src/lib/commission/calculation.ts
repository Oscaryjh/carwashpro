import { createHash } from "node:crypto";

export type CommissionSourceKind =
  | "SERVICE"
  | "PRODUCT"
  | "PACKAGE_PURCHASE"
  | "PACKAGE_REDEMPTION";
export type CommissionRuleKind = "PERCENTAGE" | "FIXED_AMOUNT" | "TIERED_PERCENTAGE";
export type CommissionRuleScopeKind = "ALL" | "CATEGORY" | "ITEM" | "MEMBER";
export type CommissionBasisKind = "GROSS" | "NET_AFTER_DISCOUNT";

export type CommissionTier = {
  fromCents: number;
  rateBasisPoints: number;
};

export type CommissionRuleCandidate = {
  id: string;
  ruleId: string;
  revision: number;
  sourceType: CommissionSourceKind;
  branchId: string | null;
  scope: CommissionRuleScopeKind;
  scopeId: string | null;
  itemId: string | null;
  ruleType: CommissionRuleKind;
  basis: CommissionBasisKind;
  rateBasisPoints: number | null;
  fixedAmountCents: number | null;
  tiers: unknown;
  priority: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

export type CommissionSource = {
  id: string;
  membershipId?: string | null;
  sourceType: CommissionSourceKind;
  branchId: string | null;
  sourceItemId: string | null;
  sourceCategoryId: string | null;
  eventAt: Date;
  quantity: number;
  grossAmountCents: number;
  discountAmountCents: number;
  netAmountCents: number;
  grossBasisOverride: boolean;
};

export type CommissionCalculation = {
  eligibleAmountCents: number;
  commissionAmountCents: number;
  trace: Record<string, unknown>;
};

const SCOPE_WEIGHT: Record<CommissionRuleScopeKind, number> = {
  ALL: 0,
  CATEGORY: 1,
  ITEM: 2,
  MEMBER: 3,
};

function scopeWeight(rule: CommissionRuleCandidate) {
  return rule.scope === "MEMBER" && rule.itemId ? 4 : SCOPE_WEIGHT[rule.scope];
}

export function allocateDiscountCents(
  grossLineCents: readonly number[],
  discountCents: number,
): number[] {
  grossLineCents.forEach((value) => assertNonnegativeInteger(value, "gross line"));
  assertNonnegativeInteger(discountCents, "discount");
  const total = grossLineCents.reduce((sum, value) => sum + value, 0);
  if (discountCents === 0 || total === 0) return grossLineCents.map(() => 0);
  const capped = Math.min(discountCents, total);
  const allocations = grossLineCents.map((value) => Math.floor((capped * value) / total));
  const remainder = capped - allocations.reduce((sum, value) => sum + value, 0);
  const ranked = grossLineCents
    .map((value, index) => ({
      index,
      remainder: (capped * value) % total,
    }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) {
    allocations[ranked[index].index] += 1;
  }
  return allocations;
}

export function resolveCommissionRule(
  source: CommissionSource,
  candidates: readonly CommissionRuleCandidate[],
): { rule: CommissionRuleCandidate | null; trace: Record<string, unknown> } {
  const eligible = candidates.filter((rule) => {
    if (rule.sourceType !== source.sourceType) return false;
    if (rule.branchId !== null && rule.branchId !== source.branchId) return false;
    if (source.eventAt < startOfUtcDay(rule.effectiveFrom)) return false;
    if (rule.effectiveUntil && source.eventAt >= nextUtcDay(rule.effectiveUntil)) return false;
    if (rule.scope === "ITEM") return Boolean(rule.scopeId && rule.scopeId === source.sourceItemId);
    if (rule.scope === "CATEGORY") {
      return Boolean(rule.scopeId && rule.scopeId === source.sourceCategoryId);
    }
    if (rule.scope === "MEMBER") {
      if (!rule.scopeId || rule.scopeId !== source.membershipId) return false;
      return rule.itemId === null || rule.itemId === source.sourceItemId;
    }
    return rule.scopeId === null;
  });
  eligible.sort(
    (a, b) =>
      scopeWeight(b) - scopeWeight(a) ||
      Number(b.branchId !== null) - Number(a.branchId !== null) ||
      b.priority - a.priority ||
      b.revision - a.revision ||
      a.id.localeCompare(b.id),
  );
  const rule = eligible[0] ?? null;
  return {
    rule,
    trace: {
      candidateCount: candidates.length,
      eligibleRuleRevisionIds: eligible.map((candidate) => candidate.id),
      selectedRuleRevisionId: rule?.id ?? null,
      policy: "MEMBER_ITEM_THEN_MEMBER_THEN_ITEM_THEN_CATEGORY_THEN_ALL_NO_STACKING",
    },
  };
}

export function calculateCommission(
  source: CommissionSource,
  rule: CommissionRuleCandidate,
  periodEligibleCents?: number,
): CommissionCalculation {
  validateSource(source);
  const eligibleAmountCents = commissionEligibleAmountCents(source, rule);
  let commissionAmountCents: number;
  let appliedRateBasisPoints: number | null = null;
  if (rule.ruleType === "FIXED_AMOUNT") {
    const fixed = requiredNonnegativeInteger(rule.fixedAmountCents, "fixed amount");
    commissionAmountCents = fixed * source.quantity;
  } else if (rule.ruleType === "PERCENTAGE") {
    appliedRateBasisPoints = requiredRate(rule.rateBasisPoints);
    commissionAmountCents = percentageCents(eligibleAmountCents, appliedRateBasisPoints);
  } else {
    const tiers = parseCommissionTiers(rule.tiers);
    const periodTotal = requiredNonnegativeInteger(periodEligibleCents, "period eligible amount");
    appliedRateBasisPoints = [...tiers]
      .reverse()
      .find((tier) => periodTotal >= tier.fromCents)!.rateBasisPoints;
    commissionAmountCents = percentageCents(eligibleAmountCents, appliedRateBasisPoints);
  }
  return {
    eligibleAmountCents,
    commissionAmountCents,
    trace: {
      sourceEventId: source.id,
      ruleRevisionId: rule.id,
      ruleType: rule.ruleType,
      basis: rule.basis,
      basisOverride: source.grossBasisOverride ? "TRAINING_COMPLIMENTARY_GROSS" : null,
      eligibleAmountCents,
      quantity: source.quantity,
      appliedRateBasisPoints,
      fixedAmountCents: rule.fixedAmountCents,
      periodEligibleCents: rule.ruleType === "TIERED_PERCENTAGE" ? periodEligibleCents : null,
      rounding: "INTEGER_CENTS_HALF_UP",
    },
  };
}

export function commissionEligibleAmountCents(
  source: CommissionSource,
  rule: Pick<CommissionRuleCandidate, "basis">,
) {
  return source.grossBasisOverride || rule.basis === "GROSS"
    ? source.grossAmountCents
    : source.netAmountCents;
}

export function parseCommissionTiers(value: unknown): CommissionTier[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Tiered commission requires at least one tier.");
  }
  const tiers = value.map((tier, index) => {
    if (!tier || typeof tier !== "object") throw new Error(`Tier ${index + 1} is invalid.`);
    const record = tier as Record<string, unknown>;
    return {
      fromCents: requiredNonnegativeInteger(record.fromCents, `tier ${index + 1} threshold`),
      rateBasisPoints: requiredRate(record.rateBasisPoints),
    };
  });
  tiers.sort((a, b) => a.fromCents - b.fromCents);
  if (tiers[0].fromCents !== 0) throw new Error("The first tier must start at zero.");
  if (new Set(tiers.map((tier) => tier.fromCents)).size !== tiers.length) {
    throw new Error("Tier thresholds must be unique.");
  }
  return tiers;
}

export function stableCommissionDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function moneyToCents(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Money value is invalid.");
  return Math.round((number + Number.EPSILON) * 100);
}

export function centsToMoney(cents: number) {
  if (!Number.isInteger(cents)) throw new Error("Money cents must be an integer.");
  return (cents / 100).toFixed(2);
}

function percentageCents(amountCents: number, basisPoints: number) {
  return Math.floor((amountCents * basisPoints + 5_000) / 10_000);
}

function validateSource(source: CommissionSource) {
  assertNonnegativeInteger(source.quantity, "quantity");
  if (source.quantity < 1) throw new Error("Quantity must be at least one.");
  assertNonnegativeInteger(source.grossAmountCents, "gross amount");
  assertNonnegativeInteger(source.discountAmountCents, "discount amount");
  assertNonnegativeInteger(source.netAmountCents, "net amount");
  if (source.discountAmountCents > source.grossAmountCents) {
    throw new Error("Discount cannot exceed gross amount.");
  }
  if (source.netAmountCents !== source.grossAmountCents - source.discountAmountCents) {
    throw new Error("Net amount must equal gross less allocated discount.");
  }
}

function requiredRate(value: unknown) {
  const rate = requiredNonnegativeInteger(value, "commission rate");
  if (rate > 10_000) throw new Error("Commission rate exceeds the supported limit of 100%.");
  return rate;
}

function requiredNonnegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertNonnegativeInteger(value: number, label: string) {
  requiredNonnegativeInteger(value, label);
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function nextUtcDay(date: Date) {
  const result = startOfUtcDay(date);
  result.setUTCDate(result.getUTCDate() + 1);
  return result;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}
