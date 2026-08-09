import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  PCB_2026_BLOCKERS,
  aggregatePcb2026Remuneration,
  calculatePcb2026,
  roundPcbUpToFiveSen,
  type PCB2026CalculationInput,
} from "../../src/lib/payroll/pcb-2026";
import { goldenFixtureDigest } from "../../src/lib/payroll/statutory-artifact-pipeline";

const threeChildren = {
  under18Full: 3,
  under18Half: 0,
  studying18PlusFull: 0,
  studying18PlusHalf: 0,
  diplomaOrDegreeFull: 0,
  diplomaOrDegreeHalf: 0,
  disabledFull: 0,
  disabledHalf: 0,
  disabledStudyingFull: 0,
  disabledStudyingHalf: 0,
} as const;

function input(overrides: Partial<PCB2026CalculationInput> = {}): PCB2026CalculationInput {
  return {
    taxYear: 2026,
    calculationMonth: 1,
    taxRegime: "RESIDENT_STANDARD",
    employeeCategory: "CATEGORY_3",
    individualDisabled: false,
    spouseDisabled: false,
    children: threeChildren,
    priorGrossRemunerationCents: 0,
    priorEpfCents: 0,
    priorPcbCents: 0,
    accumulatedAllowableDeductionsCents: 0,
    accumulatedZakatCents: 0,
    currentNormalRemunerationCents: 550_000,
    currentNormalEpfCents: 60_500,
    currentAdditionalRemunerationCents: 0,
    currentAdditionalEpfCents: 0,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
    ...overrides,
  };
}

test("official specification example: January normal remuneration is RM110.00", () => {
  const result = calculatePcb2026(input());
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 11_000);
  if (result.status === "CALCULATED") {
    assert.equal(result.trace.normalProjectedEpfCents, 30_863);
    assert.equal(result.trace.normalChargeableIncomeCents, 4_700_007);
  }
});

test("official specification example: February YTD progression remains RM110.00", () => {
  const result = calculatePcb2026(input({
    calculationMonth: 2,
    priorGrossRemunerationCents: 550_000,
    priorEpfCents: 60_500,
    priorPcbCents: 11_000,
  }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 11_000);
});

test("official specification example: March TP1 deductions produce RM108.20", () => {
  const result = calculatePcb2026(input({
    calculationMonth: 3,
    priorGrossRemunerationCents: 1_100_000,
    priorEpfCents: 121_000,
    priorPcbCents: 22_000,
    currentAllowableDeductionsCents: 30_000,
  }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 10_820);
});

test("official specification example: April bonus uses additional-remuneration Steps 1-5", () => {
  const result = calculatePcb2026(input({
    calculationMonth: 4,
    priorGrossRemunerationCents: 1_650_000,
    priorEpfCents: 181_500,
    priorPcbCents: 32_820,
    accumulatedAllowableDeductionsCents: 30_000,
    currentAllowableDeductionsCents: 30_000,
    currentAdditionalRemunerationCents: 825_000,
    currentAdditionalEpfCents: 90_800,
  }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 83_370);
  if (result.status === "CALCULATED") {
    assert.equal(result.trace.normalMtdBeforeCurrentRebatesCents, 10_620);
    assert.equal(result.trace.additionalMtdCents, 72_750);
    assert.equal(result.trace.additionalChargeableIncomeCents, 5_465_000);
  }
});

test("official calculator cross-check: January RM5,500 with no EPF is RM134.20", () => {
  const result = calculatePcb2026(input({ currentNormalEpfCents: 0 }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 13_420);
});

test("zero PCB is calculated rather than blocked", () => {
  const result = calculatePcb2026(input({
    currentNormalRemunerationCents: 100_000,
    currentNormalEpfCents: 11_000,
    children: { ...threeChildren, under18Full: 0 },
  }));
  assert.deepEqual({ status: result.status, amountCents: result.amountCents }, { status: "CALCULATED", amountCents: 0 });
});

test("five-sen rounding always rounds upward and preserves exact five-sen values", () => {
  assert.equal(roundPcbUpToFiveSen(1_001), 1_005);
  assert.equal(roundPcbUpToFiveSen(1_005), 1_005);
  assert.equal(roundPcbUpToFiveSen(1_009), 1_010);
});

test("current zakat can reduce a valid pre-zakat deduction below RM10 without becoming blocked", () => {
  const result = calculatePcb2026(input({ currentZakatCents: 10_500 }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 500);
});

test("REP and knowledge-worker regimes apply the official 15% rate and low-income rebate", () => {
  const rep = calculatePcb2026(input({
    taxRegime: "RETURNING_EXPERT_PROGRAM",
    currentNormalRemunerationCents: 300_000,
    currentNormalEpfCents: 0,
    children: { ...threeChildren, under18Full: 0 },
  }));
  const knowledgeWorker = calculatePcb2026(input({
    taxRegime: "KNOWLEDGE_WORKER",
    employeeCategory: "CATEGORY_2",
    currentNormalRemunerationCents: 300_000,
    currentNormalEpfCents: 0,
    children: { ...threeChildren, under18Full: 0 },
  }));
  assert.deepEqual({ status: rep.status, amountCents: rep.amountCents }, { status: "CALCULATED", amountCents: 30_420 });
  assert.deepEqual(
    { status: knowledgeWorker.status, amountCents: knowledgeWorker.amountCents },
    { status: "CALCULATED", amountCents: 22_085 },
  );
});

test("official C-Suite test-pack inputs use the 15% formula with relief, YTD PCB and current rebates", () => {
  const result = calculatePcb2026(input({
    calculationMonth: 7,
    taxRegime: "C_SUITE_NON_CITIZEN",
    employeeCategory: "CATEGORY_2",
    children: {
      ...threeChildren,
      under18Full: 1,
      disabledStudyingFull: 1,
    },
    priorGrossRemunerationCents: 6_360_000,
    priorEpfCents: 400_000,
    priorPcbCents: 300_000,
    currentNormalRemunerationCents: 2_050_000,
    currentNormalEpfCents: 0,
    currentAllowableDeductionsCents: 50_000,
    currentZakatCents: 100_000,
  }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 227_750);
  if (result.status === "CALCULATED") {
    assert.equal(result.trace.normalChargeableIncomeCents, 15_110_000);
    assert.equal(result.trace.normalBracket.ratePercent, 15);
  }
});

test("non-resident remuneration follows the official 30% formula and ignores resident reliefs", () => {
  const result = calculatePcb2026(input({
    taxRegime: "NON_RESIDENT",
    currentNormalRemunerationCents: 1_000_000,
    currentNormalEpfCents: 0,
    currentAdditionalRemunerationCents: 100_000,
    currentAllowableDeductionsCents: 900_000,
    currentZakatCents: 500_000,
  }));
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.amountCents, 330_000);
  if (result.status === "CALCULATED") {
    assert.equal(result.trace.taxRegime, "NON_RESIDENT");
    assert.equal(result.trace.normalBracket.ratePercent, 30);
    assert.equal(result.trace.baseIndividualReliefCents, 0);
  }
});

test("unsafe and negative monetary inputs are rejected", () => {
  const negative = calculatePcb2026(input({ priorPcbCents: -1 }));
  const unsafe = calculatePcb2026(input({ currentNormalRemunerationCents: Number.MAX_SAFE_INTEGER + 1 }));
  assert.equal(negative.status, "BLOCKED");
  assert.equal(unsafe.status, "BLOCKED");
});

test("component classification aggregates normal and additional lines and fails closed on unknown", () => {
  const classified = aggregatePcb2026Remuneration([
    { code: "BASIC_SALARY", amountCents: 500_000, treatment: "NORMAL_REMUNERATION" },
    { code: "BONUS", amountCents: 100_000, treatment: "ADDITIONAL_REMUNERATION" },
    { code: "COMMISSION", amountCents: 50_000, treatment: "ADDITIONAL_REMUNERATION" },
    { code: "REIMBURSEMENT", amountCents: 20_000, treatment: "EXCLUDED" },
    { code: "CUSTOM_PAY", amountCents: 10_000, treatment: "UNKNOWN" },
  ]);
  assert.equal(classified.normalRemunerationCents, 500_000);
  assert.equal(classified.additionalRemunerationCents, 150_000);
  assert.deepEqual(classified.unknownComponentCodes, ["CUSTOM_PAY"]);
  assert.deepEqual(classified.blockers, [PCB_2026_BLOCKERS.CLASSIFICATION_REQUIRED]);
});

test("January never carries previous tax-year values unless supplied in the frozen input", () => {
  const cleanJanuary = calculatePcb2026(input());
  const nextJanuary = calculatePcb2026(input({ taxYear: 2027 }));
  assert.equal(cleanJanuary.status, "CALCULATED");
  assert.equal(nextJanuary.status, "BLOCKED");
  assert.deepEqual(nextJanuary.blockers, [PCB_2026_BLOCKERS.UNSUPPORTED_TAX_YEAR]);
});

test("every retained official PCB fixture exactly matches the pure calculator", () => {
  const fixtureSet = JSON.parse(readFileSync(resolve("statutory/official/fixtures/hasil-pcb-2026-official-golden-v1.json"), "utf8")) as {
    fixtureDigest: string;
    fixtures: Array<{ input: PCB2026CalculationInput; expected: Record<string, number> }>;
  };
  assert.equal(goldenFixtureDigest(fixtureSet as never), fixtureSet.fixtureDigest);
  for (const fixture of fixtureSet.fixtures) {
    const result = calculatePcb2026(fixture.input);
    assert.equal(result.status, "CALCULATED");
    if (result.status !== "CALCULATED") continue;
    assert.equal(result.amountCents, fixture.expected.amountCents);
    if (fixture.expected.normalProjectedEpfCents !== undefined) {
      assert.equal(result.trace.normalProjectedEpfCents, fixture.expected.normalProjectedEpfCents);
    }
    if (fixture.expected.normalChargeableIncomeCents !== undefined) {
      assert.equal(result.trace.normalChargeableIncomeCents, fixture.expected.normalChargeableIncomeCents);
    }
    if (fixture.expected.normalMtdCents !== undefined) {
      assert.equal(result.trace.normalMtdBeforeCurrentRebatesCents, fixture.expected.normalMtdCents);
    }
    if (fixture.expected.additionalMtdCents !== undefined) {
      assert.equal(result.trace.additionalMtdCents, fixture.expected.additionalMtdCents);
    }
    if (fixture.expected.additionalChargeableIncomeCents !== undefined) {
      assert.equal(result.trace.additionalChargeableIncomeCents, fixture.expected.additionalChargeableIncomeCents);
    }
  }
});
