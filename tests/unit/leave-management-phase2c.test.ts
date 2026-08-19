import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SABAH_LEAVE_EFFECTIVE_FROM,
  SABAH_LEAVE_JURISDICTION,
  SABAH_LEAVE_OFFICIAL_SOURCES,
  SABAH_LEAVE_RULE_PACK_VERSION,
  SABAH_STATUTORY_LEAVE_RULES,
  evaluateMaternityEvidence,
  evaluatePaternityEligibility,
  sabahRulePackDigest,
  statutoryWholeDayRound,
  validateSabahStatutoryRulePack,
} from "../../src/lib/leave/sabah-statutory-rule-pack";
import {
  calculateLeaveEntitlement,
  resolveTierUnits,
} from "../../src/lib/leave/entitlement-engine";

const migrationPath = "prisma/migrations/20260817235900_leave_management_phase2c_sabah_statutory_rule_pack/migration.sql";

test("Sabah statutory pack has a fixed version, exact jurisdiction and hashed official sources", () => {
  assert.equal(SABAH_LEAVE_RULE_PACK_VERSION, "MY-SABAH-LEAVE-2025-05");
  assert.equal(SABAH_LEAVE_JURISDICTION, "MY-SABAH");
  assert.equal(SABAH_LEAVE_EFFECTIVE_FROM, "2025-05-01");
  assert.equal(SABAH_LEAVE_OFFICIAL_SOURCES.length, 3);
  for (const source of SABAH_LEAVE_OFFICIAL_SOURCES) {
    assert.match(source.url, /^https:\/\//);
    assert.match(source.contentHash, /^[A-F0-9]{64}$/);
    assert.ok(source.section.length > 0);
  }
  const amendmentSource = SABAH_LEAVE_OFFICIAL_SOURCES.find((source) => source.title.includes("Act A1753"));
  assert.ok(amendmentSource);
  assert.match(amendmentSource.section, /paragraph 104E\(1\)\(ab\)/);
  assert.match(amendmentSource.section, /section 104EA/);
  assert.doesNotMatch(amendmentSource.section, /\b104D\b/);
  assert.match(sabahRulePackDigest(), /^[A-F0-9]{64}$/);
  assert.deepEqual(validateSabahStatutoryRulePack(), { valid: true, failures: [] });
});

test("annual and medical leave tiers preserve Sabah statutory category boundaries", () => {
  const annual = rule("ANNUAL_LEAVE");
  assert.equal(annual.entitlementPeriodType, "SERVICE_ANNIVERSARY");
  assert.equal(annual.prorationMethod, "COMPLETED_MONTHS");
  assert.equal(annual.entitlementRounding, "STATUTORY_WHOLE_DAY");
  assert.equal(resolveTierUnits(annual.tiers, 23), 8);
  assert.equal(resolveTierUnits(annual.tiers, 24), 12);
  assert.equal(resolveTierUnits(annual.tiers, 59), 12);
  assert.equal(resolveTierUnits(annual.tiers, 60), 16);
  assert.equal(annual.reviewMarkers.unauthorisedAbsenceThreshold, 0.1);
  assert.equal(annual.reviewMarkers.thresholdOutcome, "REVIEW_REQUIRED");

  const sick = rule("SICK_LEAVE");
  assert.deepEqual(sick.tiers.map((tier) => tier.entitlementUnits), [14, 18, 22]);
  assert.equal(sick.requiresDocument, true);
  const hospital = rule("HOSPITALISATION_LEAVE");
  assert.equal(hospital.tiers[0]?.entitlementUnits, 60);
  assert.equal(hospital.eventRules.separateBucket, true);
  assert.notEqual(sick.category, hospital.category);
});

test("completed-month termination proration and statutory whole-day rounding are deterministic", () => {
  for (const [raw, expected] of [[0.49, 0], [0.5, 1], [1.49, 1], [1.5, 2]] as const) {
    assert.equal(statutoryWholeDayRound(raw), expected);
  }
  const calculation = calculateLeaveEntitlement({
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    periodEnd: new Date("2026-12-31T00:00:00.000Z"),
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    terminatedAt: new Date("2026-06-30T00:00:00.000Z"),
    eligibility: { status: "ELIGIBLE", code: "ELIGIBLE", explanation: "fixture" },
    serviceTiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 8 }],
    statutoryTiers: [{ minServiceMonths: 0, maxServiceMonths: null, entitlementUnits: 8 }],
    prorationMethod: "COMPLETED_MONTHS",
    rounding: "STATUTORY_WHOLE_DAY",
  });
  assert.equal(calculation.prorationFactor, 0.5);
  assert.equal(calculation.rawEntitledUnits, 4);
  assert.equal(calculation.entitledUnits, 4);
});

test("event leave remains evidence-driven and never creates a balance bucket", () => {
  const maternity = rule("MATERNITY_LEAVE");
  assert.equal(maternity.entitlementSemantics, "EVENT_BASED");
  assert.equal(maternity.eventRules.durationCalendarDays, 98);
  assert.equal(maternity.eventRules.leaveEligibilitySeparateFromAllowanceEligibility, true);
  assert.equal(maternity.eventRules.allowanceEligibilityNotInferredFromPaidFlag, true);
  assert.equal(maternity.eventRules.leaveCommencementSource, "SECTION_83_3_4");
  assert.equal(maternity.eventRules.allowanceEligibilitySource, "SECTION_83_5_6");
  assert.equal(maternity.eventRules.noticeSource, "SECTION_87");
  assert.equal(maternity.eventRules.allowanceEmploymentLookbackMonths, 4);
  assert.equal(maternity.eventRules.allowanceMinimumEmploymentDays, 90);
  assert.equal(maternity.eventRules.allowanceMeasurementWindowMonths, 9);
  assert.equal(maternity.eventRules.allowanceMaximumSurvivingChildren, 4);
  assert.match(maternity.statutorySection, /section 83/i);
  assert.match(maternity.statutorySection, /section 87/i);
  assert.match(maternity.statutorySection, /section 84 deleted/i);
  assert.doesNotMatch(maternity.statutorySection, /sections 83[-–]84/i);
  assert.equal(maternity.tiers.length, 0);
  assert.equal(evaluateMaternityEvidence({ confinementDate: "2026-08-01" }).leaveEligibility, "ELIGIBLE");
  assert.equal(evaluateMaternityEvidence({}).allowanceEligibility, "REVIEW_REQUIRED");

  const paternity = rule("PATERNITY_LEAVE");
  assert.equal(paternity.eventRules.durationCalendarDays, 7);
  assert.equal(paternity.eventRules.consecutive, true);
  assert.equal(paternity.eventRules.includesRestAndPublicHolidays, true);
  assert.equal(evaluatePaternityEligibility({}), "REVIEW_REQUIRED");
  assert.equal(evaluatePaternityEligibility({ marriedMaleEmployee: true, immediateServiceMonths: 11, priorConfinements: 0, pregnancyWeeks: 40, birthOutcome: "LIVE_BIRTH", noticeRecorded: true }), "NOT_ELIGIBLE");
  assert.equal(evaluatePaternityEligibility({ marriedMaleEmployee: true, immediateServiceMonths: 12, priorConfinements: 0, pregnancyWeeks: 40, birthOutcome: "LIVE_BIRTH", noticeRecorded: true }), "ELIGIBLE");

  const unpaid = rule("UNPAID_LEAVE");
  assert.equal(unpaid.entitlementSemantics, "NON_ACCRUAL");
  assert.equal(unpaid.eventRules.balanceTracked, false);
  assert.equal(unpaid.tiers.length, 0);
});

test("Phase 2C migration governs immutable evidence, workflow and request snapshots", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /READY_FOR_HUMAN_SIGN_OFF/);
  assert.match(migration, /DRAFT' AND NEW\.status = 'READY_FOR_REVIEW'/);
  assert.match(migration, /READY_FOR_REVIEW' AND NEW\.status = 'READY_FOR_HUMAN_SIGN_OFF'/);
  assert.match(migration, /READY_FOR_HUMAN_SIGN_OFF' AND NEW\.status = 'ACTIVE'/);
  assert.match(migration, /Reviewed Leave statutory source evidence is immutable/);
  assert.match(migration, /Overlapping active Leave statutory rule packs are not allowed/);
  assert.match(migration, /jurisdiction_code_snapshot/);
  assert.match(migration, /statutory_rule_set_version_snapshot/);
  assert.match(migration, /statutory_eligibility_snapshot/);
  assert.match(migration, /compliance_status_snapshot/);
  assert.match(migration, /Leave request statutory decision snapshots are immutable/);
  assert.match(migration, /Legacy rows without a recognised workplace jurisdiction remain unconfigured/);
  assert.doesNotMatch(migration, /jurisdiction_code" VARCHAR\(32\) NOT NULL DEFAULT 'MY-SABAH'/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+"leave_statutory_/i);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE/i);
});

test("exact workplace jurisdiction has no nationwide fallback and business UI cannot activate packs", async () => {
  const [service, actions, page] = await Promise.all([
    readFile("src/lib/leave/service.ts", "utf8"),
    readFile("src/app/(business)/team/leave/actions.ts", "utf8"),
    readFile("src/app/(business)/team/leave/page.tsx", "utf8"),
  ]);
  assert.match(service, /NO_ACTIVE_EXACT_JURISDICTION_RULE/);
  assert.match(service, /no active statutory rule matches exact workplace jurisdiction/);
  assert.match(service, /jurisdictionCode,/);
  assert.doesNotMatch(service, /jurisdictionStateCode:\s*null/);
  assert.doesNotMatch(actions, /activateStatutoryRuleSetAction/);
  assert.doesNotMatch(page, /activateStatutoryRuleSetAction/);
  assert.match(page, /Ready for human sign-off/);
});

function rule<TCategory extends typeof SABAH_STATUTORY_LEAVE_RULES[number]["category"]>(
  category: TCategory,
): Extract<typeof SABAH_STATUTORY_LEAVE_RULES[number], { category: TCategory }> {
  const found = SABAH_STATUTORY_LEAVE_RULES.find((candidate) => candidate.category === category);
  assert.ok(found, `Missing ${category} rule.`);
  return found as Extract<typeof SABAH_STATUTORY_LEAVE_RULES[number], { category: TCategory }>;
}
