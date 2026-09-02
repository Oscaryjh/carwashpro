import {
  PCB_2026_TP1_LIMITS_CENTS,
  type Pcb2026Tp1Category,
} from "../../src/lib/payroll/pcb-declarations";
import type { EmployeePcbProfile } from "../../src/lib/payroll/pcb-profile";
import type { StatutoryParticipationPeriod } from "../../src/lib/payroll/statutory-participation";

type PcbProfileV4 = Extract<EmployeePcbProfile, { version: 4 }>;

type MonthlyAmount = Readonly<{
  month: string;
  amountCents: number;
}>;

export type Hasil2026TestingQuestionFixture = Readonly<{
  questionId: "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
  employeeLabel: string;
  source: Readonly<{
    document: "HASiL Testing Questions 2026";
    repositoryPath: string;
    pages: readonly number[];
    sha256: string;
    provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS";
  }>;
  profile: PcbProfileV4;
  statutoryParticipation: readonly StatutoryParticipationPeriod[];
  facts: Readonly<{
    employmentStatus: string;
    family: readonly string[];
    remuneration: readonly MonthlyAmount[];
    allowances: readonly MonthlyAmount[];
    epf: readonly MonthlyAmount[];
    reliefEvidence: readonly Readonly<{
      label: string;
      amountCents: number;
      month: string;
      canonicalCategory: Pcb2026Tp1Category | null;
    }>[];
    housingLoanInterestRelief?: Readonly<{
      annualAmountCents: number;
      monthlyAmountCents: number;
      allocation: readonly MonthlyAmount[];
      clarificationIssueId: string;
      clarificationReceivedOn: string;
    }>;
  }>;
}>;

const confirmedAt = "2026-08-27T12:00:00.000+08:00";
const officialDocument = "HASiL Testing Questions 2026" as const;
const officialPath = "statutory/official/artifacts/hasil-mtd-testing-questions-2026.pdf";
const officialSha256 = "d6523266b8b23daca956be0f61ec52879eab364736a9feb5668d7f039ae33517";
const officialSpecification = "HASiL PCB Computerised Calculation Specification 2026";

function source(page: number) {
  return {
    document: officialDocument,
    repositoryPath: officialPath,
    pages: [page],
    sha256: officialSha256,
    provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" as const,
  };
}

function taxPeriod(
  regime: PcbProfileV4["taxRegimeTimeline"][number]["regime"],
  effectiveFrom: string,
  effectiveTo: string | null,
  page: number,
  approval: Partial<PcbProfileV4["taxRegimeTimeline"][number]> = {},
) {
  const special = regime !== "RESIDENT_STANDARD" && regime !== "NON_RESIDENT";
  return {
    taxYear: 2026 as const,
    regime,
    effectiveFrom,
    effectiveTo,
    approvalStatus: special ? "CONFIRMED" as const : "NOT_REQUIRED" as const,
    officialSourceReference: officialSpecification,
    evidenceReference: special ? `${officialDocument}, page ${page}` : null,
    approvalReference: special ? `Retained HASiL Q${page - 2} approval facts` : null,
    approvedCompany: null,
    approvedActivity: null,
    approvedPosition: null,
    reviewedByUserId: null,
    confirmedAt,
    revision: 1,
    ...approval,
  };
}

function tp1Entry(
  categoryCode: Pcb2026Tp1Category,
  amountCents: number,
  page: number,
) {
  return {
    taxYear: 2026 as const,
    categoryCode,
    amountCents,
    categoryLimitCents: PCB_2026_TP1_LIMITS_CENTS[categoryCode],
    sourceForm: "HASIL_TP1_1_2026_BM" as const,
    sourceReference: `${officialDocument}, page ${page}`,
    declarationStatus: "CONFIRMED" as const,
    reviewStatus: "REVIEWED" as const,
    revision: 1,
  };
}

function baseProfile(values: Partial<PcbProfileV4> = {}): PcbProfileV4 {
  return {
    version: 4,
    profileRevision: 1,
    taxYear: 2026,
    taxRegime: "RESIDENT_STANDARD",
    taxRegimeTimeline: [taxPeriod("RESIDENT_STANDARD", "2026-01-01", "2026-12-31", 3)],
    nonCashRemunerationFacts: [],
    componentClassificationFacts: [],
    employeeCategory: "CATEGORY_1",
    individualDisabled: false,
    spouseDisabled: false,
    children: {
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
    },
    priorEmployerGrossRemunerationCents: 0,
    priorEmployerEpfCents: 0,
    priorEmployerPcbCents: 0,
    priorEmployerAllowableDeductionsCents: 0,
    priorEmployerZakatCents: 0,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "NOT_APPLICABLE",
      entries: [],
      sourceReference: null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    tp3Declaration: {
      formVersion: "HASIL_TP3_1_2026_BM",
      status: "NOT_APPLICABLE",
      grossRemunerationCents: 0,
      epfCents: 0,
      pcbCents: 0,
      zakatCents: 0,
      religiousTravelLevyCents: 0,
      religiousTravelLevySourceReference: null,
      exemptIncomeItems: [],
      previousEmploymentPeriods: [],
      entries: [],
      sourceReference: null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    religiousTravelLevyDeclaration: {
      status: "NOT_APPLICABLE",
      amountCents: 0,
      sourceReference: null,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    confirmedAt,
    ...values,
  };
}

function participation(
  suffix: string,
  status: "PARTICIPATING" | "NOT_PARTICIPATING",
  effectiveFromMonth: string,
  effectiveToMonth: string | null,
  revision: number,
  page: number,
): StatutoryParticipationPeriod {
  return {
    id: `hasil-2026-${suffix}`,
    businessId: "hasil-2026-fixture-business",
    membershipId: `hasil-2026-${suffix.split("-")[0]}-membership`,
    scheme: "EPF",
    revision,
    effectiveFromMonth: new Date(`${effectiveFromMonth}T00:00:00.000Z`),
    effectiveToMonth: effectiveToMonth
      ? new Date(`${effectiveToMonth}T00:00:00.000Z`)
      : null,
    status,
    sourceType: "OFFICIAL_RECORD",
    sourceReference: `${officialDocument}, page ${page}`,
    reason: `Official Q${page - 2} representability fixture`,
    sourceDigest: officialSha256,
    confirmedAt: new Date(confirmedAt),
  };
}

const q1Entries = [
  tp1Entry("C4", 130_000, 3),
  tp1Entry("C5", 78_000, 3),
  // The official question records RM1,350 spent. The governed TP1 input is
  // capped at the official RM1,000 C6 limit; the raw evidence remains below.
  tp1Entry("C6", 100_000, 3),
  tp1Entry("C8", 270_000, 3),
  tp1Entry("C14", 30_000, 3),
  tp1Entry("D1", 600_000, 3),
];

export const hasil2026Question1Fixture: Hasil2026TestingQuestionFixture = {
  questionId: "Q1",
  employeeLabel: "Employee A",
  source: source(3),
  profile: baseProfile({
    taxRegime: "C_SUITE_NON_CITIZEN",
    taxRegimeTimeline: [taxPeriod(
      "C_SUITE_NON_CITIZEN",
      "2026-06-01",
      "2026-12-31",
      3,
      { approvedCompany: "Approved company in Malaysia", approvedPosition: "C-Suite position" },
    )],
    employeeCategory: "CATEGORY_2",
    children: {
      under18Full: 1,
      under18Half: 0,
      studying18PlusFull: 0,
      studying18PlusHalf: 0,
      diplomaOrDegreeFull: 0,
      diplomaOrDegreeHalf: 0,
      disabledFull: 0,
      disabledHalf: 0,
      disabledStudyingFull: 1,
      disabledStudyingHalf: 0,
    },
    priorEmployerGrossRemunerationCents: 6_000_000,
    priorEmployerEpfCents: 660_000,
    priorEmployerPcbCents: 300_000,
    currentAllowableDeductionsCents: 608_000,
    currentZakatCents: 600_000,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "CONFIRMED",
      entries: q1Entries,
      sourceReference: `${officialDocument}, page 3`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
    tp3Declaration: {
      formVersion: "HASIL_TP3_1_2026_BM",
      status: "CONFIRMED",
      grossRemunerationCents: 6_000_000,
      epfCents: 660_000,
      pcbCents: 300_000,
      zakatCents: 0,
      religiousTravelLevyCents: 0,
      religiousTravelLevySourceReference: null,
      exemptIncomeItems: [{
        taxYear: 2026,
        category: "EXEMPT_ALLOWANCE",
        description: "Previous-employer travelling allowance",
        amountCents: 360_000,
        sourceReference: `${officialDocument}, page 3`,
        reviewStatus: "REVIEWED",
        revision: 1,
      }],
      previousEmploymentPeriods: [{
        taxYear: 2026,
        employmentStart: "2026-01-01",
        employmentEnd: "2026-06-30",
        employerReference: "Previous employer in Kuala Lumpur",
        sourceReference: `${officialDocument}, page 3`,
        reviewStatus: "REVIEWED",
        revision: 1,
      }],
      entries: [],
      sourceReference: `${officialDocument}, page 3`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
  }),
  statutoryParticipation: [participation("q1-epf", "PARTICIPATING", "2026-01-01", null, 1, 3)],
  facts: {
    employmentStatus: "C-Suite effective June; current employer July-December",
    family: ["Spouse not employed", "Child age 12", "Autistic child age 19 pursuing local diploma"],
    remuneration: [{ month: "2026-01/06", amountCents: 1_000_000 }, { month: "2026-07/12", amountCents: 2_000_000 }],
    allowances: [{ month: "2026-01/06", amountCents: 360_000 }, { month: "2026-07/12", amountCents: 50_000 }],
    epf: [{ month: "2026-01/12", amountCents: 11 }],
    reliefEvidence: [
      { label: "Childcare/transit", amountCents: 270_000, month: "Jul-Dec", canonicalCategory: "C8" },
      { label: "Dental", amountCents: 130_000, month: "Oct", canonicalCategory: "C4" },
      { label: "Books", amountCents: 78_000, month: "Oct", canonicalCategory: "C5" },
      { label: "Sports equipment (raw expense; TP1 C6 allows RM1,000)", amountCents: 135_000, month: "Dec", canonicalCategory: "C6" },
    ],
  },
};

const q2Entries = [
  tp1Entry("C4", 210_000, 4),
  tp1Entry("C5", 120_000, 4),
  tp1Entry("C11", 400_000, 4),
  tp1Entry("D1", 4_800_000, 4),
];

export const hasil2026Question2Fixture: Hasil2026TestingQuestionFixture = {
  questionId: "Q2",
  employeeLabel: "Employee B",
  source: source(4),
  profile: baseProfile({
    employeeCategory: "CATEGORY_3",
    children: {
      under18Full: 0,
      under18Half: 0,
      studying18PlusFull: 0,
      studying18PlusHalf: 0,
      diplomaOrDegreeFull: 2,
      diplomaOrDegreeHalf: 0,
      disabledFull: 0,
      disabledHalf: 0,
      disabledStudyingFull: 0,
      disabledStudyingHalf: 0,
    },
    componentClassificationFacts: [{
      componentCode: "DIRECTOR_FEE",
      sourceType: "AD_HOC_PAY",
      nature: "ADDITIONAL_TAXABLE",
      paymentNature: "DIRECTOR_FEE",
      recurrence: "QUARTERLY",
      originalEarningNature: null,
      originalEarningPeriodStart: null,
      originalEarningPeriodEnd: null,
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      officialSourceReference: officialSpecification,
      evidenceReference: `${officialDocument}, page 4`,
      reviewStatus: "REVIEWED",
      revision: 1,
    }],
    currentAllowableDeductionsCents: 730_000,
    currentZakatCents: 4_800_000,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "CONFIRMED",
      entries: q2Entries,
      sourceReference: `${officialDocument}, page 4`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
  }),
  statutoryParticipation: [participation("q2-epf", "PARTICIPATING", "2026-01-01", null, 1, 4)],
  facts: {
    employmentStatus: "Director; voluntary EPF election",
    family: ["Spouse employed", "Two local bachelor-degree twins claimed", "Younger children claimed by spouse"],
    remuneration: ["2026-03", "2026-06", "2026-09", "2026-12"].map((month) => ({ month, amountCents: 10_000_000 })),
    allowances: [],
    epf: ["2026-03", "2026-06", "2026-09", "2026-12"].map((month) => ({ month, amountCents: 100_000 })),
    reliefEvidence: [
      { label: "Vaccinations", amountCents: 125_000, month: "Mar/Sep", canonicalCategory: "C4" },
      { label: "Medical examination", amountCents: 85_000, month: "Mar", canonicalCategory: "C4" },
      { label: "Electronic business journals", amountCents: 120_000, month: "Mar", canonicalCategory: "C5" },
      { label: "Zakat", amountCents: 4_800_000, month: "Quarterly", canonicalCategory: "D1" },
    ],
  },
};

const q3Entries = [
  tp1Entry("C6", 60_000, 5),
  tp1Entry("C11", 220_000, 5),
  tp1Entry("C14", 11_200, 5),
  tp1Entry("C17", 22_000, 5),
];

export const hasil2026Question3Fixture: Hasil2026TestingQuestionFixture = {
  questionId: "Q3",
  employeeLabel: "Employee C",
  source: source(5),
  profile: baseProfile({
    taxRegime: "RETURNING_EXPERT_PROGRAM",
    taxRegimeTimeline: [taxPeriod("RETURNING_EXPERT_PROGRAM", "2026-09-01", "2026-12-31", 5)],
    employeeCategory: "CATEGORY_3",
    children: {
      under18Full: 1,
      under18Half: 0,
      studying18PlusFull: 0,
      studying18PlusHalf: 0,
      diplomaOrDegreeFull: 0,
      diplomaOrDegreeHalf: 0,
      disabledFull: 0,
      disabledHalf: 0,
      disabledStudyingFull: 0,
      disabledStudyingHalf: 0,
    },
    nonCashRemunerationFacts: [{
      id: "q3-household-servant-bik",
      taxYear: 2026,
      kind: "BIK",
      inputBasis: "ANNUAL_VALUE",
      valueCents: 200_000,
      effectiveFrom: "2026-09-01",
      effectiveTo: "2026-12-31",
      officialSourceReference: officialSpecification,
      evidenceReference: `${officialDocument}, page 5`,
      reviewStatus: "REVIEWED",
      revision: 1,
    }],
    currentAllowableDeductionsCents: 313_200,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "CONFIRMED",
      entries: q3Entries,
      sourceReference: `${officialDocument}, page 5`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
  }),
  statutoryParticipation: [participation("q3-epf", "PARTICIPATING", "2026-09-01", null, 1, 5)],
  facts: {
    employmentStatus: "Returning Expert Programme from September",
    family: ["Widow", "Legal adoptive child age 12"],
    remuneration: ["2026-09", "2026-10", "2026-11", "2026-12"].map((month) => ({ month, amountCents: 1_050_000 })),
    allowances: [{ month: "2026-09", amountCents: 200_000 }],
    epf: ["2026-09", "2026-10", "2026-11", "2026-12"].map((month) => ({ month, amountCents: 110_000 })),
    reliefEvidence: [
      { label: "Life insurance", amountCents: 220_000, month: "Sep-Dec", canonicalCategory: "C11" },
      { label: "Child taekwondo", amountCents: 60_000, month: "Sep-Dec", canonicalCategory: "C6" },
      { label: "Domestic-tourism admission fees", amountCents: 22_000, month: "Dec", canonicalCategory: "C17" },
    ],
  },
};

const q4Entries = [
  tp1Entry("C3", 250_000, 6),
  tp1Entry("C4", 50_000, 6),
  tp1Entry("C5", 250_000, 6),
  tp1Entry("C13", 110_000, 6),
];

export const hasil2026Question4Fixture: Hasil2026TestingQuestionFixture = {
  questionId: "Q4",
  employeeLabel: "Employee D",
  source: source(6),
  profile: baseProfile({
    taxRegime: "NON_RESIDENT",
    taxRegimeTimeline: [
      taxPeriod("NON_RESIDENT", "2026-08-01", "2026-10-31", 6),
      taxPeriod("RESIDENT_STANDARD", "2026-11-01", "2026-12-31", 6),
    ],
    employeeCategory: "CATEGORY_2",
    children: {
      under18Full: 2,
      under18Half: 0,
      studying18PlusFull: 0,
      studying18PlusHalf: 0,
      diplomaOrDegreeFull: 0,
      diplomaOrDegreeHalf: 0,
      disabledFull: 0,
      disabledHalf: 0,
      disabledStudyingFull: 0,
      disabledStudyingHalf: 0,
    },
    nonCashRemunerationFacts: [
      {
        id: "q4-vola-aug-oct",
        taxYear: 2026,
        kind: "VOLA",
        inputBasis: "MONTHLY_VALUE",
        valueCents: 100_000,
        effectiveFrom: "2026-08-01",
        effectiveTo: "2026-10-31",
        officialSourceReference: officialSpecification,
        evidenceReference: `${officialDocument}, page 6`,
        reviewStatus: "REVIEWED",
        revision: 1,
      },
      {
        id: "q4-vola-nov-dec",
        taxYear: 2026,
        kind: "VOLA",
        inputBasis: "MONTHLY_VALUE",
        valueCents: 150_000,
        effectiveFrom: "2026-11-01",
        effectiveTo: "2026-12-31",
        officialSourceReference: officialSpecification,
        evidenceReference: `${officialDocument}, page 6`,
        reviewStatus: "REVIEWED",
        revision: 2,
      },
    ],
    currentAllowableDeductionsCents: 660_000,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "CONFIRMED",
      entries: q4Entries,
      sourceReference: `${officialDocument}, page 6`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
  }),
  statutoryParticipation: [
    participation("q4-off", "NOT_PARTICIPATING", "2026-08-01", "2026-11-01", 1, 6),
    participation("q4-on", "PARTICIPATING", "2026-11-01", null, 2, 6),
  ],
  facts: {
    employmentStatus: "Australian expatriate; three-month contract renewed for 36 months from 1 November",
    family: ["Spouse not employed", "Two children under 18"],
    remuneration: [
      { month: "2026-08/10", amountCents: 1_000_000 },
      { month: "2026-11/12", amountCents: 1_500_000 },
    ],
    allowances: [
      { month: "2026-08/10", amountCents: 100_000 },
      { month: "2026-11/12", amountCents: 150_000 },
    ],
    epf: [{ month: "2026-08/10", amountCents: 0 }, { month: "2026-11/12", amountCents: 11 }],
    reliefEvidence: [
      { label: "Medical examination", amountCents: 50_000, month: "Nov", canonicalCategory: "C4" },
      { label: "Skill enhancement course", amountCents: 250_000, month: "Nov", canonicalCategory: "C3" },
      { label: "Medical insurance", amountCents: 110_000, month: "Nov/Dec", canonicalCategory: "C13" },
      { label: "Personal computer", amountCents: 320_000, month: "Dec", canonicalCategory: "C5" },
    ],
  },
};

export const HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS = 600_000;
export const HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS = 50_000;
export const hasil2026Question5HousingInterestAllocation = Object.freeze([
  { month: "2026-01", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-02", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-03", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-04", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-05", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-06", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-07", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-08", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-09", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-10", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-11", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
  { month: "2026-12", amountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS },
] as const);

const q5Entries = [
  tp1Entry("C1", 80_000, 7),
  tp1Entry("C5", 144_000, 7),
  tp1Entry("C6", 100_000, 7),
  tp1Entry("C15", 220_000, 7),
  tp1Entry("C16", HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS, 7),
];

export const hasil2026Question5Fixture: Hasil2026TestingQuestionFixture = {
  questionId: "Q5",
  employeeLabel: "Employee E",
  source: source(7),
  profile: baseProfile({
    taxRegime: "KNOWLEDGE_WORKER",
    taxRegimeTimeline: [taxPeriod(
      "KNOWLEDGE_WORKER",
      "2026-01-01",
      "2026-12-31",
      7,
      {
        approvedCompany: "Approved company in specified IRDA region",
        approvedActivity: "Knowledge-worker approved activity",
      },
    )],
    currentAllowableDeductionsCents: 1_144_000,
    tp1Declaration: {
      formVersion: "HASIL_TP1_1_2026_BM",
      status: "CONFIRMED",
      entries: q5Entries,
      sourceReference: `${officialDocument}, page 7`,
      declaredAt: confirmedAt,
      reviewedAt: confirmedAt,
    },
  }),
  statutoryParticipation: [participation("q5-epf", "PARTICIPATING", "2026-01-01", null, 1, 7)],
  facts: {
    employmentStatus: "Knowledge Worker in specified IRDA region effective 1 January",
    family: ["Single", "Supports elderly parents"],
    remuneration: [{ month: "2026-01/12", amountCents: 1_800_000 }],
    allowances: [],
    epf: [{ month: "2026-01/12", amountCents: 11 }],
    reliefEvidence: [
      { label: "Parents medical examinations", amountCents: 80_000, month: "Mar", canonicalCategory: "C1" },
      {
        label: "First-home loan interest",
        amountCents: HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS,
        month: "Jan-Dec, RM500/month per written HASiL clarification received 28 Aug 2026",
        canonicalCategory: "C16",
      },
      { label: "Food-waste grinder and residence CCTV", amountCents: 220_000, month: "Jan/Feb", canonicalCategory: "C15" },
      { label: "Business-premise CCTV (not personal relief)", amountCents: 70_000, month: "Feb", canonicalCategory: null },
      { label: "Gym membership", amountCents: 240_000, month: "Monthly", canonicalCategory: "C6" },
      { label: "Internet subscription", amountCents: 144_000, month: "Monthly", canonicalCategory: "C5" },
    ],
    housingLoanInterestRelief: {
      annualAmountCents: HASIL_2026_Q5_HOUSING_INTEREST_ANNUAL_CENTS,
      monthlyAmountCents: HASIL_2026_Q5_HOUSING_INTEREST_MONTHLY_CENTS,
      allocation: hasil2026Question5HousingInterestAllocation,
      clarificationIssueId: "PCB2026-Q5-HOUSING-LOAN-INTEREST-ALLOCATION",
      clarificationReceivedOn: "2026-08-28",
    },
  },
};

export const hasil2026TestingQuestionFixtures = Object.freeze([
  hasil2026Question1Fixture,
  hasil2026Question2Fixture,
  hasil2026Question3Fixture,
  hasil2026Question4Fixture,
  hasil2026Question5Fixture,
]);
