import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  calculatePcb2026,
  PCB_2026_CALCULATOR_VERSION,
} from "../../src/lib/payroll/pcb-2026";
import { assertNoDirectStatutoryEntryValues } from "../../src/lib/payroll/service";
import { buildPcbGovernanceBinding } from "../../src/lib/payroll/pcb-governance";
import { pcbProfileDataSchema } from "../../src/lib/payroll/pcb-profile";
import {
  calculatePcbForEntry,
  pcbRuleSupportsTaxRegime,
  STATUTORY_P2_BLOCKERS,
} from "../../src/lib/payroll/statutory-p2";

const profile = pcbProfileDataSchema.parse({
  version: 3,
  profileRevision: 1,
  taxYear: 2026,
  taxRegime: "RESIDENT_STANDARD",
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
    declaredAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  },
  tp3Declaration: {
    formVersion: "HASIL_TP3_1_2026_BM",
    status: "NOT_APPLICABLE",
    grossRemunerationCents: 0,
    epfCents: 0,
    pcbCents: 0,
    zakatCents: 0,
    entries: [],
    sourceReference: null,
    declaredAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  },
  religiousTravelLevyDeclaration: {
    status: "NOT_APPLICABLE",
    amountCents: 0,
    sourceReference: null,
    declaredAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  },
  confirmedAt: "2026-01-01T00:00:00.000Z",
});

const parsedP1Profile = pcbProfileDataSchema.parse({
  ...profile,
  version: 4,
  profileRevision: 2,
  taxRegimeTimeline: [
    {
      taxYear: 2026,
      regime: "RESIDENT_STANDARD",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      approvalStatus: "NOT_REQUIRED",
      officialSourceReference: "HASiL PCB Computerised Calculation Specification 2026",
      evidenceReference: null,
      approvalReference: null,
      approvedCompany: null,
      approvedActivity: null,
      approvedPosition: null,
      reviewedByUserId: null,
      confirmedAt: "2026-01-01T00:00:00.000Z",
      revision: 2,
    },
  ],
  nonCashRemunerationFacts: [
    {
      id: "bik-car-2026",
      taxYear: 2026,
      kind: "BIK",
      inputBasis: "ANNUAL_VALUE",
      valueCents: 2_500_000,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      officialSourceReference: "HASiL PCB Computerised Calculation Specification 2026",
      evidenceReference: "BIK valuation retained",
      reviewStatus: "REVIEWED",
      revision: 2,
    },
    {
      id: "vola-housing-2026",
      taxYear: 2026,
      kind: "VOLA",
      inputBasis: "MONTHLY_VALUE",
      valueCents: 150_000,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      officialSourceReference: "HASiL PCB Computerised Calculation Specification 2026",
      evidenceReference: "VOLA valuation retained",
      reviewStatus: "REVIEWED",
      revision: 2,
    },
    {
      id: "exempt-allowance-2026",
      taxYear: 2026,
      kind: "EXEMPT_ALLOWANCE",
      inputBasis: "MONTHLY_VALUE",
      valueCents: 100_000,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      officialSourceReference: "HASiL PCB Computerised Calculation Specification 2026",
      evidenceReference: "Exemption evidence retained",
      reviewStatus: "REVIEWED",
      revision: 2,
    },
  ],
  componentClassificationFacts: [],
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
    declaredAt: "2026-01-01T00:00:00.000Z",
    reviewedAt: "2026-01-01T00:00:00.000Z",
  },
});
if (parsedP1Profile.version !== 4) throw new Error("Expected PCB profile version 4");
const p1Profile = parsedP1Profile;

const governanceBinding = buildPcbGovernanceBinding({
  version: "PCB_2026_ENGINEERING_TEST",
  effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
  sourceDigest: "a".repeat(64),
  datasetDigest: "b".repeat(64),
  classificationVersion: "PCB_2026_CLASSIFICATION_V1",
  classificationDigest: "c".repeat(64),
  calculatorVersion: PCB_2026_CALCULATOR_VERSION,
  verificationEvidence: null,
});

function database(priorSnapshots: unknown[] = []) {
  return {
    payrollEntryStatutorySnapshot: {
      findMany: async () => priorSnapshots,
    },
  } as never;
}

function input(month = 0) {
  return {
    businessId: "business-1",
    membershipId: "membership-1",
    statutoryPeriod: new Date(Date.UTC(2026, month, 1)),
  } as never;
}

function earning(amountCents: number, treatment: "INCLUDED" | "ADDITIONAL_REMUNERATION") {
  return {
    component: {
      id: `component-${amountCents}-${treatment}`,
      type: "EARNING" as const,
      amount: { toString: () => (amountCents / 100).toFixed(2) },
    },
    treatment,
  };
}

test("runtime PCB adapter calculates and retains the exact canonical calculator result", async () => {
  const result = await calculatePcbForEntry(database(), input(), {
    pcbProfile: profile,
    treatments: [earning(550_000, "INCLUDED")],
    epfEmployeeCents: 60_500,
    normalEpfEmployeeCents: 60_500,
    governanceBinding,
  });
  const expected = calculatePcb2026({
    taxYear: 2026,
    calculationMonth: 1,
    taxRegime: "RESIDENT_STANDARD",
    employeeCategory: "CATEGORY_1",
    individualDisabled: false,
    spouseDisabled: false,
    children: profile.children,
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
  });

  assert.equal(result.status, "CALCULATED");
  assert.equal(expected.status, "CALCULATED");
  if (result.status !== "CALCULATED" || expected.status !== "CALCULATED") return;
  assert.equal(result.calculation.amountCents, expected.amountCents);
  assert.equal(result.wageBaseCents, 550_000);
  assert.equal(result.metadata.pcbCents, expected.amountCents);
  assert.ok(result.calculationInputDigest.length > 32);
});

test("runtime PCB adapter includes BIK and VOLA in PCB only and freezes their evidence", async () => {
  const result = await calculatePcbForEntry(database(), input(7), {
    pcbProfile: p1Profile,
    treatments: [earning(550_000, "INCLUDED")],
    epfEmployeeCents: 60_500,
    normalEpfEmployeeCents: 60_500,
    governanceBinding,
  });
  const expected = calculatePcb2026({
    taxYear: 2026,
    calculationMonth: 8,
    taxRegime: "RESIDENT_STANDARD",
    employeeCategory: "CATEGORY_1",
    individualDisabled: false,
    spouseDisabled: false,
    children: p1Profile.children,
    priorGrossRemunerationCents: 0,
    priorEpfCents: 0,
    priorPcbCents: 0,
    accumulatedAllowableDeductionsCents: 0,
    accumulatedZakatCents: 0,
    currentNormalRemunerationCents: 977_700,
    currentNormalEpfCents: 60_500,
    currentAdditionalRemunerationCents: 0,
    currentAdditionalEpfCents: 0,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
  });

  assert.equal(result.status, "CALCULATED");
  assert.equal(expected.status, "CALCULATED");
  if (result.status !== "CALCULATED" || expected.status !== "CALCULATED") return;
  assert.equal(result.calculation.amountCents, expected.amountCents);
  assert.equal(result.wageBaseCents, 550_000);
  assert.equal(result.metadata.cashNormalRemunerationCents, 550_000);
  assert.equal(result.metadata.pcbOnlyNormalRemunerationCents, 427_700);
  assert.equal(result.metadata.normalRemunerationCents, 977_700);
  assert.equal(result.metadata.exemptBenefitEvidenceCents, 100_000);
  assert.equal(result.metadata.taxRegimeRevision, 2);
  assert.equal(
    (result.metadata.nonCashRemunerationFacts as Array<{ payslipGrossCents: number }>).every(
      (fact) => fact.payslipGrossCents === 0,
    ),
    true,
  );
});

test("runtime PCB adapter fails closed when additional-pay EPF is not allocated", async () => {
  const result = await calculatePcbForEntry(database(), input(7), {
    pcbProfile: profile,
    treatments: [
      earning(550_000, "INCLUDED"),
      earning(100_000, "ADDITIONAL_REMUNERATION"),
    ],
    epfEmployeeCents: 71_500,
    normalEpfEmployeeCents: null,
    governanceBinding,
  });
  assert.deepEqual(result, {
    status: "BLOCKED",
    blocker: STATUTORY_P2_BLOCKERS.PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED,
  });
});

test("runtime PCB adapter allocates additional-pay EPF as total EPF less normal-remuneration EPF", async () => {
  const result = await calculatePcbForEntry(database(), input(7), {
    pcbProfile: profile,
    treatments: [
      earning(550_000, "INCLUDED"),
      earning(100_000, "ADDITIONAL_REMUNERATION"),
    ],
    epfEmployeeCents: 71_500,
    normalEpfEmployeeCents: 60_500,
    governanceBinding,
  });
  const expected = calculatePcb2026({
    taxYear: 2026,
    calculationMonth: 8,
    taxRegime: "RESIDENT_STANDARD",
    employeeCategory: "CATEGORY_1",
    individualDisabled: false,
    spouseDisabled: false,
    children: profile.children,
    priorGrossRemunerationCents: 0,
    priorEpfCents: 0,
    priorPcbCents: 0,
    accumulatedAllowableDeductionsCents: 0,
    accumulatedZakatCents: 0,
    currentNormalRemunerationCents: 550_000,
    currentNormalEpfCents: 60_500,
    currentAdditionalRemunerationCents: 100_000,
    currentAdditionalEpfCents: 11_000,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
  });

  assert.equal(result.status, "CALCULATED");
  assert.equal(expected.status, "CALCULATED");
  if (result.status !== "CALCULATED" || expected.status !== "CALCULATED") return;
  assert.equal(result.calculation.amountCents, expected.amountCents);
  assert.equal(result.metadata.normalEpfCents, 60_500);
  assert.equal(result.metadata.additionalEpfCents, 11_000);
  assert.equal(result.metadata.approvedSchemeContributionCents, 71_500);
});

test("runtime PCB adapter rejects an unreadable finalized YTD snapshot", async () => {
  const result = await calculatePcbForEntry(
    database([
      {
        id: "snapshot-1",
        calculationMetadata: { pcbCents: 100 },
        sourceDigest: "digest",
        payrollRun: { periodStart: new Date(Date.UTC(2026, 0, 1)) },
      },
    ]),
    input(1),
    {
      pcbProfile: profile,
      treatments: [earning(550_000, "INCLUDED")],
      epfEmployeeCents: 60_500,
      normalEpfEmployeeCents: 60_500,
      governanceBinding,
    },
  );
  assert.deepEqual(result, {
    status: "BLOCKED",
    blocker: STATUTORY_P2_BLOCKERS.PCB_YTD_LEDGER_INCOMPLETE,
  });
});

test("runtime PCB adapter requires governed TP1, TP3 and levy declaration records", async () => {
  const legacy = pcbProfileDataSchema.parse({
    ...profile,
    version: 1,
    tp1Declaration: undefined,
    tp3Declaration: undefined,
    religiousTravelLevyDeclaration: undefined,
  });
  const result = await calculatePcbForEntry(database(), input(), {
    pcbProfile: legacy,
    treatments: [earning(550_000, "INCLUDED")],
    epfEmployeeCents: 60_500,
    normalEpfEmployeeCents: 60_500,
    governanceBinding,
  });
  assert.deepEqual(result, {
    status: "BLOCKED",
    blocker: STATUTORY_P2_BLOCKERS.PCB_PROFILE_INCOMPLETE,
  });
});

test("PCB activation evidence limits runtime calculation to an explicitly verified tax regime", () => {
  const rule = {
    id: "pcb-rule-1",
    scheme: "PCB" as const,
    version: "PCB_2026_1",
    effectiveFrom: new Date(Date.UTC(2026, 0, 1)),
    effectiveTo: null,
    readiness: "CALCULATION_VERIFIED" as const,
    status: "ACTIVE" as const,
    verificationEvidence: {
      supportedTaxRegimes: ["RESIDENT_STANDARD"],
    },
  };

  assert.equal(pcbRuleSupportsTaxRegime(rule, "RESIDENT_STANDARD"), true);
  assert.equal(pcbRuleSupportsTaxRegime(rule, "NON_RESIDENT"), false);
  assert.equal(
    pcbRuleSupportsTaxRegime({ ...rule, verificationEvidence: null }, "RESIDENT_STANDARD"),
    false,
  );
});

test("payroll draft generation forwards the governed PCB profile into statutory materialization", () => {
  const service = readFileSync("src/lib/payroll/service.ts", "utf8");
  assert.match(
    service,
    /taxIdentificationNumber:\s*membership\.taxIdentificationNumber,\s*pcbProfile:\s*membership\.pcbProfile,/,
  );
});

test("ordinary payroll entry editing cannot directly override PCB or CP38", () => {
  assert.doesNotThrow(() => assertNoDirectStatutoryEntryValues({ notes: "Reviewed" }));
  assert.throws(
    () => assertNoDirectStatutoryEntryValues({ notes: "Reviewed", pcb: "10.00" } as never),
    /Direct statutory amount overrides are disabled/,
  );
  assert.throws(
    () => assertNoDirectStatutoryEntryValues({ notes: "Reviewed", cp38: "10.00" } as never),
    /Direct statutory amount overrides are disabled/,
  );
});
