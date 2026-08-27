import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { NormalizedContributionDataset } from "../../src/lib/payroll/statutory-artifact-pipeline";
import {
  calculateEis,
  calculateEpf,
  calculateLindung24,
  calculateSocso,
} from "../../src/lib/payroll/statutory-p2c";
import {
  resolveLindung24ParticipationForPeriod,
  type Lindung24ParticipationEvidence,
} from "../../src/lib/payroll/lindung24-participation";
import { hasOnlyNonProductionDeferredPcbBlocker } from "../../src/lib/payroll/readiness";

const epf = dataset("statutory/official/datasets/kwsp-third-schedule-2025-10.json");
const act4 = dataset("statutory/official/datasets/perkeso-act4-lindung24-2026-06.json");
const act800 = dataset("statutory/official/datasets/perkeso-act800-2024-10.review.json");
const wageCents = 300_000;

test("August 2026 RM3,000 statutory UAT reconciles to retained official tables", () => {
  const epfResult = calculateEpf({ dataset: epf, wageCents, category: "PART_A" });
  const socsoResult = calculateSocso({ dataset: act4, wageCents, category: "FIRST" });
  const eisResult = calculateEis({ dataset: act800, wageCents });
  const lindung24Result = calculateLindung24({ dataset: act4, wageCents });

  assert.deepEqual(
    [epfResult.employeeCents, epfResult.employerCents, epfResult.matchedRowKey],
    [33_000, 39_000, "EPF-151"],
  );
  assert.deepEqual(
    [socsoResult.employeeCents, socsoResult.employerCents, socsoResult.matchedRowKey],
    [1_475, 5_165, "ACT4-34"],
  );
  assert.deepEqual(
    [eisResult.employeeCents, eisResult.employerCents, eisResult.matchedRowKey],
    [590, 590, "ACT800-34"],
  );
  assert.deepEqual(
    [lindung24Result.employeeCents, lindung24Result.employerCents, lindung24Result.matchedRowKey],
    [2_215, 0, "ACT4-34"],
  );

  const baselineEmployeeDeductions =
    epfResult.employeeCents + socsoResult.employeeCents + eisResult.employeeCents;
  const employerStatutoryCost =
    epfResult.employerCents + socsoResult.employerCents + eisResult.employerCents;
  assert.equal(baselineEmployeeDeductions, 35_065);
  assert.equal(wageCents - baselineEmployeeDeductions, 264_935);
  assert.equal(employerStatutoryCost, 44_755);
});

test("official wage bands resolve below, at and above a boundary and at each ceiling", () => {
  assert.equal(calculateEpf({ dataset: epf, wageCents: 300_000, category: "PART_A" }).matchedRowKey, "EPF-151");
  assert.equal(calculateEpf({ dataset: epf, wageCents: 300_001, category: "PART_A" }).matchedRowKey, "EPF-152");
  assert.equal(calculateEpf({ dataset: epf, wageCents: 2_000_000, category: "PART_A" }).matchedRowKey, "EPF-401");
  assert.equal(calculateEpf({ dataset: epf, wageCents: 2_000_001, category: "PART_A" }).matchedRowKey, "EPF-PART_A-FORMULA");

  for (const [calculator, atKey, aboveKey] of [
    [(wage: number) => calculateSocso({ dataset: act4, wageCents: wage, category: "FIRST" }), "ACT4-64", "ACT4-65"],
    [(wage: number) => calculateEis({ dataset: act800, wageCents: wage }), "ACT800-64", "ACT800-65"],
    [(wage: number) => calculateLindung24({ dataset: act4, wageCents: wage }), "ACT4-64", "ACT4-65"],
  ] as const) {
    assert.equal(calculator(300_000).matchedRowKey.endsWith("34"), true);
    assert.equal(calculator(300_001).matchedRowKey.endsWith("35"), true);
    assert.equal(calculator(600_000).matchedRowKey, atKey);
    assert.equal(calculator(600_001).matchedRowKey, aboveKey);
    assert.equal(calculator(900_000).matchedRowKey, aboveKey);
  }
});

test("LINDUNG24 scenarios preserve opt-out, opt-in, foreign mandatory and selected-employer rules", () => {
  const localOptOut = resolve("MALAYSIAN", evidence({ status: "VOLUNTARY_OPT_OUT" }));
  const localOptIn = resolve("MALAYSIAN", evidence({ status: "VOLUNTARY_OPT_IN" }));
  const foreignMandatory = resolve("NON_MALAYSIAN", evidence({
    status: "MANDATORY",
    statutoryNationalitySnapshot: "NON_MALAYSIAN",
  }));
  const otherEmployer = resolve("MALAYSIAN", evidence({
    status: "VOLUNTARY_OPT_IN",
    employerContext: "MULTIPLE_EMPLOYER",
    selectedEmployer: "OTHER_EMPLOYER",
  }));

  assert.equal(localOptOut.status, "NO_CONTRIBUTION");
  assert.equal(localOptIn.status, "CONTRIBUTION_REQUIRED");
  assert.equal(foreignMandatory.status, "CONTRIBUTION_REQUIRED");
  assert.equal(otherEmployer.status, "NO_CONTRIBUTION");
  assert.equal(calculateLindung24({ dataset: act4, wageCents }).employeeCents, 2_215);
});

test("PCB may be deferred only as the sole explicit non-production UAT blocker", () => {
  const resolved = (scheme: "EPF" | "SOCSO" | "EIS" | "LINDUNG24") => ({
    scheme,
    status: scheme === "LINDUNG24" ? "NOT_APPLICABLE" as const : "CALCULATED" as const,
    blockerCode: null,
    evidenceNature: "SYNTHETIC_TESTING" as const,
    evidenceEnvironment: "TESTING" as const,
    fixturePurpose: "PAYROLL_PAYSLIP_UAT" as const,
    officialExportEligible: false,
  });
  assert.equal(hasOnlyNonProductionDeferredPcbBlocker([
    resolved("EPF"),
    resolved("SOCSO"),
    resolved("EIS"),
    resolved("LINDUNG24"),
    {
      scheme: "PCB",
      status: "BLOCKED",
      blockerCode: "PCB_PROFILE_INCOMPLETE",
      evidenceNature: "SYNTHETIC_TESTING",
      evidenceEnvironment: "TESTING",
      fixturePurpose: "PAYROLL_PAYSLIP_UAT",
      officialExportEligible: false,
    },
  ]), true);
});

function dataset(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as NormalizedContributionDataset;
}

function resolve(
  statutoryNationality: "MALAYSIAN" | "NON_MALAYSIAN",
  record: Lindung24ParticipationEvidence,
) {
  return resolveLindung24ParticipationForPeriod({
    businessId: record.businessId,
    membershipId: record.membershipId,
    statutoryPeriod: new Date("2026-08-01T00:00:00.000Z"),
    statutoryNationality,
    records: [record],
    environment: { APP_ENVIRONMENT: "testing" },
  });
}

function evidence(
  overrides: Partial<Lindung24ParticipationEvidence>,
): Lindung24ParticipationEvidence {
  return {
    id: "00000000-0000-4000-8000-000000000003",
    businessId: "00000000-0000-4000-8000-000000000001",
    membershipId: "00000000-0000-4000-8000-000000000002",
    revision: 1,
    effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
    effectiveToMonth: null,
    status: "VOLUNTARY_OPT_OUT",
    employerContext: "SINGLE_EMPLOYER",
    selectedEmployer: "CURRENT_BUSINESS",
    act4Covered: true,
    officialSubmittedAt: null,
    sourceType: null,
    sourceReference: null,
    sourceDigest: "a".repeat(64),
    evidenceNature: "SYNTHETIC_TESTING",
    evidenceEnvironment: "TESTING",
    fixturePurpose: "PAYROLL_PAYSLIP_UAT",
    officialExportEligible: false,
    statutoryNationalitySnapshot: "MALAYSIAN",
    ...overrides,
  };
}
