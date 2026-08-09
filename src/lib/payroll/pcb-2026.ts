export const PCB_2026_RULE_VERSION = "HASIL_MTD_SPEC_2026" as const;
export const PCB_2026_CALCULATOR_VERSION = "TETAMU_PCB_2026_1.1.0" as const;

export const PCB_2026_BLOCKERS = {
  INVALID_INPUT: "PCB_INPUT_INVALID",
  UNSUPPORTED_TAX_YEAR: "PCB_RULE_NOT_AVAILABLE",
  SPECIAL_REGIME_PROFILE_REQUIRED: "PCB_SPECIAL_REGIME_PROFILE_REQUIRED",
  NON_RESIDENT_CLASSIFICATION_REQUIRED: "PCB_NON_RESIDENT_CLASSIFICATION_REQUIRED",
  CLASSIFICATION_REQUIRED: "PCB_CLASSIFICATION_REQUIRED",
} as const;

export type Pcb2026TaxRegime =
  | "RESIDENT_STANDARD"
  | "NON_RESIDENT"
  | "RETURNING_EXPERT_PROGRAM"
  | "KNOWLEDGE_WORKER"
  | "C_SUITE_NON_CITIZEN";

export type Pcb2026EmployeeCategory = "CATEGORY_1" | "CATEGORY_2" | "CATEGORY_3";

export type Pcb2026ChildFacts = Readonly<{
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

export type PCB2026CalculationInput = Readonly<{
  taxYear: number;
  calculationMonth: number;
  taxRegime: Pcb2026TaxRegime;
  employeeCategory: Pcb2026EmployeeCategory;
  individualDisabled: boolean;
  spouseDisabled: boolean;
  children: Pcb2026ChildFacts;
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

export type Pcb2026BracketTrace = Readonly<{
  chargeableIncomeCents: number;
  mCents: number;
  ratePercent: number;
  bCents: number;
  annualTaxCents: number;
}>;

export type PCB2026CalculationTrace = Readonly<{
  ruleVersion: typeof PCB_2026_RULE_VERSION;
  calculatorVersion: typeof PCB_2026_CALCULATOR_VERSION;
  taxYear: number;
  calculationMonth: number;
  remainingMonths: number;
  remainingMonthsIncludingCurrent: number;
  taxRegime: Pcb2026TaxRegime;
  employeeCategory: Pcb2026EmployeeCategory;
  baseIndividualReliefCents: number;
  spouseReliefCents: number;
  individualDisabilityReliefCents: number;
  spouseDisabilityReliefCents: number;
  childReliefCents: number;
  accumulatedAllowableDeductionsCents: number;
  currentAllowableDeductionsCents: number;
  normalProjectedEpfCents: number;
  normalChargeableIncomeCents: number;
  normalBracket: Pcb2026BracketTrace;
  normalMtdBeforeCurrentRebatesCents: number;
  normalMtdAfterCurrentRebatesCents: number;
  additionalProjectedEpfCents: number | null;
  additionalChargeableIncomeCents: number | null;
  additionalBracket: Pcb2026BracketTrace | null;
  totalProjectedNormalMtdCents: number | null;
  additionalMtdCents: number;
  finalPcbCents: number;
  officialSections: readonly string[];
}>;

export type PCB2026CalculationResult =
  | Readonly<{
      status: "CALCULATED";
      amountCents: number;
      blockers: readonly [];
      trace: PCB2026CalculationTrace;
    }>
  | Readonly<{
      status: "BLOCKED";
      amountCents: null;
      blockers: readonly string[];
      trace: null;
    }>;

const EPF_ANNUAL_QUALIFYING_LIMIT_CENTS = 400_000;
const INDIVIDUAL_RELIEF_CENTS = 900_000;
const SPOUSE_RELIEF_CENTS = 400_000;
const INDIVIDUAL_DISABILITY_RELIEF_CENTS = 700_000;
const SPOUSE_DISABILITY_RELIEF_CENTS = 600_000;
const MINIMUM_MTD_CENTS = 1_000;
const SPECIAL_RATE_PERCENT = 15;
const NON_RESIDENT_RATE_PERCENT = 30;
const SPECIAL_RATE_REBATE_THRESHOLD_CENTS = 3_500_000;
const INDIVIDUAL_REBATE_CENTS = 40_000;
const SPOUSE_REBATE_CENTS = 40_000;

const BRACKETS = [
  { lowerExclusiveCents: 500_000, mCents: 500_000, ratePercent: 1, b13Cents: -40_000, b2Cents: -80_000 },
  { lowerExclusiveCents: 2_000_000, mCents: 2_000_000, ratePercent: 3, b13Cents: -25_000, b2Cents: -65_000 },
  { lowerExclusiveCents: 3_500_000, mCents: 3_500_000, ratePercent: 6, b13Cents: 60_000, b2Cents: 60_000 },
  { lowerExclusiveCents: 5_000_000, mCents: 5_000_000, ratePercent: 11, b13Cents: 150_000, b2Cents: 150_000 },
  { lowerExclusiveCents: 7_000_000, mCents: 7_000_000, ratePercent: 19, b13Cents: 370_000, b2Cents: 370_000 },
  { lowerExclusiveCents: 10_000_000, mCents: 10_000_000, ratePercent: 25, b13Cents: 940_000, b2Cents: 940_000 },
  { lowerExclusiveCents: 40_000_000, mCents: 40_000_000, ratePercent: 26, b13Cents: 8_440_000, b2Cents: 8_440_000 },
  { lowerExclusiveCents: 60_000_000, mCents: 60_000_000, ratePercent: 28, b13Cents: 13_640_000, b2Cents: 13_640_000 },
  { lowerExclusiveCents: 200_000_000, mCents: 200_000_000, ratePercent: 30, b13Cents: 52_840_000, b2Cents: 52_840_000 },
] as const;

const moneyFields: ReadonlyArray<keyof PCB2026CalculationInput> = [
  "priorGrossRemunerationCents",
  "priorEpfCents",
  "priorPcbCents",
  "accumulatedAllowableDeductionsCents",
  "accumulatedZakatCents",
  "currentNormalRemunerationCents",
  "currentNormalEpfCents",
  "currentAdditionalRemunerationCents",
  "currentAdditionalEpfCents",
  "currentAllowableDeductionsCents",
  "currentZakatCents",
  "currentReligiousTravelLevyCents",
];

const childFields: ReadonlyArray<keyof Pcb2026ChildFacts> = [
  "under18Full",
  "under18Half",
  "studying18PlusFull",
  "studying18PlusHalf",
  "diplomaOrDegreeFull",
  "diplomaOrDegreeHalf",
  "disabledFull",
  "disabledHalf",
  "disabledStudyingFull",
  "disabledStudyingHalf",
];

function validNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validateInput(input: PCB2026CalculationInput) {
  if (input.taxYear !== 2026 || !Number.isInteger(input.calculationMonth) || input.calculationMonth < 1 || input.calculationMonth > 12) {
    return false;
  }
  if (moneyFields.some((field) => !validNonNegativeInteger(input[field]))) return false;
  if (childFields.some((field) => !validNonNegativeInteger(input.children[field]))) return false;
  if (input.currentNormalEpfCents > input.currentNormalRemunerationCents) return false;
  if (input.currentAdditionalEpfCents > input.currentAdditionalRemunerationCents) return false;
  if (input.priorEpfCents > input.priorGrossRemunerationCents) return false;
  return true;
}

export function calculatePcb2026ChildReliefCents(children: Pcb2026ChildFacts) {
  return (
    children.under18Full * 200_000 +
    children.under18Half * 100_000 +
    children.studying18PlusFull * 200_000 +
    children.studying18PlusHalf * 100_000 +
    children.diplomaOrDegreeFull * 800_000 +
    children.diplomaOrDegreeHalf * 400_000 +
    children.disabledFull * 800_000 +
    children.disabledHalf * 400_000 +
    children.disabledStudyingFull * 1_600_000 +
    children.disabledStudyingHalf * 800_000
  );
}

export function roundPcbUpToFiveSen(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error(PCB_2026_BLOCKERS.INVALID_INPUT);
  return Math.ceil(amountCents / 5) * 5;
}

function annualTax(category: Pcb2026EmployeeCategory, chargeableIncomeCents: number): Pcb2026BracketTrace {
  const p = Math.max(0, chargeableIncomeCents);
  const bracket = [...BRACKETS].reverse().find((candidate) => p > candidate.lowerExclusiveCents);
  if (!bracket) return { chargeableIncomeCents: p, mCents: 0, ratePercent: 0, bCents: 0, annualTaxCents: 0 };
  const bCents = category === "CATEGORY_2" ? bracket.b2Cents : bracket.b13Cents;
  const annualTaxCents = Math.max(0, Math.floor(((p - bracket.mCents) * bracket.ratePercent) / 100) + bCents);
  return { chargeableIncomeCents: p, mCents: bracket.mCents, ratePercent: bracket.ratePercent, bCents, annualTaxCents };
}

function projectedEpfCents(input: PCB2026CalculationInput, additionalEpfCents: number, remainingMonths: number) {
  const prior = Math.min(input.priorEpfCents, EPF_ANNUAL_QUALIFYING_LIMIT_CENTS);
  const currentNormal = Math.min(input.currentNormalEpfCents, Math.max(0, EPF_ANNUAL_QUALIFYING_LIMIT_CENTS - prior));
  const currentAdditional = Math.min(
    additionalEpfCents,
    Math.max(0, EPF_ANNUAL_QUALIFYING_LIMIT_CENTS - prior - currentNormal),
  );
  if (remainingMonths === 0) return { prior, currentNormal, currentAdditional, projected: 0 };
  const balancePerMonth = Math.floor(
    Math.max(0, EPF_ANNUAL_QUALIFYING_LIMIT_CENTS - prior - currentNormal - currentAdditional) / remainingMonths,
  );
  return { prior, currentNormal, currentAdditional, projected: Math.min(currentNormal, balancePerMonth) };
}

function payablePart(amountCents: number) {
  const nonNegative = Math.max(0, amountCents);
  if (nonNegative < MINIMUM_MTD_CENTS) return 0;
  return roundPcbUpToFiveSen(nonNegative);
}

export function calculatePcb2026(input: PCB2026CalculationInput): PCB2026CalculationResult {
  if (!validateInput(input)) {
    return { status: "BLOCKED", amountCents: null, blockers: [input.taxYear === 2026 ? PCB_2026_BLOCKERS.INVALID_INPUT : PCB_2026_BLOCKERS.UNSUPPORTED_TAX_YEAR], trace: null };
  }
  const remainingMonths = 12 - input.calculationMonth;
  const monthsIncludingCurrent = remainingMonths + 1;
  const baseIndividualReliefCents = INDIVIDUAL_RELIEF_CENTS;
  const spouseReliefCents = input.employeeCategory === "CATEGORY_2" ? SPOUSE_RELIEF_CENTS : 0;
  const individualDisabilityReliefCents = input.individualDisabled ? INDIVIDUAL_DISABILITY_RELIEF_CENTS : 0;
  const spouseDisabilityReliefCents = input.spouseDisabled && input.employeeCategory === "CATEGORY_2" ? SPOUSE_DISABILITY_RELIEF_CENTS : 0;
  const childReliefCents = input.employeeCategory === "CATEGORY_1" ? 0 : calculatePcb2026ChildReliefCents(input.children);
  const totalReliefCents =
    baseIndividualReliefCents + spouseReliefCents + individualDisabilityReliefCents + spouseDisabilityReliefCents + childReliefCents +
    input.accumulatedAllowableDeductionsCents + input.currentAllowableDeductionsCents;

  if (input.taxRegime === "NON_RESIDENT") {
    const taxableRemunerationCents = input.currentNormalRemunerationCents + input.currentAdditionalRemunerationCents;
    const rawMtdCents = Math.floor((taxableRemunerationCents * NON_RESIDENT_RATE_PERCENT) / 100);
    const finalPcbCents = payablePart(rawMtdCents);
    const bracket: Pcb2026BracketTrace = {
      chargeableIncomeCents: taxableRemunerationCents,
      mCents: 0,
      ratePercent: NON_RESIDENT_RATE_PERCENT,
      bCents: 0,
      annualTaxCents: rawMtdCents,
    };
    return {
      status: "CALCULATED",
      amountCents: finalPcbCents,
      blockers: [],
      trace: {
        ruleVersion: PCB_2026_RULE_VERSION,
        calculatorVersion: PCB_2026_CALCULATOR_VERSION,
        taxYear: input.taxYear,
        calculationMonth: input.calculationMonth,
        remainingMonths,
        remainingMonthsIncludingCurrent: monthsIncludingCurrent,
        taxRegime: input.taxRegime,
        employeeCategory: input.employeeCategory,
        baseIndividualReliefCents: 0,
        spouseReliefCents: 0,
        individualDisabilityReliefCents: 0,
        spouseDisabilityReliefCents: 0,
        childReliefCents: 0,
        accumulatedAllowableDeductionsCents: 0,
        currentAllowableDeductionsCents: 0,
        normalProjectedEpfCents: 0,
        normalChargeableIncomeCents: taxableRemunerationCents,
        normalBracket: bracket,
        normalMtdBeforeCurrentRebatesCents: finalPcbCents,
        normalMtdAfterCurrentRebatesCents: finalPcbCents,
        additionalProjectedEpfCents: null,
        additionalChargeableIncomeCents: null,
        additionalBracket: null,
        totalProjectedNormalMtdCents: null,
        additionalMtdCents: 0,
        finalPcbCents,
        officialSections: ["Computerised Specification 2026: Non-Resident Employee"],
      },
    };
  }

  if (input.taxRegime !== "RESIDENT_STANDARD") {
    const specialEpf = projectedEpfCents(input, input.currentAdditionalEpfCents, remainingMonths);
    const chargeableIncomeCents =
      input.priorGrossRemunerationCents - specialEpf.prior +
      input.currentNormalRemunerationCents - specialEpf.currentNormal +
      (input.currentNormalRemunerationCents - specialEpf.projected) * remainingMonths +
      input.currentAdditionalRemunerationCents - specialEpf.currentAdditional - totalReliefCents;
    const specialBracket: Pcb2026BracketTrace = {
      chargeableIncomeCents: Math.max(0, chargeableIncomeCents),
      mCents: 0,
      ratePercent: SPECIAL_RATE_PERCENT,
      bCents: 0,
      annualTaxCents: Math.max(0, Math.floor((chargeableIncomeCents * SPECIAL_RATE_PERCENT) / 100)),
    };
    const qualifiesForRebate =
      input.taxRegime !== "C_SUITE_NON_CITIZEN" &&
      specialBracket.chargeableIncomeCents <= SPECIAL_RATE_REBATE_THRESHOLD_CENTS;
    const rebateCents = qualifiesForRebate
      ? INDIVIDUAL_REBATE_CENTS + (input.employeeCategory === "CATEGORY_2" ? SPOUSE_REBATE_CENTS : 0)
      : 0;
    const rawMtdCents = Math.max(
      0,
      Math.floor(
        (specialBracket.annualTaxCents - rebateCents - input.accumulatedZakatCents - input.priorPcbCents) /
          monthsIncludingCurrent,
      ),
    );
    const beforeCurrentRebatesCents = payablePart(rawMtdCents);
    const finalPcbCents = Math.max(
      0,
      beforeCurrentRebatesCents - input.currentZakatCents - input.currentReligiousTravelLevyCents,
    );
    const regimeSection =
      input.taxRegime === "RETURNING_EXPERT_PROGRAM"
        ? "Computerised Specification 2026: Approved Individual Under REP"
        : input.taxRegime === "KNOWLEDGE_WORKER"
          ? "Computerised Specification 2026: Knowledge Worker in the Specified Region"
          : "Computerised Specification 2026: Resident Non-Citizen Holding C Suite Position";
    return {
      status: "CALCULATED",
      amountCents: finalPcbCents,
      blockers: [],
      trace: {
        ruleVersion: PCB_2026_RULE_VERSION,
        calculatorVersion: PCB_2026_CALCULATOR_VERSION,
        taxYear: input.taxYear,
        calculationMonth: input.calculationMonth,
        remainingMonths,
        remainingMonthsIncludingCurrent: monthsIncludingCurrent,
        taxRegime: input.taxRegime,
        employeeCategory: input.employeeCategory,
        baseIndividualReliefCents,
        spouseReliefCents,
        individualDisabilityReliefCents,
        spouseDisabilityReliefCents,
        childReliefCents,
        accumulatedAllowableDeductionsCents: input.accumulatedAllowableDeductionsCents,
        currentAllowableDeductionsCents: input.currentAllowableDeductionsCents,
        normalProjectedEpfCents: specialEpf.projected,
        normalChargeableIncomeCents: specialBracket.chargeableIncomeCents,
        normalBracket: specialBracket,
        normalMtdBeforeCurrentRebatesCents: beforeCurrentRebatesCents,
        normalMtdAfterCurrentRebatesCents: finalPcbCents,
        additionalProjectedEpfCents: input.currentAdditionalRemunerationCents > 0 ? specialEpf.projected : null,
        additionalChargeableIncomeCents: input.currentAdditionalRemunerationCents > 0 ? specialBracket.chargeableIncomeCents : null,
        additionalBracket: input.currentAdditionalRemunerationCents > 0 ? specialBracket : null,
        totalProjectedNormalMtdCents: null,
        additionalMtdCents: 0,
        finalPcbCents,
        officialSections: [regimeSection, "Computerised Specification 2026: Terms and Conditions"],
      },
    };
  }

  const normalEpf = projectedEpfCents(input, 0, remainingMonths);
  const normalChargeableIncomeCents =
    input.priorGrossRemunerationCents - normalEpf.prior +
    input.currentNormalRemunerationCents - normalEpf.currentNormal +
    (input.currentNormalRemunerationCents - normalEpf.projected) * remainingMonths - totalReliefCents;
  const normalBracket = annualTax(input.employeeCategory, normalChargeableIncomeCents);
  const normalRawCents = Math.max(
    0,
    Math.floor((normalBracket.annualTaxCents - input.accumulatedZakatCents - input.priorPcbCents) / monthsIncludingCurrent),
  );
  const normalBeforeCurrentRebatesCents = payablePart(normalRawCents);
  const normalAfterCurrentRebatesCents = Math.max(
    0,
    normalBeforeCurrentRebatesCents - input.currentZakatCents - input.currentReligiousTravelLevyCents,
  );

  let additionalProjectedEpfCents: number | null = null;
  let additionalChargeableIncomeCents: number | null = null;
  let additionalBracket: Pcb2026BracketTrace | null = null;
  let totalProjectedNormalMtdCents: number | null = null;
  let additionalMtdCents = 0;

  if (input.currentAdditionalRemunerationCents > 0) {
    const additionalEpf = projectedEpfCents(input, input.currentAdditionalEpfCents, remainingMonths);
    additionalProjectedEpfCents = additionalEpf.projected;
    additionalChargeableIncomeCents =
      input.priorGrossRemunerationCents - additionalEpf.prior +
      input.currentNormalRemunerationCents - additionalEpf.currentNormal +
      (input.currentNormalRemunerationCents - additionalEpf.projected) * remainingMonths +
      input.currentAdditionalRemunerationCents - additionalEpf.currentAdditional - totalReliefCents;
    additionalBracket = annualTax(input.employeeCategory, additionalChargeableIncomeCents);
    totalProjectedNormalMtdCents = input.priorPcbCents + normalBeforeCurrentRebatesCents * monthsIncludingCurrent;
    const zakatPaidCents = input.accumulatedZakatCents + input.currentZakatCents;
    additionalMtdCents = payablePart(additionalBracket.annualTaxCents - totalProjectedNormalMtdCents + zakatPaidCents);
  }

  const finalPcbCents = normalAfterCurrentRebatesCents + additionalMtdCents;
  return {
    status: "CALCULATED",
    amountCents: finalPcbCents,
    blockers: [],
    trace: {
      ruleVersion: PCB_2026_RULE_VERSION,
      calculatorVersion: PCB_2026_CALCULATOR_VERSION,
      taxYear: input.taxYear,
      calculationMonth: input.calculationMonth,
      remainingMonths,
      remainingMonthsIncludingCurrent: monthsIncludingCurrent,
      taxRegime: input.taxRegime,
      employeeCategory: input.employeeCategory,
      baseIndividualReliefCents,
      spouseReliefCents,
      individualDisabilityReliefCents,
      spouseDisabilityReliefCents,
      childReliefCents,
      accumulatedAllowableDeductionsCents: input.accumulatedAllowableDeductionsCents,
      currentAllowableDeductionsCents: input.currentAllowableDeductionsCents,
      normalProjectedEpfCents: normalEpf.projected,
      normalChargeableIncomeCents,
      normalBracket,
      normalMtdBeforeCurrentRebatesCents: normalBeforeCurrentRebatesCents,
      normalMtdAfterCurrentRebatesCents: normalAfterCurrentRebatesCents,
      additionalProjectedEpfCents,
      additionalChargeableIncomeCents,
      additionalBracket,
      totalProjectedNormalMtdCents,
      additionalMtdCents,
      finalPcbCents,
      officialSections: [
        "Computerised Specification 2026: Normal Remuneration Formula",
        "Computerised Specification 2026: Additional Remuneration Steps 1-5",
        "Computerised Specification 2026: Table 1",
        "Computerised Specification 2026: Conditions for Computerised Calculation",
      ],
    },
  };
}

export type PcbComponentTreatment = "NORMAL_REMUNERATION" | "ADDITIONAL_REMUNERATION" | "EXCLUDED" | "UNKNOWN";

export function aggregatePcb2026Remuneration(
  lines: ReadonlyArray<Readonly<{ code: string; amountCents: number; treatment: PcbComponentTreatment }>>,
) {
  if (lines.some((line) => !validNonNegativeInteger(line.amountCents))) throw new Error(PCB_2026_BLOCKERS.INVALID_INPUT);
  const unknownComponentCodes = [...new Set(lines.filter((line) => line.treatment === "UNKNOWN").map((line) => line.code))].sort();
  return {
    normalRemunerationCents: lines.filter((line) => line.treatment === "NORMAL_REMUNERATION").reduce((sum, line) => sum + line.amountCents, 0),
    additionalRemunerationCents: lines.filter((line) => line.treatment === "ADDITIONAL_REMUNERATION").reduce((sum, line) => sum + line.amountCents, 0),
    excludedCents: lines.filter((line) => line.treatment === "EXCLUDED").reduce((sum, line) => sum + line.amountCents, 0),
    unknownComponentCodes,
    blockers: unknownComponentCodes.length > 0 ? [PCB_2026_BLOCKERS.CLASSIFICATION_REQUIRED] : [],
  } as const;
}
