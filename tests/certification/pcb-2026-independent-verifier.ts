/**
 * Certification-only verifier derived from the retained HASiL 2026 specification.
 *
 * Deliberately isolated from src/lib/payroll/pcb-2026.ts: it imports no production
 * calculator, constants, bracket table, rounding helper, or profile helper.
 */

export const PCB_2026_INDEPENDENT_VERIFIER_VERSION = "HASIL_2026_P2_INDEPENDENT_1.0.0" as const;

export type IndependentTaxRegime =
  | "RESIDENT_STANDARD"
  | "NON_RESIDENT"
  | "RETURNING_EXPERT_PROGRAM"
  | "KNOWLEDGE_WORKER"
  | "C_SUITE_NON_CITIZEN";

export type IndependentCategory = "CATEGORY_1" | "CATEGORY_2" | "CATEGORY_3";

export type IndependentChildren = Readonly<{
  under18Full: number;
  under18Half: number;
  studying18PlusFull: number;
  studying18PlusHalf: number;
  diplomaOrDegreeFull: number;
  diplomaOrDegreeHalf: number;
  disabledFull: number;
  disabledHalf: number;
  disabledStudyingFull: number;
  disabledStudyingHalf: number;
}>;

export type IndependentPcbInput = Readonly<{
  taxYear: number;
  calculationMonth: number;
  taxRegime: IndependentTaxRegime;
  employeeCategory: IndependentCategory;
  individualDisabled: boolean;
  spouseDisabled: boolean;
  children: IndependentChildren;
  priorGrossRemunerationCents: number;
  priorEpfCents: number;
  priorPcbCents: number;
  accumulatedAllowableDeductionsCents: number;
  accumulatedZakatCents: number;
  currentNormalRemunerationCents: number;
  currentNormalEpfCents: number;
  currentAdditionalRemunerationCents: number;
  currentAdditionalEpfCents: number;
  currentAllowableDeductionsCents: number;
  currentZakatCents: number;
  currentReligiousTravelLevyCents: number;
}>;

type SenRounding = Readonly<{
  rawNumeratorCents: number;
  divisor: number;
  truncatedToSenCents: number;
  belowRm10Suppressed: boolean;
  roundedUpToFiveSenCents: number;
  postCurrentZakatAndLevyCents: number;
}>;

export type IndependentPcbTrace = Readonly<{
  projectedEpfWithoutAdditionalCents: number;
  projectedEpfWithAdditionalCents: number | null;
  totalReliefCents: number;
  normalChargeableIncomeCents: number;
  normalAnnualTaxCents: number;
  normalRatePercent: number;
  normalBCents: number;
  normalRounding: SenRounding;
  additionalChargeableIncomeCents: number | null;
  additionalAnnualTaxCents: number | null;
  projectedNormalMtdCents: number | null;
  additionalRounding: SenRounding | null;
  finalPcbCents: number;
}>;

export type IndependentPcbResult = Readonly<{
  amountCents: number;
  trace: IndependentPcbTrace;
}>;

const emptyChildren: IndependentChildren = {
  under18Full: 0,
  under18Half: 0,
  studying18PlusFull: 0,
  studying18PlusHalf: 0,
  diplomaOrDegreeFull: 0,
  diplomaOrDegreeHalf: 0,
  disabledFull: 0,
  disabledHalf: 0,
  disabledStudyingFull: 0,
  disabledStudyingHalf: 0,
};

export { emptyChildren as independentEmptyChildren };

function truncateToSen(numeratorCents: number, divisor: number) {
  return Math.floor(numeratorCents / divisor);
}

function certifyRounding(
  rawNumeratorCents: number,
  divisor: number,
  currentZakatCents = 0,
  currentLevyCents = 0,
): SenRounding {
  const truncatedToSenCents = Math.max(0, truncateToSen(rawNumeratorCents, divisor));
  const belowRm10Suppressed = truncatedToSenCents < 1_000;
  const roundedUpToFiveSenCents = belowRm10Suppressed
    ? 0
    : Math.ceil(truncatedToSenCents / 5) * 5;
  return {
    rawNumeratorCents,
    divisor,
    truncatedToSenCents,
    belowRm10Suppressed,
    roundedUpToFiveSenCents,
    postCurrentZakatAndLevyCents: Math.max(
      0,
      roundedUpToFiveSenCents - currentZakatCents - currentLevyCents,
    ),
  };
}

function childRelief(children: IndependentChildren) {
  return (
    children.under18Full * 200_000 + children.under18Half * 100_000 +
    children.studying18PlusFull * 200_000 + children.studying18PlusHalf * 100_000 +
    children.diplomaOrDegreeFull * 800_000 + children.diplomaOrDegreeHalf * 400_000 +
    children.disabledFull * 800_000 + children.disabledHalf * 400_000 +
    children.disabledStudyingFull * 1_600_000 + children.disabledStudyingHalf * 800_000
  );
}

function reliefTotal(input: IndependentPcbInput) {
  return 900_000 +
    (input.employeeCategory === "CATEGORY_2" ? 400_000 : 0) +
    (input.individualDisabled ? 700_000 : 0) +
    (input.employeeCategory === "CATEGORY_2" && input.spouseDisabled ? 600_000 : 0) +
    (input.employeeCategory === "CATEGORY_1" ? 0 : childRelief(input.children)) +
    input.accumulatedAllowableDeductionsCents + input.currentAllowableDeductionsCents;
}

const hasilBands = [
  [500_000, 500_000, 1, -40_000, -80_000],
  [2_000_000, 2_000_000, 3, -25_000, -65_000],
  [3_500_000, 3_500_000, 6, 60_000, 60_000],
  [5_000_000, 5_000_000, 11, 150_000, 150_000],
  [7_000_000, 7_000_000, 19, 370_000, 370_000],
  [10_000_000, 10_000_000, 25, 940_000, 940_000],
  [40_000_000, 40_000_000, 26, 8_440_000, 8_440_000],
  [60_000_000, 60_000_000, 28, 13_640_000, 13_640_000],
  [200_000_000, 200_000_000, 30, 52_840_000, 52_840_000],
] as const;

function residentAnnualTax(category: IndependentCategory, chargeableCents: number) {
  const p = Math.max(0, chargeableCents);
  const band = [...hasilBands].reverse().find(([lower]) => p > lower);
  if (!band) return { annualTaxCents: 0, ratePercent: 0, bCents: 0 };
  const [, m, rate, b13, b2] = band;
  const b = category === "CATEGORY_2" ? b2 : b13;
  return {
    annualTaxCents: Math.max(0, truncateToSen((p - m) * rate, 100) + b),
    ratePercent: rate,
    bCents: b,
  };
}

function epfProjection(input: IndependentPcbInput, additionalEpfCents: number, monthsAfterCurrent: number) {
  const cap = 400_000;
  const prior = Math.min(input.priorEpfCents, cap);
  const normal = Math.min(input.currentNormalEpfCents, Math.max(0, cap - prior));
  const additional = Math.min(additionalEpfCents, Math.max(0, cap - prior - normal));
  const projected = monthsAfterCurrent === 0
    ? 0
    : Math.min(normal, truncateToSen(Math.max(0, cap - prior - normal - additional), monthsAfterCurrent));
  return { prior, normal, additional, projected };
}

function projectedChargeable(
  input: IndependentPcbInput,
  epf: ReturnType<typeof epfProjection>,
  monthsAfterCurrent: number,
  includeAdditional: boolean,
) {
  return Math.max(
    0,
    input.priorGrossRemunerationCents - epf.prior +
      input.currentNormalRemunerationCents - epf.normal +
      (input.currentNormalRemunerationCents - epf.projected) * monthsAfterCurrent +
      (includeAdditional ? input.currentAdditionalRemunerationCents - epf.additional : 0) -
      reliefTotal(input),
  );
}

export function independentlyVerifyPcb2026(input: IndependentPcbInput): IndependentPcbResult {
  const monthsAfterCurrent = 12 - input.calculationMonth;
  const monthsIncludingCurrent = monthsAfterCurrent + 1;

  if (input.taxRegime === "NON_RESIDENT") {
    const taxable = input.currentNormalRemunerationCents + input.currentAdditionalRemunerationCents;
    const normalRounding = certifyRounding(taxable * 30, 100);
    return {
      amountCents: normalRounding.postCurrentZakatAndLevyCents,
      trace: {
        projectedEpfWithoutAdditionalCents: 0,
        projectedEpfWithAdditionalCents: null,
        totalReliefCents: 0,
        normalChargeableIncomeCents: taxable,
        normalAnnualTaxCents: normalRounding.truncatedToSenCents,
        normalRatePercent: 30,
        normalBCents: 0,
        normalRounding,
        additionalChargeableIncomeCents: null,
        additionalAnnualTaxCents: null,
        projectedNormalMtdCents: null,
        additionalRounding: null,
        finalPcbCents: normalRounding.postCurrentZakatAndLevyCents,
      },
    };
  }

  if (input.taxRegime !== "RESIDENT_STANDARD") {
    const epf = epfProjection(input, input.currentAdditionalEpfCents, monthsAfterCurrent);
    const chargeable = projectedChargeable(input, epf, monthsAfterCurrent, true);
    const annualTax = truncateToSen(chargeable * 15, 100);
    const rebate = input.taxRegime !== "C_SUITE_NON_CITIZEN" && chargeable <= 3_500_000
      ? 40_000 + (input.employeeCategory === "CATEGORY_2" ? 40_000 : 0)
      : 0;
    const normalRounding = certifyRounding(
      annualTax - rebate - input.accumulatedZakatCents - input.priorPcbCents,
      monthsIncludingCurrent,
      input.currentZakatCents,
      input.currentReligiousTravelLevyCents,
    );
    return {
      amountCents: normalRounding.postCurrentZakatAndLevyCents,
      trace: {
        projectedEpfWithoutAdditionalCents: epf.projected,
        projectedEpfWithAdditionalCents: input.currentAdditionalRemunerationCents > 0 ? epf.projected : null,
        totalReliefCents: reliefTotal(input),
        normalChargeableIncomeCents: chargeable,
        normalAnnualTaxCents: annualTax,
        normalRatePercent: 15,
        // The 15% special-regime path has no Table-1 B amount. The low-income
        // rebate is applied after annual tax and is reflected by the rounding
        // numerator, not represented as a negative B value.
        normalBCents: 0,
        normalRounding,
        additionalChargeableIncomeCents: input.currentAdditionalRemunerationCents > 0 ? chargeable : null,
        additionalAnnualTaxCents: input.currentAdditionalRemunerationCents > 0 ? annualTax : null,
        projectedNormalMtdCents: null,
        additionalRounding: null,
        finalPcbCents: normalRounding.postCurrentZakatAndLevyCents,
      },
    };
  }

  const normalEpf = epfProjection(input, 0, monthsAfterCurrent);
  const normalChargeable = projectedChargeable(input, normalEpf, monthsAfterCurrent, false);
  const normalTax = residentAnnualTax(input.employeeCategory, normalChargeable);
  const normalRounding = certifyRounding(
    normalTax.annualTaxCents - input.accumulatedZakatCents - input.priorPcbCents,
    monthsIncludingCurrent,
    input.currentZakatCents,
    input.currentReligiousTravelLevyCents,
  );

  let additionalChargeableIncomeCents: number | null = null;
  let additionalAnnualTaxCents: number | null = null;
  let projectedNormalMtdCents: number | null = null;
  let additionalRounding: SenRounding | null = null;
  let additionalMtdCents = 0;
  let projectedEpfWithAdditionalCents: number | null = null;

  if (input.currentAdditionalRemunerationCents > 0) {
    const epf = epfProjection(input, input.currentAdditionalEpfCents, monthsAfterCurrent);
    projectedEpfWithAdditionalCents = epf.projected;
    additionalChargeableIncomeCents = projectedChargeable(input, epf, monthsAfterCurrent, true);
    additionalAnnualTaxCents = residentAnnualTax(input.employeeCategory, additionalChargeableIncomeCents).annualTaxCents;
    projectedNormalMtdCents = input.priorPcbCents + normalRounding.roundedUpToFiveSenCents * monthsIncludingCurrent;
    additionalRounding = certifyRounding(
      additionalAnnualTaxCents - projectedNormalMtdCents + input.accumulatedZakatCents + input.currentZakatCents,
      1,
    );
    additionalMtdCents = additionalRounding.roundedUpToFiveSenCents;
  }

  const finalPcbCents = normalRounding.postCurrentZakatAndLevyCents + additionalMtdCents;
  return {
    amountCents: finalPcbCents,
    trace: {
      projectedEpfWithoutAdditionalCents: normalEpf.projected,
      projectedEpfWithAdditionalCents,
      totalReliefCents: reliefTotal(input),
      normalChargeableIncomeCents: normalChargeable,
      normalAnnualTaxCents: normalTax.annualTaxCents,
      normalRatePercent: normalTax.ratePercent,
      normalBCents: normalTax.bCents,
      normalRounding,
      additionalChargeableIncomeCents,
      additionalAnnualTaxCents,
      projectedNormalMtdCents,
      additionalRounding,
      finalPcbCents,
    },
  };
}
