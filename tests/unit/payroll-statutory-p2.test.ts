import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveApplicableStatutoryRule,
  resolveComponentTreatment,
  resolveStatutorySchemeEligibility,
} from "../../src/lib/payroll/statutory-p2";
import { buildStatutoryDeductionComponents } from "../../src/lib/payroll/component-calculation";
import { isStatutorySnapshotSourceCurrent } from "../../src/lib/payroll/readiness";

const period = new Date("2026-08-01T00:00:00.000Z");

test("Draft statutory readiness detects a changed or retired verified source", () => {
  const snapshot = {
    ruleSetId: "rule-1",
    ruleVersionSnapshot: "EPF_2025_10",
    artifactDigestSnapshot: "artifact",
    datasetDigestSnapshot: "dataset",
    fixtureDigestSnapshot: "fixture",
    classificationVersionSnapshot: "classification",
    parserVersionSnapshot: "2.0.0",
    calculatorVersionSnapshot: "calculator",
  };
  const activeRule = {
    id: "rule-1",
    version: "EPF_2025_10",
    sourceDigest: "artifact",
    datasetDigest: "dataset",
    goldenFixtureDigest: "fixture",
    classificationVersion: "classification",
    parserVersion: "2.0.0",
    calculatorVersion: "calculator",
  };

  assert.equal(isStatutorySnapshotSourceCurrent(snapshot, activeRule), true);
  assert.equal(
    isStatutorySnapshotSourceCurrent(snapshot, { ...activeRule, datasetDigest: "changed" }),
    false,
  );
  assert.equal(isStatutorySnapshotSourceCurrent(snapshot, undefined), false);
});

test("statutory rule selection uses the payroll period and never the current date", () => {
  const selected = resolveApplicableStatutoryRule([
    {
      id: "old",
      scheme: "EPF",
      version: "OLD",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-01-01T00:00:00.000Z"),
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
    },
    {
      id: "current",
      scheme: "EPF",
      version: "CURRENT",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
    },
    {
      id: "future",
      scheme: "EPF",
      version: "FUTURE",
      effectiveFrom: new Date("2027-01-01T00:00:00.000Z"),
      effectiveTo: null,
      readiness: "METADATA_ONLY",
      status: "DRAFT",
    },
  ], "EPF", period);
  assert.equal(selected?.id, "current");
});

test("overlapping active rules fail closed", () => {
  assert.throws(() => resolveApplicableStatutoryRule([
    {
      id: "one",
      scheme: "SOCSO",
      version: "ONE",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
    },
    {
      id: "two",
      scheme: "SOCSO",
      version: "TWO",
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      effectiveTo: null,
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
    },
  ], "SOCSO", period), /STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP/);
});

test("classification is scheme-specific and unknown never defaults included or excluded", () => {
  const classifications = [{
    id: "epf-basic",
    componentCode: "BASIC_SALARY",
    sourceType: "BASIC_SALARY",
    treatment: "INCLUDED" as const,
    rationale: "Official EPF wages classification.",
  }];
  assert.equal(resolveComponentTreatment({
    componentCode: "BASIC_SALARY",
    componentSourceType: "BASIC_SALARY",
    classifications,
  })?.treatment, "INCLUDED");
  assert.equal(resolveComponentTreatment({
    componentCode: "CUSTOM_BONUS_X",
    componentSourceType: "VARIABLE_PAY",
    classifications,
  }), null);
});

test("EIS eligibility distinguishes legitimate ineligibility from missing profile facts", () => {
  const profile = {
    dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
    statutoryNationality: "MALAYSIAN" as const,
    epfEnabled: false,
    epfMemberBeforeAug1998: false,
    socsoEnabled: true,
    socsoCategory: "FIRST" as const,
    eisEnabled: true,
    eisPreviouslyContributed: false,
    lindung24OptIn: false,
    statutoryProfileRevision: 1,
    taxProfileRevision: 0,
    taxIdentificationNumber: null,
  };
  assert.deepEqual(
    resolveStatutorySchemeEligibility({ scheme: "EIS", statutoryPeriod: period, profile }),
    { status: "APPLICABLE" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EIS",
      statutoryPeriod: period,
      profile: { ...profile, statutoryNationality: "NON_MALAYSIAN" },
    }),
    { status: "NOT_APPLICABLE", reason: "EIS_NON_MALAYSIAN" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EIS",
      statutoryPeriod: period,
      profile: { ...profile, dateOfBirth: null },
    }),
    { status: "PROFILE_INCOMPLETE", missing: ["dateOfBirth"] },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EIS",
      statutoryPeriod: period,
      profile: { ...profile, dateOfBirth: new Date("1968-01-01T00:00:00.000Z") },
    }),
    { status: "NOT_APPLICABLE", reason: "EIS_AGE_57_PLUS_NO_PRIOR_CONTRIBUTION" },
  );
});

test("EPF category selection uses frozen DOB, nationality and pre-1998 election facts", () => {
  const profile = {
    dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
    statutoryNationality: "MALAYSIAN" as const,
    epfEnabled: true,
    epfMemberBeforeAug1998: false,
    socsoEnabled: false,
    socsoCategory: null,
    eisEnabled: false,
    eisPreviouslyContributed: false,
    lindung24OptIn: false,
    statutoryProfileRevision: 1,
    taxProfileRevision: 0,
    taxIdentificationNumber: null,
  };
  assert.deepEqual(
    resolveStatutorySchemeEligibility({ scheme: "EPF", statutoryPeriod: period, profile }),
    { status: "APPLICABLE", epfCategory: "PART_A" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: { ...profile, dateOfBirth: new Date("1960-01-01T00:00:00.000Z") },
    }),
    { status: "APPLICABLE", epfCategory: "PART_E" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: {
        ...profile,
        statutoryNationality: "PERMANENT_RESIDENT",
        dateOfBirth: new Date("1960-01-01T00:00:00.000Z"),
      },
    }),
    { status: "APPLICABLE", epfCategory: "PART_C" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: { ...profile, statutoryNationality: "NON_MALAYSIAN" },
    }),
    { status: "APPLICABLE", epfCategory: "PART_F" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: {
        ...profile,
        statutoryNationality: "NON_MALAYSIAN",
        epfMemberBeforeAug1998: true,
      },
    }),
    { status: "APPLICABLE", epfCategory: "PART_A" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: { ...profile, statutoryNationality: null },
    }),
    { status: "PROFILE_INCOMPLETE", missing: ["statutoryNationality"] },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: { ...profile, dateOfBirth: new Date("2015-01-01T00:00:00.000Z") },
    }),
    { status: "NOT_APPLICABLE", reason: "EPF_BELOW_MINIMUM_AGE_14" },
  );
  assert.deepEqual(
    resolveStatutorySchemeEligibility({
      scheme: "EPF",
      statutoryPeriod: period,
      profile: { ...profile, dateOfBirth: new Date("1950-01-01T00:00:00.000Z") },
    }),
    { status: "NOT_APPLICABLE", reason: "EPF_AGE_75_OR_ABOVE" },
  );
});

test("statutory employee deductions have stable P4B component provenance", () => {
  const lines = buildStatutoryDeductionComponents({
    epfEmployeeCents: 11000,
    socsoEmployeeCents: 1000,
    eisEmployeeCents: 200,
    lindung24EmployeeCents: 0,
    pcbCents: 4500,
  });
  assert.deepEqual(lines.map((line) => line.lineKey), [
    "STATUTORY:EPF_EMPLOYEE",
    "STATUTORY:SOCSO_EMPLOYEE",
    "STATUTORY:EIS_EMPLOYEE",
    "STATUTORY:PCB",
  ]);
  assert.ok(lines.every((line) => line.type === "DEDUCTION"));
  assert.ok(lines.every((line) => line.sourceType === "STATUTORY"));
});

test("Statutory P2 migration is additive and guards overlap and immutability", () => {
  const sql = readFileSync(
    new URL("../../prisma/migrations/20260809010000_statutory_p2_calculation_foundation/migration.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /statutory_rule_sets_overlap_guard/);
  assert.match(sql, /FINALIZED_STATUTORY_SNAPSHOT_IMMUTABLE/);
  assert.match(sql, /IMMUTABLE_STATUTORY_HISTORY/);
  assert.match(sql, /STATUTORY_RULE_EFFECTIVE_DATE_OVERLAP/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(sql, /COMMIT;\s*$/);
});
