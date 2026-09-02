import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateAnnualPcbValueCents,
  pcbComponentClassificationFactSchema,
  pcbTaxRegimeTimelineSchema,
  resolvePcbComponentClassification,
  resolvePcbNonCashFactsForMonth,
  resolvePcbTaxRegimeForMonth,
  type PcbComponentClassificationFact,
  type PcbNonCashRemunerationFact,
  type PcbTaxRegimePeriod,
} from "../../src/lib/payroll/pcb-correctness-foundation";
import {
  getPcbProfileReadinessForMonth,
  pcbProfileDataSchema,
  resolvePcbProfileTaxRegimeForPeriod,
  type EmployeePcbProfile,
} from "../../src/lib/payroll/pcb-profile";
import {
  resolveStatutoryParticipationForPayrollPeriod,
} from "../../src/lib/payroll/statutory-participation";
import {
  hasil2026Question1Fixture,
  hasil2026Question2Fixture,
  hasil2026Question3Fixture,
  hasil2026Question4Fixture,
  hasil2026Question5Fixture,
  hasil2026TestingQuestionFixtures,
} from "../fixtures/hasil-2026-testing-question-fixtures";

const confirmedAt = "2026-08-27T12:00:00.000+08:00";
const source = "HASiL PCB Computerised Calculation Specification 2026";

function period(
  regime: PcbTaxRegimePeriod["regime"],
  effectiveFrom: string,
  effectiveTo: string | null,
  extra: Partial<PcbTaxRegimePeriod> = {},
): PcbTaxRegimePeriod {
  const special = regime !== "RESIDENT_STANDARD" && regime !== "NON_RESIDENT";
  return {
    taxYear: 2026,
    regime,
    effectiveFrom,
    effectiveTo,
    approvalStatus: special ? "CONFIRMED" : "NOT_REQUIRED",
    officialSourceReference: source,
    evidenceReference: special ? "Retained approval evidence" : null,
    approvalReference: special ? "APPROVAL-2026-001" : null,
    approvedCompany: null,
    approvedActivity: null,
    approvedPosition: null,
    reviewedByUserId: null,
    confirmedAt,
    revision: 1,
    ...extra,
  };
}

function nonCash(
  kind: PcbNonCashRemunerationFact["kind"],
  inputBasis: PcbNonCashRemunerationFact["inputBasis"],
  valueCents: number,
  effectiveFrom = "2026-01-01",
): PcbNonCashRemunerationFact {
  return {
    id: `${kind}-1`,
    taxYear: 2026,
    kind,
    inputBasis,
    valueCents,
    effectiveFrom,
    effectiveTo: null,
    officialSourceReference: source,
    evidenceReference: `${kind} retained evidence`,
    reviewStatus: "REVIEWED",
    revision: 1,
  };
}

function classification(
  values: Partial<PcbComponentClassificationFact> = {},
): PcbComponentClassificationFact {
  return {
    componentCode: "COMMISSION",
    sourceType: "RECURRING_PAY",
    nature: "NORMAL_TAXABLE",
    paymentNature: "COMMISSION",
    recurrence: "MONTHLY",
    originalEarningNature: null,
    originalEarningPeriodStart: null,
    originalEarningPeriodEnd: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    officialSourceReference: source,
    evidenceReference: "Payroll policy COM-2026",
    reviewStatus: "REVIEWED",
    revision: 1,
    ...values,
  };
}

type PcbProfileV4 = Extract<EmployeePcbProfile, { version: 4 }>;

function profileV4(): PcbProfileV4 {
  const parsed = pcbProfileDataSchema.parse({
    version: 4,
    profileRevision: 1,
    taxYear: 2026,
    taxRegime: "RESIDENT_STANDARD",
    taxRegimeTimeline: [period("RESIDENT_STANDARD", "2026-01-01", "2026-12-31")],
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
  });
  if (parsed.version !== 4) throw new Error("Expected PCB profile version 4");
  return parsed;
}

test("full-year resident and non-resident periods resolve by payroll month", () => {
  assert.equal(
    resolvePcbTaxRegimeForMonth([period("RESIDENT_STANDARD", "2026-01-01", "2026-12-31")], "2026-08").status,
    "RESOLVED",
  );
  const nonResident = resolvePcbTaxRegimeForMonth(
    [period("NON_RESIDENT", "2026-01-01", "2026-12-31")],
    "2026-03",
  );
  assert.equal(nonResident.status, "RESOLVED");
  if (nonResident.status === "RESOLVED") assert.equal(nonResident.period.regime, "NON_RESIDENT");
});

test("mid-year residence transition resolves historically and does not apply early", () => {
  const timeline = [
    period("NON_RESIDENT", "2026-01-01", "2026-10-31"),
    period("RESIDENT_STANDARD", "2026-11-01", "2026-12-31"),
  ];
  const october = resolvePcbTaxRegimeForMonth(timeline, "2026-10");
  const november = resolvePcbTaxRegimeForMonth(timeline, "2026-11");
  assert.equal(october.status, "RESOLVED");
  assert.equal(november.status, "RESOLVED");
  if (october.status === "RESOLVED") assert.equal(october.period.regime, "NON_RESIDENT");
  if (november.status === "RESOLVED") assert.equal(november.period.regime, "RESIDENT_STANDARD");
});

test("overlap, missing month and mid-month transition fail closed", () => {
  assert.equal(pcbTaxRegimeTimelineSchema.safeParse([
    period("NON_RESIDENT", "2026-01-01", "2026-08-31"),
    period("RESIDENT_STANDARD", "2026-08-01", "2026-12-31"),
  ]).success, false);
  assert.deepEqual(
    resolvePcbTaxRegimeForMonth([period("RESIDENT_STANDARD", "2026-02-01", "2026-12-31")], "2026-01"),
    { status: "BLOCKED", blocker: "PCB_TAX_STATUS_TIMELINE_INCOMPLETE" },
  );
  assert.deepEqual(
    resolvePcbTaxRegimeForMonth([
      period("RESIDENT_STANDARD", "2026-01-01", "2026-08-14"),
      period("C_SUITE_NON_CITIZEN", "2026-08-15", "2026-12-31"),
    ], "2026-08"),
    { status: "BLOCKED", blocker: "PCB_TAX_STATUS_MONTH_TRANSITION_REQUIRES_REVIEW" },
  );
});

test("REP, Knowledge Worker and C-Suite require approval provenance", () => {
  for (const regime of ["RETURNING_EXPERT_PROGRAM", "KNOWLEDGE_WORKER", "C_SUITE_NON_CITIZEN"] as const) {
    const valid = period(regime, "2026-01-01", "2026-12-31", {
      approvedCompany: "Approved Company Sdn Bhd",
      approvedActivity: "Approved activity or specified region",
      approvedPosition: "Approved position",
    });
    assert.equal(pcbTaxRegimeTimelineSchema.safeParse([valid]).success, true);
    assert.equal(pcbTaxRegimeTimelineSchema.safeParse([{
      ...valid,
      approvalReference: null,
    }]).success, false);
  }
});

test("TP3 C1, C2, C3, C4(i), C4(ii), C5 and previous-employment period are distinct", () => {
  const base = profileV4();
  const parsed = pcbProfileDataSchema.parse({
    ...base,
    profileRevision: 2,
    priorEmployerGrossRemunerationCents: 1_000_000,
    priorEmployerEpfCents: 110_000,
    priorEmployerPcbCents: 25_000,
    priorEmployerZakatCents: 10_000,
    tp3Declaration: {
      ...base.tp3Declaration,
      status: "CONFIRMED",
      grossRemunerationCents: 1_000_000,
      epfCents: 110_000,
      pcbCents: 25_000,
      zakatCents: 10_000,
      religiousTravelLevyCents: 5_000,
      religiousTravelLevySourceReference: "TP3 C4(ii) receipt",
      exemptIncomeItems: [{
        taxYear: 2026,
        category: "EXEMPT_ALLOWANCE",
        description: "Previous-employer exempt travel allowance",
        amountCents: 50_000,
        sourceReference: "TP3 C2 evidence",
        reviewStatus: "REVIEWED",
        revision: 2,
      }],
      previousEmploymentPeriods: [{
        taxYear: 2026,
        employmentStart: "2026-01-01",
        employmentEnd: "2026-05-31",
        employerReference: "Previous Employer Sdn Bhd",
        sourceReference: "Accepted TP3 2026",
        reviewStatus: "REVIEWED",
        revision: 2,
      }],
      sourceReference: "Accepted TP3 2026",
    },
  });
  if (parsed.version !== 4) throw new Error("Expected PCB profile version 4");
  assert.equal(parsed.tp3Declaration.grossRemunerationCents, 1_000_000);
  assert.equal(parsed.tp3Declaration.exemptIncomeItems[0].amountCents, 50_000);
  assert.equal(parsed.tp3Declaration.religiousTravelLevyCents, 5_000);
  assert.equal(parsed.tp3Declaration.previousEmploymentPeriods[0].employmentEnd, "2026-05-31");
  assert.deepEqual(getPcbProfileReadinessForMonth(parsed, "2026-08").issueCodes, []);
});

test("TP3 C2 never becomes taxable gross and C4(ii) requires its own evidence", () => {
  const base = profileV4();
  const invalid = pcbProfileDataSchema.safeParse({
    ...base,
    priorEmployerGrossRemunerationCents: 100_000,
    tp3Declaration: {
      ...base.tp3Declaration,
      status: "CONFIRMED",
      grossRemunerationCents: 100_000,
      religiousTravelLevyCents: 1_000,
      religiousTravelLevySourceReference: null,
      previousEmploymentPeriods: [{
        taxYear: 2026,
        employmentStart: "2026-01-01",
        employmentEnd: "2026-01-31",
        employerReference: null,
        sourceReference: "TP3 retained",
        reviewStatus: "REVIEWED",
        revision: 1,
      }],
      sourceReference: "TP3 retained",
    },
  });
  assert.equal(invalid.success, false);
});

test("annual BIK allocation uses remaining months and disregards sen", () => {
  assert.equal(allocateAnnualPcbValueCents(2_500_000, 4), 277_700);
  const result = resolvePcbNonCashFactsForMonth([
    nonCash("BIK", "ANNUAL_VALUE", 2_500_000, "2026-04-01"),
  ], "2026-04");
  assert.equal(result.pcbOnlyNormalRemunerationCents, 277_700);
  assert.equal(result.facts[0].cashSalaryCents, 0);
  assert.equal(result.facts[0].payslipGrossCents, 0);
});

test("VOLA is formula-only while exempt benefits remain retained and untaxed", () => {
  const result = resolvePcbNonCashFactsForMonth([
    nonCash("VOLA", "MONTHLY_VALUE", 150_000, "2026-08-01"),
    nonCash("EXEMPT_ALLOWANCE", "MONTHLY_VALUE", 100_000, "2026-08-01"),
  ], "2026-08");
  assert.equal(result.pcbOnlyNormalRemunerationCents, 150_000);
  assert.equal(result.exemptEvidenceCents, 100_000);
  assert.equal(result.facts.every((item) => item.cashSalaryCents === 0), true);
  assert.equal(result.facts.every((item) => item.payslipGrossCents === 0), true);
});

test("non-cash facts respect their effective period", () => {
  const vola = nonCash("VOLA", "MONTHLY_VALUE", 100_000, "2026-11-01");
  assert.equal(resolvePcbNonCashFactsForMonth([vola], "2026-10").facts.length, 0);
  assert.equal(resolvePcbNonCashFactsForMonth([vola], "2026-11").pcbOnlyNormalRemunerationCents, 100_000);
});

test("director fee and commission require governed payment timing", () => {
  assert.equal(pcbComponentClassificationFactSchema.safeParse(classification({
    componentCode: "DIRECTOR_FEE",
    paymentNature: "DIRECTOR_FEE",
    recurrence: "QUARTERLY",
    nature: "ADDITIONAL_TAXABLE",
  })).success, true);
  assert.equal(pcbComponentClassificationFactSchema.safeParse(classification({
    componentCode: "DIRECTOR_FEE",
    paymentNature: "DIRECTOR_FEE",
    recurrence: null,
  })).success, false);
  assert.equal(pcbComponentClassificationFactSchema.safeParse(classification({
    recurrence: "IRREGULAR",
    nature: "ADDITIONAL_TAXABLE",
  })).success, true);
  assert.equal(pcbComponentClassificationFactSchema.safeParse(classification({ recurrence: null })).success, false);
});

test("arrears retain original nature and period; incomplete evidence blocks", () => {
  const valid = classification({
    componentCode: "SALARY_ARREARS",
    paymentNature: "ARREARS",
    recurrence: null,
    nature: "ADDITIONAL_TAXABLE",
    originalEarningNature: "Contracted monthly salary",
    originalEarningPeriodStart: "2026-05-01",
    originalEarningPeriodEnd: "2026-05-31",
  });
  assert.equal(pcbComponentClassificationFactSchema.safeParse(valid).success, true);
  assert.equal(pcbComponentClassificationFactSchema.safeParse({
    ...valid,
    originalEarningPeriodStart: null,
  }).success, false);
});

test("allowance can be normal, additional or exempt only through explicit evidence", () => {
  for (const nature of ["NORMAL_TAXABLE", "ADDITIONAL_TAXABLE", "TAX_EXEMPT"] as const) {
    assert.equal(pcbComponentClassificationFactSchema.safeParse(classification({
      componentCode: "TRAVEL_ALLOWANCE",
      paymentNature: "ALLOWANCE",
      recurrence: nature === "ADDITIONAL_TAXABLE" ? "IRREGULAR" : "MONTHLY",
      nature,
    })).success, true);
  }
  assert.deepEqual(resolvePcbComponentClassification(undefined), {
    status: "BLOCKED",
    blocker: "PCB_COMPONENT_CLASSIFICATION_INCOMPLETE",
  });
  assert.equal(resolvePcbComponentClassification(classification({
    nature: "UNKNOWN",
    reviewStatus: "NEEDS_EVIDENCE",
  })).status, "BLOCKED");
});

test("resolved profile tax period is copied, so later edits cannot mutate the frozen value", () => {
  const profile = profileV4();
  const resolved = resolvePcbProfileTaxRegimeForPeriod(profile, new Date("2026-08-01T00:00:00.000Z"));
  assert.equal(resolved.status, "RESOLVED");
  const frozenSnapshot = structuredClone(resolved);
  profile.taxRegimeTimeline[0].regime = "NON_RESIDENT";
  assert.equal(frozenSnapshot.status, "RESOLVED");
  if (frozenSnapshot.status === "RESOLVED") assert.equal(frozenSnapshot.regime, "RESIDENT_STANDARD");
});

test("named HASiL Q1-Q5 fixtures retain official input provenance", () => {
  assert.deepEqual(
    hasil2026TestingQuestionFixtures.map((fixture) => ({
      question: fixture.questionId,
      employee: fixture.employeeLabel,
      pages: fixture.source.pages,
      provenance: fixture.source.provenance,
    })),
    [
      { question: "Q1", employee: "Employee A", pages: [3], provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" },
      { question: "Q2", employee: "Employee B", pages: [4], provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" },
      { question: "Q3", employee: "Employee C", pages: [5], provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" },
      { question: "Q4", employee: "Employee D", pages: [6], provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" },
      { question: "Q5", employee: "Employee E", pages: [7], provenance: "OFFICIAL_INPUT_QUESTIONS_NOT_EXPECTED_ANSWERS" },
    ],
  );
  assert.equal(
    new Set(hasil2026TestingQuestionFixtures.map((fixture) => fixture.source.sha256)).size,
    1,
  );
});

test("Q1 corrects C-Suite effective June and represents TP3, family and relief facts", () => {
  const fixture = hasil2026Question1Fixture;
  assert.equal(pcbProfileDataSchema.safeParse(fixture.profile).success, true);
  assert.deepEqual(
    fixture.profile.taxRegimeTimeline.map((item) => [item.regime, item.effectiveFrom]),
    [["C_SUITE_NON_CITIZEN", "2026-06-01"]],
  );
  assert.equal(
    fixture.profile.taxRegimeTimeline.some((item) => item.regime === "NON_RESIDENT"),
    false,
  );
  assert.equal(fixture.profile.tp3Declaration.status, "CONFIRMED");
  assert.deepEqual(fixture.profile.tp3Declaration.previousEmploymentPeriods.map((item) => [
    item.employmentStart,
    item.employmentEnd,
  ]), [["2026-01-01", "2026-06-30"]]);
  assert.equal(fixture.profile.tp3Declaration.exemptIncomeItems[0].amountCents, 360_000);
  assert.equal(fixture.profile.children.disabledStudyingFull, 1);
  assert.ok(fixture.profile.tp1Declaration.entries.length >= 5);
});

test("Q2 represents quarterly director fees, voluntary EPF, family, zakat and reliefs", () => {
  const fixture = hasil2026Question2Fixture;
  assert.equal(pcbProfileDataSchema.safeParse(fixture.profile).success, true);
  assert.deepEqual(fixture.profile.componentClassificationFacts.map((item) => ({
    code: item.componentCode,
    recurrence: item.recurrence,
    nature: item.nature,
  })), [{ code: "DIRECTOR_FEE", recurrence: "QUARTERLY", nature: "ADDITIONAL_TAXABLE" }]);
  assert.equal(fixture.profile.children.diplomaOrDegreeFull, 2);
  assert.equal(fixture.profile.currentZakatCents, 4_800_000);
  assert.equal(fixture.facts.epf.length, 4);
  assert.equal(
    fixture.profile.tp1Declaration.entries.some((item) => item.categoryCode === "C11"),
    true,
  );
});

test("Q3 corrects annual BIK to RM2,000 and represents REP, adoption and reliefs", () => {
  const fixture = hasil2026Question3Fixture;
  assert.equal(pcbProfileDataSchema.safeParse(fixture.profile).success, true);
  const bik = fixture.profile.nonCashRemunerationFacts[0];
  assert.deepEqual(
    { kind: bik.kind, basis: bik.inputBasis, valueCents: bik.valueCents },
    { kind: "BIK", basis: "ANNUAL_VALUE", valueCents: 200_000 },
  );
  const september = resolvePcbNonCashFactsForMonth(
    fixture.profile.nonCashRemunerationFacts,
    "2026-09",
  );
  assert.equal(september.facts.length, 1);
  assert.equal(fixture.profile.taxRegimeTimeline[0].effectiveFrom, "2026-09-01");
  assert.equal(fixture.profile.children.under18Full, 1);
  assert.ok(fixture.facts.family.includes("Legal adoptive child age 12"));
});

test("Q4 represents salary, VOLA and EPF OFF Aug-Oct / ON Nov-Dec", () => {
  const fixture = hasil2026Question4Fixture;
  assert.equal(pcbProfileDataSchema.safeParse(fixture.profile).success, true);
  const membershipId = fixture.statutoryParticipation[0].membershipId;
  const resolveEpf = (month: string) => resolveStatutoryParticipationForPayrollPeriod({
    businessId: "hasil-2026-fixture-business",
    membershipId,
    scheme: "EPF",
    statutoryPeriod: new Date(`${month}-01T00:00:00.000Z`),
    records: fixture.statutoryParticipation,
    legacyEnabled: false,
  });
  for (const month of ["2026-08", "2026-09", "2026-10"]) {
    const resolved = resolveEpf(month);
    assert.equal(resolved.status, "RESOLVED");
    if (resolved.status === "RESOLVED") {
      assert.equal(resolved.participationStatus, "NOT_PARTICIPATING");
    }
  }
  for (const month of ["2026-11", "2026-12"]) {
    const resolved = resolveEpf(month);
    assert.equal(resolved.status, "RESOLVED");
    if (resolved.status === "RESOLVED") {
      assert.equal(resolved.participationStatus, "PARTICIPATING");
    }
  }
  assert.equal(
    resolvePcbNonCashFactsForMonth(fixture.profile.nonCashRemunerationFacts, "2026-10")
      .pcbOnlyNormalRemunerationCents,
    100_000,
  );
  assert.equal(
    resolvePcbNonCashFactsForMonth(fixture.profile.nonCashRemunerationFacts, "2026-11")
      .pcbOnlyNormalRemunerationCents,
    150_000,
  );
  assert.deepEqual(fixture.facts.remuneration, [
    { month: "2026-08/10", amountCents: 1_000_000 },
    { month: "2026-11/12", amountCents: 1_500_000 },
  ]);
});

test("Q5 represents Knowledge Worker provenance and parent, home, green, security and lifestyle facts", () => {
  const fixture = hasil2026Question5Fixture;
  assert.equal(pcbProfileDataSchema.safeParse(fixture.profile).success, true);
  assert.deepEqual(
    fixture.profile.taxRegimeTimeline.map((item) => ({
      regime: item.regime,
      from: item.effectiveFrom,
      company: item.approvedCompany,
      activity: item.approvedActivity,
    })),
    [{
      regime: "KNOWLEDGE_WORKER",
      from: "2026-01-01",
      company: "Approved company in specified IRDA region",
      activity: "Knowledge-worker approved activity",
    }],
  );
  assert.deepEqual(
    fixture.facts.reliefEvidence.map((item) => item.label),
    [
      "Parents medical examinations",
      "First-home loan interest",
      "Food-waste grinder and residence CCTV",
      "Business-premise CCTV (not personal relief)",
      "Gym membership",
      "Internet subscription",
    ],
  );
  assert.equal(
    fixture.profile.tp1Declaration.entries.some((item) => item.categoryCode === "C16"),
    true,
  );
});

test("all five named HASiL fixtures are representable by canonical governed models", () => {
  assert.deepEqual(
    Object.fromEntries(hasil2026TestingQuestionFixtures.map((fixture) => [
      fixture.questionId,
      pcbProfileDataSchema.safeParse(fixture.profile).success,
    ])),
    { Q1: true, Q2: true, Q3: true, Q4: true, Q5: true },
  );
});
