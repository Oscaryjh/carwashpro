import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateLeaveEntitlement,
  completedServiceMonths,
  evaluateLeaveEligibility,
  resolveEntitlementPeriod,
  resolveTierUnits,
  roundLeaveUnits,
} from "../../src/lib/leave/entitlement-engine";

const eligible = {
  status: "ELIGIBLE",
  code: "ELIGIBLE",
  explanation: "Eligible.",
} as const;

test("completed service months changes only on the exact monthly anniversary", () => {
  const joinedAt = new Date("2024-08-17T00:00:00.000Z");
  assert.equal(completedServiceMonths(joinedAt, new Date("2026-08-16T00:00:00.000Z")), 23);
  assert.equal(completedServiceMonths(joinedAt, new Date("2026-08-17T00:00:00.000Z")), 24);
});

test("service-anniversary periods contain the requested as-of date", () => {
  const period = resolveEntitlementPeriod({
    type: "SERVICE_ANNIVERSARY",
    joinedAt: new Date("2024-10-15T00:00:00.000Z"),
    asOf: new Date("2026-01-20T00:00:00.000Z"),
  });
  assert.equal(period.start.toISOString(), "2025-10-15T00:00:00.000Z");
  assert.equal(period.end.toISOString(), "2026-10-14T00:00:00.000Z");
});

test("service tiers are inclusive and deterministic at their exact boundaries", () => {
  const tiers = [
    { minServiceMonths: 0, maxServiceMonths: 23, entitlementUnits: 8 },
    { minServiceMonths: 24, maxServiceMonths: 59, entitlementUnits: 12 },
    { minServiceMonths: 60, maxServiceMonths: null, entitlementUnits: 16 },
  ];
  assert.equal(resolveTierUnits(tiers, 23), 8);
  assert.equal(resolveTierUnits(tiers, 24), 12);
  assert.equal(resolveTierUnits(tiers, 59), 12);
  assert.equal(resolveTierUnits(tiers, 60), 16);
});

test("employment-type eligibility is explicit and never inferred", () => {
  const result = evaluateLeaveEligibility({
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    employmentType: "PART_TIME",
    eligibleEmploymentTypes: ["FULL_TIME"],
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T00:00:00.000Z"),
  });
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.equal(result.code, "EMPLOYMENT_TYPE_NOT_ELIGIBLE");
});

test("event-based entitlement remains review-required instead of auto-granted", () => {
  const result = evaluateLeaveEligibility({
    joinedAt: new Date("2025-01-01T00:00:00.000Z"),
    employmentType: "FULL_TIME",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T00:00:00.000Z"),
    entitlementSemantics: "EVENT_BASED",
  });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.code, "EVENT_EVIDENCE_REQUIRED");
});

test("company overlay cannot reduce the active statutory minimum", () => {
  const result = calculateLeaveEntitlement({
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T00:00:00.000Z"),
    joinedAt: new Date("2020-01-01T00:00:00.000Z"),
    eligibility: eligible,
    serviceTiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 10 }],
    statutoryTiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 14 }],
    prorationMethod: "NONE",
    rounding: "NONE",
  });
  assert.equal(result.companyUnits, 10);
  assert.equal(result.statutoryUnits, 14);
  assert.equal(result.entitledUnits, 14);
});

test("calendar-day proration uses the leap-year denominator and configured rounding", () => {
  const result = calculateLeaveEntitlement({
    periodStart: new Date("2024-01-01T00:00:00.000Z"),
    periodEnd: new Date("2024-12-31T00:00:00.000Z"),
    joinedAt: new Date("2024-07-01T00:00:00.000Z"),
    eligibility: eligible,
    serviceTiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 12 }],
    prorationMethod: "CALENDAR_DAY_RATIO",
    rounding: "UP_TO_HALF_DAY",
  });
  assert.equal(result.periodDays, 366);
  assert.equal(result.eligibleDays, 184);
  assert.equal(result.entitledUnits, 6.5);
});

test("all supported rounding strategies are stable", () => {
  assert.equal(roundLeaveUnits(6.24, "DOWN_TO_HALF_DAY"), 6);
  assert.equal(roundLeaveUnits(6.24, "NEAREST_HALF_DAY"), 6);
  assert.equal(roundLeaveUnits(6.24, "UP_TO_HALF_DAY"), 6.5);
  assert.equal(roundLeaveUnits(6.123456, "NONE"), 6.1235);
});
