import assert from "node:assert/strict";
import test from "node:test";
import {
  getPcbProfileReadiness,
  isGovernedEmployeePcbProfile,
  parseEmployeePcbProfile,
  pcbProfileDataSchema,
} from "../../src/lib/payroll/pcb-profile";
import {
  PCB_2026_TP1_CATEGORIES,
  PCB_2026_TP3_CATEGORIES,
  pcbTp1DeclarationEntriesSchema,
  pcbTp3DeclarationEntriesSchema,
} from "../../src/lib/payroll/pcb-declarations";

const base = {
  taxYear: 2026 as const,
  taxRegime: "RESIDENT_STANDARD" as const,
  employeeCategory: "CATEGORY_1" as const,
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
  confirmedAt: "2026-08-21T12:00:00.000+08:00",
};

const governed = {
  ...base,
  version: 2 as const,
  tp1Declaration: {
    formVersion: "HASIL_TP1_1_2026_BM" as const,
    status: "NOT_APPLICABLE" as const,
    allowableDeductionsCents: 0,
    zakatCents: 0,
    sourceReference: null,
    declaredAt: base.confirmedAt,
    reviewedAt: base.confirmedAt,
  },
  tp3Declaration: {
    formVersion: "HASIL_TP3_1_2026_BM" as const,
    status: "NOT_APPLICABLE" as const,
    grossRemunerationCents: 0,
    epfCents: 0,
    pcbCents: 0,
    allowableDeductionsCents: 0,
    zakatCents: 0,
    sourceReference: null,
    declaredAt: base.confirmedAt,
    reviewedAt: base.confirmedAt,
  },
  religiousTravelLevyDeclaration: {
    status: "NOT_APPLICABLE" as const,
    amountCents: 0,
    sourceReference: null,
    declaredAt: base.confirmedAt,
    reviewedAt: base.confirmedAt,
  },
};

test("legacy PCB profile remains readable but is not a governed declaration record", () => {
  const profile = parseEmployeePcbProfile({ ...base, version: 1 } as never);
  assert.ok(profile);
  assert.equal(isGovernedEmployeePcbProfile(profile), false);
});

test("legacy aggregate declarations remain readable but require structured reconfirmation", () => {
  const profile = pcbProfileDataSchema.parse(governed);
  assert.equal(isGovernedEmployeePcbProfile(profile), false);
  assert.equal(profile.version, 2);
  assert.equal(getPcbProfileReadiness(profile).status, "REVIEW_REQUIRED");
});

test("structured YA 2026 PCB profile is governed and ready", () => {
  const profile = pcbProfileDataSchema.parse({
    ...governed,
    version: 3,
    profileRevision: 1,
    tp1Declaration: {
      ...governed.tp1Declaration,
      entries: [],
      allowableDeductionsCents: undefined,
      zakatCents: undefined,
    },
    tp3Declaration: {
      ...governed.tp3Declaration,
      entries: [],
      allowableDeductionsCents: undefined,
    },
  });
  assert.equal(isGovernedEmployeePcbProfile(profile), true);
  assert.deepEqual(getPcbProfileReadiness(profile), { status: "READY", reasons: [] });
});

test("missing PCB profile is blocked before automatic calculation", () => {
  assert.equal(getPcbProfileReadiness(null).status, "MISSING");
});

test("confirmed TP3 amount requires a supporting reference", () => {
  const parsed = pcbProfileDataSchema.safeParse({
    ...governed,
    priorEmployerGrossRemunerationCents: 100_000,
    tp3Declaration: {
      ...governed.tp3Declaration,
      status: "CONFIRMED",
      grossRemunerationCents: 100_000,
      sourceReference: null,
    },
  });
  assert.equal(parsed.success, false);
});

test("not-applicable declaration cannot silently retain calculation amounts", () => {
  const parsed = pcbProfileDataSchema.safeParse({
    ...governed,
    currentAllowableDeductionsCents: 5_000,
  });
  assert.equal(parsed.success, false);
});

test("TP1 and TP3 retain their distinct official 2026 category numbering", () => {
  assert.deepEqual(
    PCB_2026_TP1_CATEGORIES.map((entry) => entry.code),
    [...Array.from({ length: 17 }, (_, index) => `C${index + 1}`), "D1"],
  );
  assert.deepEqual(
    PCB_2026_TP3_CATEGORIES.map((entry) => entry.code),
    Array.from({ length: 17 }, (_, index) => `D${index + 1}`),
  );
  assert.equal(pcbTp1DeclarationEntriesSchema.safeParse([]).success, true);
  assert.equal(pcbTp3DeclarationEntriesSchema.safeParse([]).success, true);
  assert.equal(pcbTp3DeclarationEntriesSchema.safeParse([{
    taxYear: 2026,
    categoryCode: "C1",
    amountCents: 100,
    categoryLimitCents: 800_000,
    sourceForm: "HASIL_TP3_1_2026_BM",
    sourceReference: "TP3-2026",
    declarationStatus: "CONFIRMED",
    reviewStatus: "REVIEWED",
    revision: 1,
  }]).success, false);
});
