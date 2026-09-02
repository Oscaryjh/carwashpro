import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PCB_2026_CALCULATOR_VERSION,
  calculatePcb2026,
  calculatePcb2026ChildReliefCents,
  roundPcbUpToFiveSen,
  type PCB2026CalculationInput,
} from "../../src/lib/payroll/pcb-2026";
import {
  PCB_2026_INDEPENDENT_VERIFIER_VERSION,
  independentEmptyChildren,
  independentlyAllocateAnnualReliefCents,
  independentlyVerifyPcb2026,
  type IndependentPcbInput,
} from "../certification/pcb-2026-independent-verifier";
import {
  advanceLedger,
  monthInput,
  openLedger,
  pcb2026P2Questions,
} from "../certification/pcb-2026-p2-scenarios";
import {
  hasil2026Question1Fixture,
  hasil2026Question3Fixture,
  hasil2026Question5Fixture,
  HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS,
  HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS,
  hasil2026Question5HousingInterestAllocation,
} from "../fixtures/hasil-2026-testing-question-fixtures";

function production(input: IndependentPcbInput) {
  return calculatePcb2026(input as PCB2026CalculationInput);
}

function assertIndependentMatch(input: IndependentPcbInput, label: string) {
  const expected = independentlyVerifyPcb2026(input);
  const actual = production(input);
  assert.equal(actual.status, "CALCULATED", `${label}: production calculation blocked`);
  if (actual.status !== "CALCULATED") return expected;
  assert.equal(actual.amountCents, expected.amountCents, `${label}: final PCB`);
  assert.equal(actual.trace.normalProjectedEpfCents, expected.trace.projectedEpfWithoutAdditionalCents, `${label}: projected EPF`);
  assert.equal(actual.trace.normalChargeableIncomeCents, expected.trace.normalChargeableIncomeCents, `${label}: chargeable income`);
  assert.equal(actual.trace.normalBracket.annualTaxCents, expected.trace.normalAnnualTaxCents, `${label}: annual tax`);
  assert.equal(actual.trace.normalBracket.ratePercent, expected.trace.normalRatePercent, `${label}: tax rate`);
  assert.equal(actual.trace.normalBracket.bCents, expected.trace.normalBCents, `${label}: B amount`);
  assert.equal(actual.trace.normalRounding.truncatedToSenCents, expected.trace.normalRounding.truncatedToSenCents, `${label}: sen truncation`);
  assert.equal(actual.trace.normalRounding.roundedUpToFiveSenCents, expected.trace.normalRounding.roundedUpToFiveSenCents, `${label}: five-sen rounding`);
  assert.equal(actual.trace.normalRounding.postZakatAndLevyCents, expected.trace.normalRounding.postCurrentZakatAndLevyCents, `${label}: post-zakat/levy`);
  assert.equal(actual.trace.additionalChargeableIncomeCents, expected.trace.additionalChargeableIncomeCents, `${label}: additional chargeable income`);
  assert.equal(actual.trace.additionalBracket?.annualTaxCents ?? null, expected.trace.additionalAnnualTaxCents, `${label}: additional annual tax`);
  assert.equal(actual.trace.additionalMtdCents, expected.trace.additionalRounding?.roundedUpToFiveSenCents ?? 0, `${label}: additional MTD`);
  return expected;
}

function base(overrides: Partial<IndependentPcbInput> = {}): IndependentPcbInput {
  return {
    taxYear: 2026,
    calculationMonth: 12,
    taxRegime: "RESIDENT_STANDARD",
    employeeCategory: "CATEGORY_1",
    individualDisabled: false,
    spouseDisabled: false,
    children: independentEmptyChildren,
    priorGrossRemunerationCents: 0,
    priorEpfCents: 0,
    priorPcbCents: 0,
    accumulatedAllowableDeductionsCents: 0,
    accumulatedZakatCents: 0,
    currentNormalRemunerationCents: 1_000_000,
    currentNormalEpfCents: 0,
    currentAdditionalRemunerationCents: 0,
    currentAdditionalEpfCents: 0,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
    ...overrides,
  };
}

test("P2 verifier is explicitly independent and versioned", () => {
  assert.equal(PCB_2026_CALCULATOR_VERSION, "TETAMU_PCB_2026_1.2.0");
  assert.equal(PCB_2026_INDEPENDENT_VERIFIER_VERSION, "HASIL_2026_P2_INDEPENDENT_1.0.0");
  const verifierSource = readFileSync("tests/certification/pcb-2026-independent-verifier.ts", "utf8");
  assert.doesNotMatch(verifierSource, /from\s+["'][^"']*src\/lib\/payroll/);
  assert.doesNotMatch(verifierSource, /import\s*\([^)]*src\/lib\/payroll/);
});

test("Q5 governed evidence retains the exact written HASiL clarification", () => {
  const evidence = JSON.parse(readFileSync(
    "statutory/official/certifications/pcb-2026-p2/q5/hasil-clarification-resolution.json",
    "utf8",
  )) as {
    issueId: string;
    status: string;
    receivedOn: string;
    clarificationExactQuote: string;
  };
  assert.equal(evidence.issueId, "PCB2026-Q5-HOUSING-LOAN-INTEREST-ALLOCATION");
  assert.equal(evidence.status, "RESOLVED_BY_HASIL");
  assert.equal(evidence.receivedOn, "2026-08-28");
  assert.equal(
    evidence.clarificationExactQuote,
    "The loan interest relief should be claimed and\nproportionately allocated across 12 months\n(January - December 2026).",
  );
});

test("Q1 raw sports evidence remains RM1,350 while TP1 C6 is capped to RM1,000", () => {
  const evidence = hasil2026Question1Fixture.facts.reliefEvidence.find((item) => item.canonicalCategory === "C6");
  const allowed = hasil2026Question1Fixture.profile.tp1Declaration.entries.find((item) => item.categoryCode === "C6");
  assert.equal(evidence?.amountCents, 135_000);
  assert.equal(allowed?.amountCents, 100_000);
  assert.equal(hasil2026Question1Fixture.profile.currentAllowableDeductionsCents, 608_000);
});

test("Q3 and Q5 retain corrected official input transcriptions", () => {
  const q3Life = hasil2026Question3Fixture.profile.tp1Declaration.entries.find((item) => item.categoryCode === "C11");
  const q3Tourism = hasil2026Question3Fixture.profile.tp1Declaration.entries.find((item) => item.categoryCode === "C17");
  const q5ParentMedical = hasil2026Question5Fixture.profile.tp1Declaration.entries.find((item) => item.categoryCode === "C1");
  assert.equal(q3Life?.amountCents, 220_000);
  assert.equal(q3Tourism?.amountCents, 22_000);
  assert.equal(q5ParentMedical?.amountCents, 80_000);
});

for (const question of pcb2026P2Questions.filter((item) => item.question !== "Q5")) {
  test(`${question.question} sequential months independently reconcile to RM0.00`, () => {
    const ledger = openLedger(question);
    for (const month of question.months) {
      const input = monthInput(question, month, ledger);
      const result = assertIndependentMatch(input, `${question.question}-${String(month.month).padStart(2, "0")}`);
      advanceLedger(ledger, month, result.amountCents);
    }
  });
}

test("Q5 applies written HASiL clarification as RM500 per month from January to December", () => {
  const q5 = pcb2026P2Questions.find((item) => item.question === "Q5");
  assert.ok(q5);
  assert.equal(HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS, 600_000);
  assert.equal(HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS, 50_000);
  assert.equal(hasil2026Question5HousingInterestAllocation.length, 12);
  assert.deepEqual(
    hasil2026Question5HousingInterestAllocation.map((item) => item.month),
    Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`),
  );
  assert.ok(hasil2026Question5HousingInterestAllocation.every(
    (item) => item.amountCents === HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS,
  ));
  assert.equal(
    hasil2026Question5HousingInterestAllocation.reduce((total, item) => total + item.amountCents, 0),
    HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS,
  );
  assert.deepEqual(
    independentlyAllocateAnnualReliefCents(HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS, 12),
    Array(12).fill(HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS),
  );
  assert.equal(q5.months.length, 12);
  assert.ok(q5.months.every(
    (month) => month.housingLoanInterestReliefCents === HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS,
  ));
  assert.ok(q5.months.every((month) => month.housingLoanInterestReliefCents !== 600_000));
  assert.ok(q5.months.every((month) => month.housingLoanInterestReliefCents !== 300_000));
  assert.deepEqual(q5.requiredMonths, [1, 2]);
  assert.equal(q5.openAmbiguity, null);
});

test("Q5 full-year ledger independently reconciles without duplicate or missing relief", () => {
  const q5 = pcb2026P2Questions.find((item) => item.question === "Q5");
  assert.ok(q5);
  const ledger = openLedger(q5);
  const results = [];
  for (const month of q5.months) {
    const input = monthInput(q5, month, ledger);
    const result = assertIndependentMatch(input, `Q5-${String(month.month).padStart(2, "0")}`);
    results.push({ month: month.month, amountCents: result.amountCents });
    advanceLedger(ledger, month, result.amountCents);
  }
  assert.equal(results.length, 12);
  assert.ok(results.some((item) => item.month === 1));
  assert.ok(results.some((item) => item.month === 2));
  assert.equal(
    q5.months.reduce((total, month) => total + (month.housingLoanInterestReliefCents ?? 0), 0),
    HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS,
  );
  assert.equal(
    q5.months.reduce((total, month) => total + month.deductionsCents, 0),
    hasil2026Question5Fixture.profile.currentAllowableDeductionsCents,
  );
  assert.equal(ledger.deductionsCents, hasil2026Question5Fixture.profile.currentAllowableDeductionsCents);
});

test("official resident bracket boundaries reconcile independently", () => {
  for (const chargeableCents of [0, 500_000, 500_001, 2_000_000, 2_000_001, 3_500_000, 3_500_001, 5_000_000, 5_000_001, 7_000_001, 10_000_001, 40_000_001, 60_000_001, 200_000_001]) {
    assertIndependentMatch(base({ currentNormalRemunerationCents: chargeableCents + 900_000 }), `bracket-${chargeableCents}`);
  }
});

test("rounding matrix preserves 0/5 sen and rounds 1-4/6-9 upward", () => {
  const cases = new Map([[0, 0], [1, 5], [4, 5], [5, 5], [6, 10], [9, 10], [10, 10]]);
  for (const [input, expected] of cases) assert.equal(roundPcbUpToFiveSen(input), expected);
});

test("RM10 pre-zakat threshold and post-zakat sub-RM10 result reconcile", () => {
  const below = base({ currentNormalRemunerationCents: 950_000 });
  const belowResult = assertIndependentMatch(below, "below-minimum");
  assert.equal(belowResult.amountCents, 0);

  const withZakat = base({
    calculationMonth: 1,
    employeeCategory: "CATEGORY_3",
    children: { ...independentEmptyChildren, under18Full: 3 },
    currentNormalRemunerationCents: 550_000,
    currentNormalEpfCents: 60_500,
    currentZakatCents: 10_500,
  });
  const zakatResult = assertIndependentMatch(withZakat, "post-zakat-under-rm10");
  assert.equal(zakatResult.trace.normalRounding.roundedUpToFiveSenCents >= 1_000, true);
  assert.equal(zakatResult.amountCents < 1_000, true);
});

test("normal plus additional remuneration, EPF allocation and prior YTD reconcile", () => {
  assertIndependentMatch(base({
    calculationMonth: 4,
    employeeCategory: "CATEGORY_3",
    children: { ...independentEmptyChildren, under18Full: 3 },
    priorGrossRemunerationCents: 1_650_000,
    priorEpfCents: 181_500,
    priorPcbCents: 32_820,
    accumulatedAllowableDeductionsCents: 30_000,
    currentNormalRemunerationCents: 550_000,
    currentNormalEpfCents: 60_500,
    currentAdditionalRemunerationCents: 825_000,
    currentAdditionalEpfCents: 90_800,
    currentAllowableDeductionsCents: 30_000,
  }), "official-April-additional");
});

test("non-resident, REP, Knowledge Worker and C-Suite formula paths reconcile", () => {
  for (const taxRegime of ["NON_RESIDENT", "RETURNING_EXPERT_PROGRAM", "KNOWLEDGE_WORKER", "C_SUITE_NON_CITIZEN"] as const) {
    assertIndependentMatch(base({ taxRegime, currentNormalRemunerationCents: 2_000_000, currentNormalEpfCents: taxRegime === "NON_RESIDENT" ? 0 : 220_000 }), taxRegime);
  }
});

test("child and spouse arithmetic covers full, half, disabled and studying combinations", () => {
  assert.equal(calculatePcb2026ChildReliefCents({
    under18Full: 1,
    under18Half: 1,
    studying18PlusFull: 1,
    studying18PlusHalf: 1,
    diplomaOrDegreeFull: 1,
    diplomaOrDegreeHalf: 1,
    disabledFull: 1,
    disabledHalf: 1,
    disabledStudyingFull: 1,
    disabledStudyingHalf: 1,
  }), 5_400_000);
  assertIndependentMatch(base({ employeeCategory: "CATEGORY_2", spouseDisabled: true }), "spouse-and-disability");
});
