import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { statutoryExportStepUpResourceId } from "../../src/lib/payroll/high-risk-mfa";
import { pcbProfileDataSchema } from "../../src/lib/payroll/pcb-profile";
import { publishPayrollPayslips } from "../../src/lib/payroll/payslip-publication";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import {
  finalizePayrollRun,
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import { downloadOrCreateStatutoryArtifact } from "../../src/lib/payroll/statutory-artifact";
import { prisma } from "../../src/lib/prisma";
import { issueTestHighRiskStepUp } from "../helpers/high-risk-step-up";

const request = { ipAddress: "127.0.0.1", userAgent: "pcb-vc1-disposable-e2e" };
const testMonth = "2026-08";

test("PCB VC1 executes A-F through real payroll, finalization, frozen snapshots, payslips and database-backed CP39", async () => {
  assertDisposableDatabase();
  const previousEnvironment = process.env.TETAMU_PAYROLL_ENVIRONMENT;
  const previousKeyVersion = process.env.STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION;
  const previousKeys = process.env.STATUTORY_ARTIFACT_ENCRYPTION_KEYS;
  process.env.TETAMU_PAYROLL_ENVIRONMENT = "TESTING";
  process.env.STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION = "pcb-vc1-e2e";
  process.env.STATUTORY_ARTIFACT_ENCRYPTION_KEYS = JSON.stringify({
    "pcb-vc1-e2e": Buffer.alloc(32, 21).toString("base64"),
  });

  try {
    const fixture = await createFixture();

    // A prior unfinalized Draft must never enter August current-employer YTD.
    const juneDraft = await generatePayrollRun(
      { businessId: fixture.businessId, actor: fixture.actor, request, month: "2026-06" },
      prisma,
    );
    assert.equal(juneDraft.status, "DRAFT");

    const july = await runFinalizePublishAndExport(fixture, "2026-07");
    const julyB = await loadPcbSnapshot(july.runId, fixture.memberships.B);
    assert.equal(julyB.status, "CALCULATED");
    assert.ok(Number(julyB.employeeContribution) > 0);

    const draft = await generatePayrollRun(
      { businessId: fixture.businessId, actor: fixture.actor, request, month: testMonth },
      prisma,
    );
    const firstState = await loadRunState(draft.id);
    assert.equal(firstState.entries.length, 6);

    // A — normal remuneration follows the governed normal-remuneration path.
    const a = entryByCode(firstState, "VC1A");
    const aPcb = snapshot(a, "PCB");
    assert.equal(aPcb.status, "CALCULATED");
    assert.equal(metadata(aPcb).normalRemunerationCents, 1_000_000);
    assert.equal(metadata(aPcb).additionalRemunerationCents, 0);
    assert.ok(Number(aPcb.employeeContribution) > 0);

    // B — only the earlier finalized period contributes to current-employer YTD.
    const b = entryByCode(firstState, "VC1B");
    const bPcb = snapshot(b, "PCB");
    assert.equal(metadata(bPcb).currentEmployerYtdRemunerationCents, 800_000);
    assert.equal(metadata(bPcb).ytdPcbCents, Math.round(Number(julyB.employeeContribution) * 100));
    assert.equal(metadata(bPcb).ytdSourceCount, 1);

    // C — structured TP1 deductions are frozen into the calculator input.
    const c = entryByCode(firstState, "VC1C");
    const cPcb = snapshot(c, "PCB");
    assert.equal(metadata(cPcb).allowableDeductionsCents, 100_000);
    assert.ok(cPcb.profileVersion);
    assert.equal((cPcb.profileVersion.pcbProfileSnapshot as PcbProfile).tp1Declaration.status, "CONFIRMED");

    // D — structured TP3 previous-employer facts enter YTD exactly once.
    const d = entryByCode(firstState, "VC1D");
    const dPcb = snapshot(d, "PCB");
    assert.equal(metadata(dPcb).previousEmployerRemunerationCents, 1_000_000);
    assert.equal(metadata(dPcb).previousEmployerEpfCents, 110_000);
    assert.equal(metadata(dPcb).previousEmployerPcbCents, 25_000);
    assert.equal(metadata(dPcb).ytdSourceCount, 1);

    // E — a governed BONUS is additional remuneration, never normal remuneration.
    const e = entryByCode(firstState, "VC1E");
    const ePcb = snapshot(e, "PCB");
    assert.equal(metadata(ePcb).normalRemunerationCents, 500_000);
    assert.equal(metadata(ePcb).additionalRemunerationCents, 100_000);
    assert.notEqual(metadata(ePcb).normalRemunerationCents, metadata(ePcb).additionalRemunerationCents);

    // F — RM0 is a successful governed calculation, not a missing/blocked result.
    const f = entryByCode(firstState, "VC1F");
    const fPcb = snapshot(f, "PCB");
    assert.equal(fPcb.status, "CALCULATED");
    assert.equal(Number(fPcb.employeeContribution), 0);
    assert.equal(fPcb.blockerCode, null);
    assert.ok(fPcb.calculationInputDigest);

    // Rebuilding unchanged draft inputs is idempotent and cannot duplicate YTD or snapshots.
    const regenerated = await generatePayrollRun(
      { businessId: fixture.businessId, actor: fixture.actor, request, month: testMonth },
      prisma,
    );
    assert.equal(regenerated.id, draft.id);
    const rebuiltState = await loadRunState(draft.id);
    assert.equal(rebuiltState.entries.length, 6);
    assert.equal(
      await prisma.payrollEntryStatutorySnapshot.count({ where: { payrollRunId: draft.id, scheme: "PCB" } }),
      6,
    );
    assert.equal(
      await prisma.payrollEntryComponent.count({ where: { payrollRunId: draft.id, lineKey: "SYSTEM:BASIC_SALARY" } }),
      6,
    );
    assert.equal(metadata(snapshot(entryByCode(rebuiltState, "VC1B"), "PCB")).ytdSourceCount, 1);
    assert.equal(
      snapshot(entryByCode(rebuiltState, "VC1B"), "PCB").sourceDigest,
      bPcb.sourceDigest,
    );

    const readiness = await getPayrollPeriodReadiness(
      { businessId: fixture.businessId, month: testMonth, runId: draft.id },
      prisma,
    );
    assert.equal(readiness.status, "REVIEW_REQUIRED");
    assert.equal(readiness.canProceed, true);
    assert.equal(readiness.blockers.length, 0);

    const august = await finalizePublishAndExport(fixture, draft.id, testMonth);
    assert.equal(august.finalized.status, "FINALIZED");
    assert.equal(august.published.publishedCount, 6);
    assert.equal(august.publications.length, 6);
    for (const publication of august.publications) {
      assert.equal(Buffer.from(publication.documentBytes).subarray(0, 4).toString(), "%PDF");
    }
    assertCp39(august.cp39.body, august.cp39.recordCount ?? 0);

    const frozenBefore = await frozenProof(draft.id);
    const aMembership = fixture.memberships.A;
    const live = await prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: aMembership } });
    const changedProfile = structuredClone(live.pcbProfile as PcbProfile);
    changedProfile.children.under18Full = 3;
    changedProfile.currentAllowableDeductionsCents = 250_000;
    changedProfile.tp1Declaration = {
      ...changedProfile.tp1Declaration,
      status: "CONFIRMED",
      entries: [tp1Entry("C5", 250_000, 250_000, "TP1-AFTER-FINALIZATION")],
      sourceReference: "TP1-AFTER-FINALIZATION",
    };
    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command_maintenance', 'on', true)`;
      await transaction.employeeBusinessMembership.update({
        where: { id: aMembership },
        data: {
          pcbProfile: changedProfile as unknown as Prisma.InputJsonValue,
          statutoryProfileRevision: { increment: 1 },
          taxProfileRevision: { increment: 1 },
        },
      });
    });
    const repeatCp39 = await exportCp39(fixture, draft.id, testMonth);
    const frozenAfter = await frozenProof(draft.id);
    assert.deepEqual(frozenAfter, frozenBefore);
    assert.deepEqual(repeatCp39.body, august.cp39.body);
    assert.equal(repeatCp39.artifactId, august.cp39.artifactId);

    await negativeFailClosedProofs(fixture.ruleId);
  } finally {
    restore("TETAMU_PAYROLL_ENVIRONMENT", previousEnvironment);
    restore("STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION", previousKeyVersion);
    restore("STATUTORY_ARTIFACT_ENCRYPTION_KEYS", previousKeys);
  }
});

type PcbProfile = Extract<ReturnType<typeof pcbProfileDataSchema.parse>, { version: 3 }>;
type PcbProfileOverrides = Partial<Omit<PcbProfile, "religiousTravelLevyDeclaration" | "tp1Declaration" | "tp3Declaration">> & {
  religiousTravelLevyDeclaration?: Partial<PcbProfile["religiousTravelLevyDeclaration"]>;
  tp1Declaration?: Partial<PcbProfile["tp1Declaration"]>;
  tp3Declaration?: Partial<PcbProfile["tp3Declaration"]>;
};

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `PCB VC1 ${token}`, slug: `pcb-vc1-${token}`, timezone: "Asia/Kuala_Lumpur" },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "VC1 Branch", countryCode: "MY", stateCode: "SBH" },
  });
  const owner = await prisma.user.create({
    data: {
      businessId: business.id,
      email: `pcb-vc1-${token}@test.local`,
      name: "PCB VC1 Owner",
      role: "BUSINESS_OWNER",
    },
  });
  await prisma.businessStatutoryProfile.create({
    data: { businessId: business.id, lhdnEmployerNumberHq: "1234567890", lhdnEmployerNumber: "0987654321" },
  });
  const actor = { userId: owner.id, name: owner.name, email: owner.email! };
  const rule = await prisma.statutoryRuleSet.create({
    data: {
      scheme: "PCB",
      version: `PCB_2026_VC1_DISPOSABLE_${token}`,
      jurisdictionCode: "MY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      authority: "LHDN / HASiL retained YA2026 engineering evidence",
      sourceReference: "https://www.hasil.gov.my/",
      sourceDocumentName: "Tetamu PCB 2026 VC1 disposable verification binding",
      sourceDigest: digest("pcb-vc1-source"),
      datasetDigest: digest("pcb-vc1-dataset"),
      goldenFixtureDigest: digest("pcb-vc1-golden"),
      independentReviewDigest: digest("pcb-vc1-independent"),
      classificationVersion: "MALAYSIA_PCB_2026_VC1",
      classificationDigest: digest("pcb-vc1-classifications"),
      parserName: "tetamu-pcb-2026",
      parserVersion: "1.0.0",
      calculatorVersion: "TETAMU_PCB_2026_1.1.0",
      calculatorTestDigest: digest("pcb-vc1-calculator-tests"),
      datasetRowCount: 1,
      readiness: "CALCULATION_VERIFIED",
      status: "ACTIVE",
      humanReviewStatus: "COMPLETED",
      humanReviewRevision: 1,
      humanClassificationDigest: digest("pcb-vc1-human-classification"),
      humanReviewCompletedAt: new Date(),
      humanReviewCompletedById: owner.id,
      calculationVerifiedAt: new Date(),
      calculationVerifiedById: owner.id,
      activatedAt: new Date(),
      activatedById: owner.id,
      activationReason: "Disposable VC1 engineering verification only.",
      verificationEvidence: {
        environment: "TESTING",
        productionEligible: false,
        supportedTaxRegimes: ["RESIDENT_STANDARD"],
        hasilSoftwareVerification: { status: "NOT_PERFORMED" },
      },
      createdById: owner.id,
      classifications: {
        create: [
          {
            scheme: "PCB",
            componentCode: "BASIC_SALARY",
            sourceType: "BASIC_SALARY",
            treatment: "INCLUDED",
            rationale: "Normal monthly remuneration for the disposable VC1 proof.",
            authorityRef: "HASIL_MTD_SPEC_2026:NORMAL_REMUNERATION",
          },
          {
            scheme: "PCB",
            componentCode: "BONUS",
            sourceType: "RECURRING_PAY",
            treatment: "ADDITIONAL_REMUNERATION",
            rationale: "Governed additional remuneration for the disposable VC1 proof.",
            authorityRef: "HASIL_MTD_SPEC_2026:ADDITIONAL_REMUNERATION",
          },
        ],
      },
    },
  });

  const specifications = [
    ["A", "VC1A", 10000, baseProfile()],
    ["B", "VC1B", 8000, baseProfile()],
    [
      "C",
      "VC1C",
      6000,
      baseProfile({
        currentAllowableDeductionsCents: 100_000,
        tp1Declaration: {
          status: "CONFIRMED",
          entries: [tp1Entry("C5", 100_000, 250_000, "TP1-VC1-C")],
          sourceReference: "TP1-VC1-C",
        },
      }),
    ],
    [
      "D",
      "VC1D",
      6500,
      baseProfile({
        priorEmployerGrossRemunerationCents: 1_000_000,
        priorEmployerEpfCents: 110_000,
        priorEmployerPcbCents: 25_000,
        priorEmployerAllowableDeductionsCents: 50_000,
        priorEmployerZakatCents: 10_000,
        tp3Declaration: {
          status: "CONFIRMED",
          grossRemunerationCents: 1_000_000,
          epfCents: 110_000,
          pcbCents: 25_000,
          zakatCents: 10_000,
          entries: [tp3Entry("D5", 50_000, 250_000, "TP3-VC1-D")],
          sourceReference: "TP3-VC1-D",
        },
      }),
    ],
    ["E", "VC1E", 5000, baseProfile()],
    ["F", "VC1F", 1000, baseProfile()],
  ] as const;
  const memberships = {} as Record<(typeof specifications)[number][0], string>;
  for (const [key, code, salary, pcbProfile] of specifications) {
    const phone = `+601${String(Object.keys(memberships).length + 1).padStart(8, "0")}`;
    const account = await prisma.employeeAccount.create({
      data: { name: code, phoneNumber: phone, phoneNormalized: phone },
    });
    const membership = await prisma.employeeBusinessMembership.create({
      data: {
        businessId: business.id,
        employeeAccountId: account.id,
        employeeCode: code,
        fullName: `PCB Scenario ${key}`,
        joinedAt: new Date(key === "B" ? "2026-01-01T00:00:00.000Z" : "2026-08-01T00:00:00.000Z"),
        payBasis: "MONTHLY",
        phoneNumber: phone,
        phoneNumberNormalized: phone,
        dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
        statutoryNationality: "MALAYSIAN",
        statutoryIdentityType: "NEW_IC",
        statutoryIdentityNumber: `90010112${String(Object.keys(memberships).length + 1).padStart(4, "0")}`,
        statutoryCountryCode: "MY",
        taxIdentificationNumber: `1000000${String(Object.keys(memberships).length + 1).padStart(4, "0")}`,
        statutoryProfileRevision: 1,
        taxProfileRevision: 1,
        pcbProfile: pcbProfile as unknown as Prisma.InputJsonValue,
      },
    });
    await prisma.employeeLindung24ParticipationVersion.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        revision: 1,
        effectiveFromMonth: new Date("2026-01-01T00:00:00.000Z"),
        status: "DEFAULT_PARTICIPATING",
        employerContext: "SINGLE_EMPLOYER",
        selectedEmployer: "CURRENT_BUSINESS",
        act4Covered: false,
        officialSubmittedAt: null,
        sourceType: "OFFICIAL_TRANSITION",
        sourceReference: `VC1-NOT-COVERED-${code}`,
        reason: "Disposable PCB VC1 fixture: employee is outside LINDUNG 24 coverage.",
        sourceDigest: digest(`vc1-lindung24-not-covered-${code}`),
        recordedById: owner.id,
      },
    });
    await prisma.employeeBranchAssignment.create({
      data: { businessId: business.id, branchId: branch.id, membershipId: membership.id, isPrimary: true },
    });
    await prisma.employeeCompensationVersion.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        effectiveFromMonth: new Date(key === "B" ? "2026-01-01T00:00:00.000Z" : "2026-08-01T00:00:00.000Z"),
        payBasis: "MONTHLY",
        baseRate: salary,
        source: "MANUAL",
        reasonType: "DATA_MIGRATION",
        reasonNote: "PCB VC1 disposable deterministic fixture.",
        createdById: owner.id,
      },
    });
    memberships[key] = membership.id;
  }
  const bonus = await prisma.employeeRecurringPayComponent.create({
    data: { businessId: business.id, membershipId: memberships.E, type: "EARNING", code: "BONUS", createdById: owner.id },
  });
  await prisma.employeeRecurringPayComponentVersion.create({
    data: {
      businessId: business.id,
      membershipId: memberships.E,
      componentId: bonus.id,
      revision: 1,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      name: "VC1 governed bonus",
      amount: 1000,
      source: "MANUAL",
      reasonType: "DATA_MIGRATION",
      reasonNote: "PCB VC1 additional remuneration fixture.",
      createdById: owner.id,
    },
  });
  await createLockedTimesheet({ businessId: business.id, branchId: branch.id, ownerId: owner.id, month: "2026-06", memberships: [memberships.B] });
  await createLockedTimesheet({ businessId: business.id, branchId: branch.id, ownerId: owner.id, month: "2026-07", memberships: [memberships.B] });
  await createLockedTimesheet({ businessId: business.id, branchId: branch.id, ownerId: owner.id, month: testMonth, memberships: Object.values(memberships) });
  return { businessId: business.id, branchId: branch.id, ownerId: owner.id, actor, memberships, ruleId: rule.id };
}

function baseProfile(overrides: PcbProfileOverrides = {}): PcbProfile {
  const timestamp = "2026-01-01T00:00:00.000Z";
  const profile = {
    version: 3 as const,
    profileRevision: 1,
    taxYear: 2026 as const,
    taxRegime: "RESIDENT_STANDARD" as const,
    employeeCategory: "CATEGORY_1" as const,
    individualDisabled: false,
    spouseDisabled: false,
    children: {
      under18Full: 0, under18Half: 0, studying18PlusFull: 0, studying18PlusHalf: 0,
      diplomaOrDegreeFull: 0, diplomaOrDegreeHalf: 0, disabledFull: 0, disabledHalf: 0,
      disabledStudyingFull: 0, disabledStudyingHalf: 0,
    },
    priorEmployerGrossRemunerationCents: 0,
    priorEmployerEpfCents: 0,
    priorEmployerPcbCents: 0,
    priorEmployerAllowableDeductionsCents: 0,
    priorEmployerZakatCents: 0,
    currentAllowableDeductionsCents: 0,
    currentZakatCents: 0,
    currentReligiousTravelLevyCents: 0,
    tp1Declaration: { formVersion: "HASIL_TP1_1_2026_BM" as const, status: "NOT_APPLICABLE" as const, entries: [], sourceReference: null, declaredAt: timestamp, reviewedAt: timestamp },
    tp3Declaration: { formVersion: "HASIL_TP3_1_2026_BM" as const, status: "NOT_APPLICABLE" as const, grossRemunerationCents: 0, epfCents: 0, pcbCents: 0, zakatCents: 0, entries: [], sourceReference: null, declaredAt: timestamp, reviewedAt: timestamp },
    religiousTravelLevyDeclaration: { status: "NOT_APPLICABLE" as const, amountCents: 0, sourceReference: null, declaredAt: timestamp, reviewedAt: timestamp },
    confirmedAt: timestamp,
  };
  return pcbProfileDataSchema.parse({
    ...profile,
    ...overrides,
    religiousTravelLevyDeclaration: { ...profile.religiousTravelLevyDeclaration, ...overrides.religiousTravelLevyDeclaration },
    tp1Declaration: { ...profile.tp1Declaration, ...overrides.tp1Declaration },
    tp3Declaration: { ...profile.tp3Declaration, ...overrides.tp3Declaration },
  }) as PcbProfile;
}

function tp1Entry(categoryCode: "C5", amountCents: number, categoryLimitCents: number, sourceReference: string) {
  return { taxYear: 2026 as const, categoryCode, amountCents, categoryLimitCents, sourceForm: "HASIL_TP1_1_2026_BM" as const, sourceReference, declarationStatus: "CONFIRMED" as const, reviewStatus: "REVIEWED" as const, revision: 1 };
}

function tp3Entry(categoryCode: "D5", amountCents: number, categoryLimitCents: number, sourceReference: string) {
  return { taxYear: 2026 as const, categoryCode, amountCents, categoryLimitCents, sourceForm: "HASIL_TP3_1_2026_BM" as const, sourceReference, declarationStatus: "CONFIRMED" as const, reviewStatus: "REVIEWED" as const, revision: 1 };
}

async function createLockedTimesheet(input: { businessId: string; branchId: string; ownerId: string; month: string; memberships: string[] }) {
  const periodStart = new Date(`${input.month}-01T00:00:00.000Z`);
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({ data: { businessId: input.businessId, periodStart } });
  const revision = await prisma.attendanceTimesheetRevision.create({
    data: { businessId: input.businessId, timesheetId: timesheet.id, revision: 1, periodStart, sourceDigest: digest(`timesheet-${input.businessId}-${input.month}`), reason: "PCB VC1 disposable locked attendance.", lockedById: input.ownerId },
  });
  await prisma.attendanceMonthlyTimesheet.update({ where: { id: timesheet.id }, data: { currentRevisionId: revision.id, status: "LOCKED" } });
  for (const [index, membershipId] of input.memberships.entries()) {
    const workDate = new Date(`${input.month}-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
    const sourceDigest = digest(`${input.month}-${membershipId}`);
    const finalResult = await prisma.attendanceP2FinalResult.create({
      data: { businessId: input.businessId, branchId: input.branchId, membershipId, workDate, version: 1, outcome: "PRESENT", expectedDayKindSnapshot: "WORKDAY", totalBreakMinutes: 60, totalWorkedMinutes: 480, sourceDigest, resolutionDigest: digest(`resolved-${sourceDigest}`), createdById: input.ownerId },
    });
    await prisma.attendanceTimesheetP2DaySnapshot.create({
      data: { revisionId: revision.id, businessId: input.businessId, branchId: input.branchId, membershipId, workDate, finalResultId: finalResult.id, finalResultVersion: 1, outcome: "PRESENT", expectedDayKindSnapshot: "WORKDAY", timezoneSnapshot: "Asia/Kuala_Lumpur", totalBreakMinutes: 60, totalWorkedMinutes: 480, sourceDigest },
    });
  }
}

async function runFinalizePublishAndExport(fixture: Awaited<ReturnType<typeof createFixture>>, month: string) {
  const run = await generatePayrollRun({ businessId: fixture.businessId, actor: fixture.actor, request, month }, prisma);
  return { runId: run.id, ...(await finalizePublishAndExport(fixture, run.id, month)) };
}

async function finalizePublishAndExport(fixture: Awaited<ReturnType<typeof createFixture>>, runId: string, month: string) {
  await submitPayrollRunForReview({ businessId: fixture.businessId, actor: fixture.actor, request, runId }, prisma);
  const authorization = await issueTestHighRiskStepUp(prisma, { actionKey: "PAYROLL_FINALIZE", businessId: fixture.businessId, resourceId: runId, userId: fixture.ownerId });
  const finalized = await finalizePayrollRun({ businessId: fixture.businessId, actor: fixture.actor, request, runId, allowSelfApprovalOverride: true, overrideReason: "Disposable VC1 verification", stepUp: authorization.stepUp }, prisma);
  const published = await publishPayrollPayslips({ businessId: fixture.businessId, runId, actor: fixture.actor, request }, prisma);
  const publications = await prisma.payrollPayslipPublication.findMany({ where: { payrollRunId: runId }, orderBy: { membershipId: "asc" } });
  const cp39 = await exportCp39(fixture, runId, month);
  return { finalized, published, publications, cp39 };
}

async function exportCp39(fixture: Awaited<ReturnType<typeof createFixture>>, _runId: string, month: string) {
  const resourceId = statutoryExportStepUpResourceId(month, "PCB");
  const authorization = await issueTestHighRiskStepUp(prisma, { actionKey: "STATUTORY_EXPORT", businessId: fixture.businessId, resourceId, userId: fixture.ownerId });
  return downloadOrCreateStatutoryArtifact({ actor: fixture.actor, businessId: fixture.businessId, month, provider: "PCB", request, allowCreate: true, stepUp: authorization.stepUp, stepUpResourceId: resourceId }, prisma);
}

async function loadRunState(runId: string) {
  return prisma.payrollRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      entries: { include: { components: true, statutorySnapshots: { include: { profileVersion: true } } }, orderBy: { employeeCodeSnapshot: "asc" } },
    },
  });
}

type RunState = Awaited<ReturnType<typeof loadRunState>>;
type Entry = RunState["entries"][number];
type Snapshot = Entry["statutorySnapshots"][number];
function entryByCode(state: RunState, code: string) { return state.entries.find((entry) => entry.employeeCodeSnapshot === code)!; }
function snapshot(entry: Entry, scheme: "PCB") { return entry.statutorySnapshots.find((item) => item.scheme === scheme)!; }
function metadata(item: Snapshot) { return item.calculationMetadata as Record<string, number>; }
async function loadPcbSnapshot(runId: string, membershipId: string) { return prisma.payrollEntryStatutorySnapshot.findFirstOrThrow({ where: { payrollRunId: runId, membershipId, scheme: "PCB" }, include: { profileVersion: true } }); }

async function frozenProof(runId: string) {
  const snapshots = await prisma.payrollEntryStatutorySnapshot.findMany({ where: { payrollRunId: runId, scheme: "PCB" }, orderBy: { membershipId: "asc" } });
  const publications = await prisma.payrollPayslipPublication.findMany({ where: { payrollRunId: runId }, orderBy: { membershipId: "asc" } });
  const artifacts = await prisma.payrollStatutoryExportArtifact.findMany({ where: { payrollRunId: runId, provider: "PCB" }, orderBy: { revision: "asc" } });
  return {
    snapshots: snapshots.map((item) => ({ membershipId: item.membershipId, contribution: item.employeeContribution.toString(), cp38: (item.calculationMetadata as Record<string, unknown>).cp38, input: item.calculationInputDigest, source: item.sourceDigest, metadata: item.calculationMetadata })),
    payslips: publications.map((item) => ({ membershipId: item.membershipId, sha: item.documentSha256 })),
    artifacts: artifacts.map((item) => ({ sha: item.plaintextSha256, bytes: item.byteLength, revision: item.revision })),
  };
}

function assertCp39(body: Buffer, recordCount: number) {
  const text = body.toString("utf8");
  assert.equal(text.endsWith("\r\n"), true);
  const lines = text.slice(0, -2).split("\r\n");
  assert.equal(lines[0]?.length, 57);
  assert.equal(lines.length - 1, recordCount);
  for (const line of lines.slice(1)) assert.equal(line.length, 136);
  assert.match(lines[0]!, /^H\d{10}\d{10}202608\d{10}\d{5}\d{10}\d{5}$/);
  assert.equal(Number(lines[0]!.slice(27, 37)), lines.slice(1).reduce((sum, line) => sum + Number(line.slice(110, 118)), 0));
  assert.equal(Number(lines[0]!.slice(37, 42)), lines.length - 1);
  assert.equal(Number(lines[0]!.slice(42, 52)), lines.slice(1).reduce((sum, line) => sum + Number(line.slice(118, 126)), 0));
}

async function negativeFailClosedProofs(ruleId: string) {
  const fixture = await createNegativeFixture("UNKNOWN", "2026-09", baseProfile(), "CUSTOM_UNKNOWN");
  const unknown = await generatePayrollRun({ businessId: fixture.businessId, actor: fixture.actor, request, month: fixture.month }, prisma);
  const unknownReadiness = await getPayrollPeriodReadiness({ businessId: fixture.businessId, month: fixture.month, runId: unknown.id }, prisma);
  assert.equal(unknownReadiness.canProceed, false);
  assert.ok(unknownReadiness.blockers.some((item) => item.code === "STATUTORY_CLASSIFICATION_REQUIRED"));
  await assert.rejects(submitPayrollRunForReview({ businessId: fixture.businessId, actor: fixture.actor, request, runId: unknown.id }, prisma));

  const missing = await createNegativeFixture("MISSING", "2026-09", null, null);
  const missingRun = await generatePayrollRun({ businessId: missing.businessId, actor: missing.actor, request, month: missing.month }, prisma);
  const missingSnapshot = await prisma.payrollEntryStatutorySnapshot.findFirstOrThrow({ where: { payrollRunId: missingRun.id, scheme: "PCB" } });
  assert.equal(missingSnapshot.status, "BLOCKED");
  assert.equal(missingSnapshot.blockerCode, "PCB_PROFILE_INCOMPLETE");

  const cp38 = await createNegativeFixture("CP38", "2026-09", baseProfile(), null);
  for (const reference of ["CP38-A", "CP38-B"]) {
    await prisma.employeeCp38Instruction.create({ data: { businessId: cp38.businessId, membershipId: cp38.membershipId, instructionReference: reference, revision: 1, monthlyAmount: 25, effectiveFromMonth: new Date("2026-09-01T00:00:00.000Z"), evidenceReference: `test://${reference}`, status: "ACTIVE", recordedById: cp38.ownerId, sourceDigest: digest(reference) } });
  }
  await assert.rejects(
    generatePayrollRun({ businessId: cp38.businessId, actor: cp38.actor, request, month: cp38.month }, prisma),
    /PAYROLL_COMPONENT_RECONCILIATION_FAILED/,
  );
  assert.equal(
    await prisma.employeeCp38Instruction.count({
      where: { businessId: cp38.businessId, membershipId: cp38.membershipId, status: "ACTIVE" },
    }),
    2,
  );

  await prisma.statutoryRuleSet.update({ where: { id: ruleId }, data: { status: "RETIRED" } });
  const mismatch = await createNegativeFixture("MISMATCH", "2026-10", baseProfile(), null);
  await prisma.statutoryRuleSet.create({
    data: {
      scheme: "PCB", version: `PCB_VC1_MISMATCH_${randomUUID()}`, jurisdictionCode: "MY", effectiveFrom: new Date("2026-10-01T00:00:00.000Z"), authority: "TEST", sourceReference: "test://mismatch", sourceDocumentName: "Mismatch", sourceDigest: digest("mismatch-source"), datasetDigest: digest("mismatch-dataset"), goldenFixtureDigest: digest("mismatch-golden"), independentReviewDigest: digest("mismatch-independent"), classificationVersion: "MISMATCH", classificationDigest: digest("mismatch-classification"), parserName: "vc1-mismatch", parserVersion: "1.0.0", calculatorVersion: "WRONG_CALCULATOR", calculatorTestDigest: digest("mismatch-calculator-tests"), datasetRowCount: 1, readiness: "CALCULATION_VERIFIED", status: "ACTIVE", humanReviewStatus: "COMPLETED", calculationVerifiedAt: new Date(), calculationVerifiedById: mismatch.ownerId, activatedAt: new Date(), activatedById: mismatch.ownerId, activationReason: "Disposable mismatch fail-closed verification.", verificationEvidence: { supportedTaxRegimes: ["RESIDENT_STANDARD"] }, createdById: mismatch.ownerId, classifications: { create: { scheme: "PCB", componentCode: "BASIC_SALARY", sourceType: "BASIC_SALARY", treatment: "INCLUDED", rationale: "mismatch fail closed", authorityRef: "test://mismatch" } },
    },
  });
  const mismatchRun = await generatePayrollRun({ businessId: mismatch.businessId, actor: mismatch.actor, request, month: mismatch.month }, prisma);
  const mismatchSnapshot = await prisma.payrollEntryStatutorySnapshot.findFirstOrThrow({ where: { payrollRunId: mismatchRun.id, scheme: "PCB" } });
  assert.equal(mismatchSnapshot.status, "BLOCKED");
  assert.equal(mismatchSnapshot.blockerCode, "PCB_CALCULATOR_RULESET_VERSION_MISMATCH");
  assert.ok(ruleId);
}

async function createNegativeFixture(label: string, month: string, profile: PcbProfile | null, recurringCode: string | null) {
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: `VC1 negative ${label}`, slug: `vc1-negative-${label.toLowerCase()}-${token}`, timezone: "Asia/Kuala_Lumpur" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Negative", countryCode: "MY", stateCode: "SBH" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, email: `${label}-${token}@test.local`, name: "Negative Owner", role: "BUSINESS_OWNER" } });
  const phone = `+6019${token.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`;
  const account = await prisma.employeeAccount.create({ data: { name: label, phoneNumber: phone, phoneNormalized: phone } });
  const membership = await prisma.employeeBusinessMembership.create({ data: { businessId: business.id, employeeAccountId: account.id, employeeCode: label.slice(0, 10), fullName: label, joinedAt: new Date(`${month}-01T00:00:00.000Z`), payBasis: "MONTHLY", phoneNumber: phone, phoneNumberNormalized: phone, dateOfBirth: new Date("1990-01-01T00:00:00.000Z"), statutoryNationality: "MALAYSIAN", statutoryIdentityType: "NEW_IC", statutoryIdentityNumber: "900101125555", taxIdentificationNumber: "12345678901", statutoryProfileRevision: 1, taxProfileRevision: 1, pcbProfile: profile as unknown as Prisma.InputJsonValue } });
  await prisma.employeeLindung24ParticipationVersion.create({ data: { businessId: business.id, membershipId: membership.id, revision: 1, effectiveFromMonth: new Date("2026-01-01T00:00:00.000Z"), status: "DEFAULT_PARTICIPATING", employerContext: "SINGLE_EMPLOYER", selectedEmployer: "CURRENT_BUSINESS", act4Covered: false, officialSubmittedAt: null, sourceType: "OFFICIAL_TRANSITION", sourceReference: `VC1-NEGATIVE-NOT-COVERED-${label}`, reason: "Disposable PCB VC1 negative fixture outside LINDUNG 24 coverage.", sourceDigest: digest(`vc1-negative-lindung24-${label}`), recordedById: owner.id } });
  await prisma.employeeBranchAssignment.create({ data: { businessId: business.id, branchId: branch.id, membershipId: membership.id, isPrimary: true } });
  await prisma.employeeCompensationVersion.create({ data: { businessId: business.id, membershipId: membership.id, effectiveFromMonth: new Date(`${month}-01T00:00:00.000Z`), payBasis: "MONTHLY", baseRate: 5000, source: "MANUAL", reasonType: "DATA_MIGRATION", createdById: owner.id } });
  if (recurringCode) {
    const component = await prisma.employeeRecurringPayComponent.create({ data: { businessId: business.id, membershipId: membership.id, type: "EARNING", code: recurringCode, createdById: owner.id } });
    await prisma.employeeRecurringPayComponentVersion.create({ data: { businessId: business.id, membershipId: membership.id, componentId: component.id, revision: 1, effectiveFromMonth: new Date(`${month}-01T00:00:00.000Z`), name: recurringCode, amount: 100, source: "MANUAL", reasonType: "DATA_MIGRATION", createdById: owner.id } });
  }
  await createLockedTimesheet({ businessId: business.id, branchId: branch.id, ownerId: owner.id, month, memberships: [membership.id] });
  return { businessId: business.id, ownerId: owner.id, membershipId: membership.id, actor: { userId: owner.id, name: owner.name, email: owner.email! }, month };
}

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function assertDisposableDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  assert.match(url, /pcb_verification_vc1_disposable_/i, "VC1 E2E must run only in a disposable database.");
  assert.notEqual(process.env.TETAMU_PAYROLL_ENVIRONMENT, "PRODUCTION");
}
function restore(name: string, value: string | undefined) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
