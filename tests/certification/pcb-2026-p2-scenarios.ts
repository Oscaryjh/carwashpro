import { createHash } from "node:crypto";
import type {
  IndependentCategory,
  IndependentChildren,
  IndependentPcbInput,
  IndependentTaxRegime,
} from "./pcb-2026-independent-verifier";

export type P2MonthFact = Readonly<{
  month: number;
  taxRegime: IndependentTaxRegime;
  normalCents: number;
  normalEpfCents: number;
  additionalCents: number;
  additionalEpfCents: number;
  deductionsCents: number;
  zakatCents: number;
  levyCents?: number;
  tags: readonly string[];
}>;

export type P2QuestionDefinition = Readonly<{
  question: "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
  employeeLabel: string;
  officialPage: number;
  officialSourceSha256: string;
  fixturePath: string;
  profileRevision: number;
  category: IndependentCategory;
  children: IndependentChildren;
  individualDisabled: boolean;
  spouseDisabled: boolean;
  opening: Readonly<{
    grossCents: number;
    epfCents: number;
    pcbCents: number;
    deductionsCents: number;
    zakatCents: number;
  }>;
  months: readonly P2MonthFact[];
  requiredMonths: readonly number[];
  openAmbiguity: string | null;
}>;

export type P2Ledger = {
  grossCents: number;
  epfCents: number;
  pcbCents: number;
  deductionsCents: number;
  zakatCents: number;
};

const officialQuestionsSha256 = "d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517";
const fixturePath = "tests/fixtures/hasil-2026-testing-question-fixtures.ts";

const noChildren: IndependentChildren = {
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

const q1Children = { ...noChildren, under18Full: 1, disabledStudyingFull: 1 };
const q2Children = { ...noChildren, diplomaOrDegreeFull: 2 };
const q3Children = { ...noChildren, under18Full: 1 };
const q4Children = { ...noChildren, under18Full: 2 };

export const pcb2026P2Questions: readonly P2QuestionDefinition[] = [
  {
    question: "Q1",
    employeeLabel: "Employee A",
    officialPage: 3,
    officialSourceSha256: officialQuestionsSha256,
    fixturePath,
    profileRevision: 1,
    category: "CATEGORY_2",
    children: q1Children,
    individualDisabled: false,
    spouseDisabled: false,
    opening: { grossCents: 6_000_000, epfCents: 660_000, pcbCents: 300_000, deductionsCents: 0, zakatCents: 0 },
    months: [
      { month: 7, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_000_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 50_000, zakatCents: 100_000, tags: ["RM500 travel allowance within remaining RM2,400 annual exemption"] },
      { month: 8, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_000_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 50_000, zakatCents: 100_000, tags: ["travel exempt"] },
      { month: 9, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_000_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 50_000, zakatCents: 100_000, tags: ["travel exempt"] },
      { month: 10, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_000_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 258_000, zakatCents: 100_000, tags: ["dental", "transit", "books", "SOCSO", "travel exempt"] },
      { month: 11, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_010_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 50_000, zakatCents: 100_000, tags: ["RM100 travel exceeds annual RM6,000 exemption"] },
      { month: 12, taxRegime: "C_SUITE_NON_CITIZEN", normalCents: 2_050_000, normalEpfCents: 220_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 150_000, zakatCents: 100_000, tags: ["RM500 travel fully taxable", "RM1,350 sports expense capped to RM1,000 TP1 C6", "transit", "SOCSO"] },
    ],
    requiredMonths: [7, 10, 12],
    openAmbiguity: null,
  },
  {
    question: "Q2",
    employeeLabel: "Employee B",
    officialPage: 4,
    officialSourceSha256: officialQuestionsSha256,
    fixturePath,
    profileRevision: 1,
    category: "CATEGORY_3",
    children: q2Children,
    individualDisabled: false,
    spouseDisabled: false,
    opening: { grossCents: 0, epfCents: 0, pcbCents: 0, deductionsCents: 0, zakatCents: 0 },
    months: [
      { month: 3, taxRegime: "RESIDENT_STANDARD", normalCents: 0, normalEpfCents: 0, additionalCents: 10_000_000, additionalEpfCents: 0, deductionsCents: 350_000, zakatCents: 1_200_000, tags: ["quarterly non-monthly director fee", "voluntary EPF is TP1 deduction"] },
      { month: 6, taxRegime: "RESIDENT_STANDARD", normalCents: 0, normalEpfCents: 0, additionalCents: 10_000_000, additionalEpfCents: 0, deductionsCents: 145_000, zakatCents: 1_200_000, tags: ["quarterly director fee"] },
      { month: 9, taxRegime: "RESIDENT_STANDARD", normalCents: 0, normalEpfCents: 0, additionalCents: 10_000_000, additionalEpfCents: 0, deductionsCents: 135_000, zakatCents: 1_200_000, tags: ["quarterly director fee"] },
      { month: 12, taxRegime: "RESIDENT_STANDARD", normalCents: 0, normalEpfCents: 0, additionalCents: 10_000_000, additionalEpfCents: 0, deductionsCents: 100_000, zakatCents: 1_200_000, tags: ["quarterly director fee"] },
    ],
    requiredMonths: [3, 9],
    openAmbiguity: null,
  },
  {
    question: "Q3",
    employeeLabel: "Employee C",
    officialPage: 5,
    officialSourceSha256: officialQuestionsSha256,
    fixturePath,
    profileRevision: 1,
    category: "CATEGORY_3",
    children: q3Children,
    individualDisabled: false,
    spouseDisabled: false,
    opening: { grossCents: 0, epfCents: 0, pcbCents: 0, deductionsCents: 0, zakatCents: 0 },
    months: [
      { month: 9, taxRegime: "RETURNING_EXPERT_PROGRAM", normalCents: 1_100_000, normalEpfCents: 110_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 72_800, zakatCents: 0, tags: ["RM500 BIK allocation", "life insurance", "taekwondo", "SOCSO"] },
      { month: 10, taxRegime: "RETURNING_EXPERT_PROGRAM", normalCents: 1_100_000, normalEpfCents: 110_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 72_800, zakatCents: 0, tags: ["RM500 BIK allocation"] },
      { month: 11, taxRegime: "RETURNING_EXPERT_PROGRAM", normalCents: 1_100_000, normalEpfCents: 110_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 72_800, zakatCents: 0, tags: ["RM500 BIK allocation"] },
      { month: 12, taxRegime: "RETURNING_EXPERT_PROGRAM", normalCents: 1_100_000, normalEpfCents: 110_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 94_800, zakatCents: 0, tags: ["RM500 BIK allocation", "RM220 admission fees allowed", "RM300 hotel excluded"] },
    ],
    requiredMonths: [9, 11],
    openAmbiguity: null,
  },
  {
    question: "Q4",
    employeeLabel: "Employee D",
    officialPage: 6,
    officialSourceSha256: officialQuestionsSha256,
    fixturePath,
    profileRevision: 1,
    category: "CATEGORY_2",
    children: q4Children,
    individualDisabled: false,
    spouseDisabled: false,
    opening: { grossCents: 0, epfCents: 0, pcbCents: 0, deductionsCents: 0, zakatCents: 0 },
    months: [
      { month: 8, taxRegime: "NON_RESIDENT", normalCents: 1_100_000, normalEpfCents: 0, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 0, zakatCents: 0, tags: ["RM1,000 VOLA", "EPF off"] },
      { month: 9, taxRegime: "NON_RESIDENT", normalCents: 1_100_000, normalEpfCents: 0, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 0, zakatCents: 0, tags: ["RM1,000 VOLA", "EPF off"] },
      { month: 10, taxRegime: "NON_RESIDENT", normalCents: 1_100_000, normalEpfCents: 0, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 0, zakatCents: 0, tags: ["RM1,000 VOLA", "EPF off"] },
      { month: 11, taxRegime: "RESIDENT_STANDARD", normalCents: 1_650_000, normalEpfCents: 165_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 355_000, zakatCents: 0, tags: ["RM1,500 VOLA", "EPF on", "medical", "study", "medical insurance"] },
      { month: 12, taxRegime: "RESIDENT_STANDARD", normalCents: 1_650_000, normalEpfCents: 165_000, additionalCents: 0, additionalEpfCents: 0, deductionsCents: 305_000, zakatCents: 0, tags: ["RM1,500 VOLA", "EPF on", "lifestyle capped at RM2,500", "medical insurance"] },
    ],
    requiredMonths: [8, 10, 11, 12],
    openAmbiguity: null,
  },
  {
    question: "Q5",
    employeeLabel: "Employee E",
    officialPage: 7,
    officialSourceSha256: officialQuestionsSha256,
    fixturePath,
    profileRevision: 1,
    category: "CATEGORY_1",
    children: noChildren,
    individualDisabled: false,
    spouseDisabled: false,
    opening: { grossCents: 0, epfCents: 0, pcbCents: 0, deductionsCents: 0, zakatCents: 0 },
    months: [],
    requiredMonths: [1, 2],
    openAmbiguity: "The official question states RM6,000 annual housing-loan interest but does not state the month(s) in which TP1 relief is claimed; January/February MTD therefore cannot be frozen without HASiL clarification.",
  },
] as const;

export function openLedger(question: P2QuestionDefinition): P2Ledger {
  return { ...question.opening };
}

export function monthInput(
  question: P2QuestionDefinition,
  month: P2MonthFact,
  ledger: P2Ledger,
): IndependentPcbInput {
  return {
    taxYear: 2026,
    calculationMonth: month.month,
    taxRegime: month.taxRegime,
    employeeCategory: question.category,
    individualDisabled: question.individualDisabled,
    spouseDisabled: question.spouseDisabled,
    children: question.children,
    priorGrossRemunerationCents: ledger.grossCents,
    priorEpfCents: ledger.epfCents,
    priorPcbCents: ledger.pcbCents,
    accumulatedAllowableDeductionsCents: ledger.deductionsCents,
    accumulatedZakatCents: ledger.zakatCents,
    currentNormalRemunerationCents: month.normalCents,
    currentNormalEpfCents: month.normalEpfCents,
    currentAdditionalRemunerationCents: month.additionalCents,
    currentAdditionalEpfCents: month.additionalEpfCents,
    currentAllowableDeductionsCents: month.deductionsCents,
    currentZakatCents: month.zakatCents,
    currentReligiousTravelLevyCents: month.levyCents ?? 0,
  };
}

export function advanceLedger(
  ledger: P2Ledger,
  month: P2MonthFact,
  paidPcbCents: number,
) {
  ledger.grossCents += month.normalCents + month.additionalCents;
  ledger.epfCents += month.normalEpfCents + month.additionalEpfCents;
  ledger.pcbCents += paidPcbCents;
  ledger.deductionsCents += month.deductionsCents;
  ledger.zakatCents += month.zakatCents;
}

export function certificationInputDigest(input: IndependentPcbInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
