import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  PayrollEntryComponentSourceType,
  PayrollEntryComponentType,
  Prisma,
  StatutoryComponentTreatment,
} from "@prisma/client";
import {
  deriveAndPersistEntryAggregates,
  getPayrollRunComponentReconciliationFailures,
} from "../../src/lib/payroll/component-service";
import { loadStatutorySubmissionData } from "../../src/lib/payroll/statutory-data";
import {
  activateStatutoryRule,
  recordStatutoryCalculationVerification,
  retireStatutoryRule,
  signOffStatutoryRule,
  statutoryRuleEvidenceDigest,
  type StatutoryHumanActor,
} from "../../src/lib/payroll/statutory-activation-service";
import { TRUE_MFA_CAPABILITY } from "../../src/lib/auth/sensitive-actions";
import type {
  NormalizedContributionDataset,
  RuleActivationEvidence,
} from "../../src/lib/payroll/statutory-artifact-pipeline";
import { materializeStatutoryP2 } from "../../src/lib/payroll/statutory-p2";
import {
  EPF_CALCULATOR_VERSION,
  STATUTORY_P2C_CALCULATOR_VERSION,
} from "../../src/lib/payroll/statutory-p2c";
import { prisma } from "../../src/lib/prisma";

const act4 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act4-lindung24-2026-06.json",
);
const act800 = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/perkeso-act800-2024-10.review.json",
);
const epfDataset = readJson<NormalizedContributionDataset>(
  "statutory/official/datasets/kwsp-third-schedule-2025-10.json",
);
const epfFixtures = readJson<{ fixtureDigest: string; fixtures: unknown[] }>(
  "statutory/official/fixtures/kwsp-third-schedule-2025-10-golden-v1.json",
);
const epfReview = readJson<{ reviewDigest: string }>(
  "statutory/official/reviews/kwsp-third-schedule-2025-10-independent-review.json",
);
const epfCandidate = readJson<EpfClosureReview>(
  "statutory/official/classifications/malaysia-epf-2025-10-signoff-candidate-v1.json",
);
const closure = readJson<ClosureReview>(
  "statutory/official/classifications/malaysia-socso-eis-2026-signoff-candidate-v1.json",
);
const socsoReview = readJson<{ reviewDigest: string }>(
  "statutory/official/reviews/perkeso-act4-2026-06-independent-review.json",
);
const eisReview = readJson<{ reviewDigest: string }>(
  "statutory/official/reviews/perkeso-act800-2024-10-independent-review.json",
);
const socsoFixtures = readJson<{ fixtureDigest: string; fixtures: unknown[] }>(
  "statutory/official/fixtures/perkeso-act4-2026-06-boundaries-review-v1.json",
);
const eisFixtures = readJson<{ fixtureDigest: string; fixtures: unknown[] }>(
  "statutory/official/fixtures/perkeso-act800-2024-10-boundaries-review-v1.json",
);

test("controlled SOCSO/EIS fixtures require real scoped MFA and do not activate", async () => {
  const fixture = await createFixture();
  const reviewerActor = humanActor(fixture.statutoryReviewer.id, "SIGN_OFF_STATUTORY_RULESET");
  const activatorActor = humanActor(fixture.statutoryActivator.id, "ACTIVATE_STATUTORY_RULESET");
  const actor = { id: fixture.statutoryActivator.id, role: "PLATFORM_ADMIN" };
  const activatedRuleIds: string[] = [];
  try {
    if (TRUE_MFA_CAPABILITY.status === "READY") {
      await assert.rejects(
        createAndActivateRule({
          reviewerActor,
          activatorActor,
          scheme: "SOCSO",
          dataset: act4,
          reviewDigest: socsoReview.reviewDigest,
          fixtureDigest: socsoFixtures.fixtureDigest,
          fixtureCount: socsoFixtures.fixtures.length,
          calculatorTestDigest: "acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3",
        }),
        /MFA_REQUIRED/,
      );
      await assert.rejects(
        createAndActivateRule({
          reviewerActor,
          activatorActor,
          scheme: "EIS",
          dataset: act800,
          reviewDigest: eisReview.reviewDigest,
          fixtureDigest: eisFixtures.fixtureDigest,
          fixtureCount: eisFixtures.fixtures.length,
          calculatorTestDigest: "3dbed2c04746e0863d00473f8a281cee401cda574fb19d4882fa07c689742c9b",
        }),
        /MFA_REQUIRED/,
      );
      assert.deepEqual(activatedRuleIds, []);
      return;
    }
    activatedRuleIds.push(
      await createAndActivateRule({
        reviewerActor,
        activatorActor,
        scheme: "SOCSO",
        dataset: act4,
        reviewDigest: socsoReview.reviewDigest,
        fixtureDigest: socsoFixtures.fixtureDigest,
        fixtureCount: socsoFixtures.fixtures.length,
        calculatorTestDigest: "acd13f53032c299fee02ee5a9e9b11bae87d8ac5ce0a313fce05655ea79a53b3",
      }),
      await createAndActivateRule({
        reviewerActor,
        activatorActor,
        scheme: "EIS",
        dataset: act800,
        reviewDigest: eisReview.reviewDigest,
        fixtureDigest: eisFixtures.fixtureDigest,
        fixtureCount: eisFixtures.fixtures.length,
        calculatorTestDigest: "3dbed2c04746e0863d00473f8a281cee401cda574fb19d4882fa07c689742c9b",
      }),
    );

    const cases: DryRunCase[] = [
      { key: "MONTHLY", payBasis: "MONTHLY", lines: [earning("BASIC_SALARY", "BASIC_SALARY", 300_000)] },
      {
        key: "RECURRING",
        payBasis: "MONTHLY",
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          earning("MEAL_ALLOWANCE", "RECURRING_PAY", 20_000),
        ],
      },
      { key: "DAILY_BELOW", payBasis: "DAILY", lines: [earning("REGULAR_DAILY_PAY", "ATTENDANCE", 299_999)] },
      { key: "BOUNDARY", payBasis: "MONTHLY", lines: [earning("BASIC_SALARY", "BASIC_SALARY", 300_000)] },
      { key: "HOURLY_ABOVE", payBasis: "HOURLY", lines: [earning("REGULAR_HOURLY_PAY", "ATTENDANCE", 300_001)] },
      { key: "ABOVE_CEILING", payBasis: "MONTHLY", lines: [earning("BASIC_SALARY", "BASIC_SALARY", 600_001)] },
      {
        key: "EXCLUDED",
        payBasis: "MONTHLY",
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          deduction("STAFF_LOAN", "RECURRING_PAY", 10_000),
        ],
      },
      {
        key: "TRANSPORT_UNKNOWN",
        payBasis: "MONTHLY",
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          earning("TRANSPORT_ALLOWANCE", "RECURRING_PAY", 30_000),
        ],
      },
      {
        key: "UNKNOWN",
        payBasis: "MONTHLY",
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          manualUnknown(10_000),
        ],
      },
      {
        key: "EIS_INELIGIBLE",
        payBasis: "MONTHLY",
        nationality: "NON_MALAYSIAN",
        lines: [earning("BASIC_SALARY", "BASIC_SALARY", 300_000)],
      },
    ];
    const entries: Array<Awaited<ReturnType<typeof createDryRunEntry>>> = [];
    for (const item of cases) entries.push(await createDryRunEntry(fixture, item));

    await prisma.$transaction(async (transaction) => {
      const preloadedRules = await transaction.statutoryRuleSet.findMany({
        where: {
          id: { in: activatedRuleIds },
          status: "ACTIVE",
        },
        include: { classifications: true },
        orderBy: { scheme: "asc" },
      });
      assert.equal(preloadedRules.length, 2);
      for (const item of entries) {
        await materializeStatutoryP2(transaction, {
          businessId: fixture.business.id,
          payrollRunId: fixture.run.id,
          payrollEntryId: item.entry.id,
          membershipId: item.membership.id,
          statutoryPeriod: fixture.run.periodStart,
          actorUserId: fixture.owner.id,
          preloadedRules,
          profile: profileFor(item.membership),
        });
        const current = await transaction.payrollEntry.findUniqueOrThrow({ where: { id: item.entry.id } });
        await deriveAndPersistEntryAggregates(transaction, current, current.calculationRevision);
      }
      const reconciliationFailures = await getPayrollRunComponentReconciliationFailures(transaction, {
        businessId: fixture.business.id,
        runId: fixture.run.id,
      });
      assert.deepEqual(reconciliationFailures, [], `reconciliation failures: ${reconciliationFailures.join(",")}`);
    });

    const monthly = await loadEntry(entries.find((item) => item.key === "MONTHLY")!.entry.id);
    assert.equal(monthly.statutoryStatus, "AUTO_CALCULATED");
    assert.equal(monthly.perkesoWageBase.toFixed(2), "3000.00");
    assert.equal(monthly.socsoEmployee.toFixed(2), "14.75");
    assert.equal(monthly.employerSocso.toFixed(2), "51.65");
    assert.equal(monthly.eisEmployee.toFixed(2), "5.90");
    assert.equal(monthly.employerEis.toFixed(2), "5.90");
    assert.equal(monthly.grossPay.toFixed(2), "3000.00");
    assert.equal(monthly.netPay.toFixed(2), "2979.35");
    assert.deepEqual(
      monthly.components.filter((line) => line.sourceType === "STATUTORY").map((line) => line.code).sort(),
      ["EIS_EMPLOYEE", "SOCSO_EMPLOYEE"],
    );
    assert.ok(monthly.statutorySnapshots.every((snapshot) =>
      snapshot.status !== "CALCULATED" || (
        snapshot.artifactDigestSnapshot &&
        snapshot.datasetDigestSnapshot &&
        snapshot.fixtureDigestSnapshot &&
        snapshot.classificationVersionSnapshot === `TEST_SIGNED:${closure.version}` &&
        snapshot.calculatorVersionSnapshot === STATUTORY_P2C_CALCULATOR_VERSION &&
        snapshot.matchedRuleKey &&
        snapshot.calculationInputDigest
      ),
    ));

    const below = await loadEntry(entries.find((item) => item.key === "DAILY_BELOW")!.entry.id);
    const exact = await loadEntry(entries.find((item) => item.key === "BOUNDARY")!.entry.id);
    const above = await loadEntry(entries.find((item) => item.key === "HOURLY_ABOVE")!.entry.id);
    assert.equal(snapshot(below, "SOCSO").matchedRuleKey, "ACT4-34");
    assert.equal(snapshot(exact, "SOCSO").matchedRuleKey, "ACT4-34");
    assert.equal(snapshot(above, "SOCSO").matchedRuleKey, "ACT4-35");
    assert.equal(snapshot(below, "EIS").matchedRuleKey, "ACT800-34");
    assert.equal(snapshot(exact, "EIS").matchedRuleKey, "ACT800-34");
    assert.equal(snapshot(above, "EIS").matchedRuleKey, "ACT800-35");

    const ceiling = await loadEntry(entries.find((item) => item.key === "ABOVE_CEILING")!.entry.id);
    assert.equal(snapshot(ceiling, "SOCSO").matchedRuleKey, "ACT4-65");
    assert.equal(snapshot(ceiling, "EIS").matchedRuleKey, "ACT800-65");
    assert.equal(ceiling.socsoEmployee.toFixed(2), "29.75");
    assert.equal(ceiling.eisEmployee.toFixed(2), "11.90");

    const excluded = await loadEntry(entries.find((item) => item.key === "EXCLUDED")!.entry.id);
    assert.equal(excluded.grossPay.toFixed(2), "3000.00");
    assert.equal(excluded.perkesoWageBase.toFixed(2), "3000.00");
    assert.equal(excluded.netPay.toFixed(2), "2879.35");
    assert.ok(excluded.components.some((item) =>
      item.code === "STAFF_LOAN" &&
      item.statutoryTreatments.some((treatment) =>
        treatment.scheme === "SOCSO" && treatment.treatment === "EXCLUDED",
      ),
    ));

    const transportUnknown = await loadEntry(
      entries.find((item) => item.key === "TRANSPORT_UNKNOWN")!.entry.id,
    );
    assert.equal(transportUnknown.statutoryStatus, "REVIEW_REQUIRED");
    assert.match(
      transportUnknown.statutoryWarning ?? "",
      /SOCSO:STATUTORY_CLASSIFICATION_REQUIRED/,
    );
    assert.match(
      transportUnknown.statutoryWarning ?? "",
      /EIS:STATUTORY_CLASSIFICATION_REQUIRED/,
    );
    assert.equal(
      transportUnknown.components.filter((line) => line.sourceType === "STATUTORY").length,
      0,
    );

    const unknown = await loadEntry(entries.find((item) => item.key === "UNKNOWN")!.entry.id);
    assert.equal(unknown.statutoryStatus, "REVIEW_REQUIRED");
    assert.match(unknown.statutoryWarning ?? "", /SOCSO:STATUTORY_CLASSIFICATION_REQUIRED/);
    assert.match(unknown.statutoryWarning ?? "", /EIS:STATUTORY_CLASSIFICATION_REQUIRED/);
    assert.equal(unknown.components.filter((line) => line.sourceType === "STATUTORY").length, 0);

    const ineligible = await loadEntry(entries.find((item) => item.key === "EIS_INELIGIBLE")!.entry.id);
    assert.equal(snapshot(ineligible, "EIS").status, "NOT_APPLICABLE");
    assert.equal(snapshot(ineligible, "EIS").blockerCode, null);
    assert.equal(snapshot(ineligible, "SOCSO").status, "CALCULATED");

    const beforeDigest = snapshot(monthly, "SOCSO").sourceDigest;
    const beforeRevision = monthly.calculationRevision;
    await prisma.$transaction(async (transaction) => {
      const preloadedRules = await transaction.statutoryRuleSet.findMany({
        where: { id: { in: activatedRuleIds }, status: "ACTIVE" },
        include: { classifications: true },
      });
      await materializeStatutoryP2(transaction, {
        businessId: fixture.business.id,
        payrollRunId: fixture.run.id,
        payrollEntryId: monthly.id,
        membershipId: monthly.membershipId,
        statutoryPeriod: fixture.run.periodStart,
        actorUserId: fixture.owner.id,
        preloadedRules,
        profile: profileFor(entries.find((item) => item.key === "MONTHLY")!.membership),
      });
      const current = await transaction.payrollEntry.findUniqueOrThrow({ where: { id: monthly.id } });
      await deriveAndPersistEntryAggregates(transaction, current, current.calculationRevision);
    });
    const recalculated = await loadEntry(monthly.id);
    assert.equal(recalculated.calculationRevision, beforeRevision + 1);
    assert.equal(snapshot(recalculated, "SOCSO").sourceDigest, beforeDigest);
    assert.equal(recalculated.components.filter((line) => line.code === "SOCSO_EMPLOYEE").length, 1);
    assert.equal(recalculated.components.filter((line) => line.code === "EIS_EMPLOYEE").length, 1);

    const report = await loadStatutorySubmissionData(fixture.business.id, "2099-08");
    assert.notEqual(report.statutoryTotals.socsoEmployee, "0.00");
    assert.notEqual(report.statutoryTotals.socsoEmployer, "0.00");
    assert.notEqual(report.statutoryTotals.eisEmployee, "0.00");
    assert.notEqual(report.statutoryTotals.eisEmployer, "0.00");

    const audits = await prisma.statutoryRuleLifecycleAudit.findMany({
      where: { ruleSetId: { in: activatedRuleIds } },
    });
    assert.equal(audits.filter((item) => item.action === "CALCULATION_VERIFIED").length, 2);
    assert.equal(audits.filter((item) => item.action === "ACTIVATED").length, 2);
  } finally {
    for (const ruleSetId of activatedRuleIds) {
      const rule = await prisma.statutoryRuleSet.findUnique({ where: { id: ruleSetId } });
      if (rule?.status === "ACTIVE") {
        await retireStatutoryRule({
          ruleSetId,
          actor,
          reason: "Retire isolated integration-fixture activation after closure dry run",
        });
      }
    }
  }
});

test("controlled EPF fixture requires real scoped MFA and does not activate", async () => {
  const fixture = await createFixture();
  const reviewerActor = humanActor(fixture.statutoryReviewer.id, "SIGN_OFF_STATUTORY_RULESET");
  const activatorActor = humanActor(fixture.statutoryActivator.id, "ACTIVATE_STATUTORY_RULESET");
  const actor = { id: fixture.statutoryActivator.id, role: "PLATFORM_ADMIN" };
  let ruleSetId: string | null = null;
  try {
    if (TRUE_MFA_CAPABILITY.status === "READY") {
      await assert.rejects(
        createAndActivateEpfRule({ reviewerActor, activatorActor }),
        /MFA_REQUIRED/,
      );
      assert.equal(ruleSetId, null);
      return;
    }
    ruleSetId = await createAndActivateEpfRule({ reviewerActor, activatorActor });
    const cases: DryRunCase[] = [
      {
        key: "EPF_MONTHLY",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [earning("BASIC_SALARY", "BASIC_SALARY", 300_000)],
      },
      {
        key: "EPF_ALLOWANCE",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          earning("MEAL_ALLOWANCE", "RECURRING_PAY", 20_000),
        ],
      },
      {
        key: "EPF_DAILY",
        payBasis: "DAILY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [earning("REGULAR_DAILY_PAY", "ATTENDANCE", 299_999)],
      },
      {
        key: "EPF_HOURLY",
        payBasis: "HOURLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [earning("REGULAR_HOURLY_PAY", "ATTENDANCE", 300_001)],
      },
      {
        key: "EPF_COMMISSION",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          earning("COMMISSION", "VARIABLE_PAY", 50_000),
        ],
      },
      {
        key: "EPF_BOUNDARY",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [earning("BASIC_SALARY", "BASIC_SALARY", 500_000)],
      },
      {
        key: "EPF_HIGH",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [earning("BASIC_SALARY", "BASIC_SALARY", 2_000_001)],
      },
      {
        key: "EPF_UNKNOWN",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        lines: [
          earning("BASIC_SALARY", "BASIC_SALARY", 300_000),
          manualUnknown(10_000),
        ],
      },
      {
        key: "EPF_PROFILE_MISSING",
        payBasis: "MONTHLY",
        epfEnabled: true,
        socsoEnabled: false,
        eisEnabled: false,
        dateOfBirth: null,
        lines: [earning("BASIC_SALARY", "BASIC_SALARY", 300_000)],
      },
    ];
    const entries = [];
    for (const dryRunCase of cases) entries.push(await createDryRunEntry(fixture, dryRunCase));

    const preloadedRules = await prisma.statutoryRuleSet.findMany({
      where: { id: ruleSetId },
      include: { classifications: true },
    });
    for (const item of entries) {
      await prisma.$transaction(async (transaction) => {
        await materializeStatutoryP2(transaction, {
          businessId: fixture.business.id,
          payrollRunId: fixture.run.id,
          payrollEntryId: item.entry.id,
          membershipId: item.membership.id,
          statutoryPeriod: fixture.run.periodStart,
          actorUserId: fixture.owner.id,
          preloadedRules,
          profile: profileFor(item.membership),
        });
        const current = await transaction.payrollEntry.findUniqueOrThrow({
          where: { id: item.entry.id },
        });
        await deriveAndPersistEntryAggregates(transaction, current, current.calculationRevision);
      });
    }

    const expected = new Map([
      ["EPF_MONTHLY", { employee: 33_000, employer: 39_000 }],
      ["EPF_ALLOWANCE", { employee: 35_200, employer: 41_600 }],
      ["EPF_DAILY", { employee: 33_000, employer: 39_000 }],
      ["EPF_HOURLY", { employee: 33_300, employer: 39_300 }],
      ["EPF_COMMISSION", { employee: 38_500, employer: 45_500 }],
      ["EPF_BOUNDARY", { employee: 55_000, employer: 65_000 }],
      ["EPF_HIGH", { employee: 220_100, employer: 240_100 }],
    ]);
    for (const item of entries) {
      const loaded = await loadEntry(item.entry.id);
      const epfSnapshot = loaded.statutorySnapshots.find((snapshot) => snapshot.scheme === "EPF");
      assert.ok(epfSnapshot);
      const amounts = expected.get(item.key);
      if (amounts) {
        assert.equal(epfSnapshot.status, "CALCULATED");
        assert.equal(Number(loaded.epfEmployee), amounts.employee / 100);
        assert.equal(Number(loaded.employerEpf), amounts.employer / 100);
        assert.equal(Number(loaded.epfWageBase), Number(item.entry.grossPay));
        assert.equal(loaded.components.filter((line) => line.code === "EPF_EMPLOYEE").length, 1);
        assert.match(epfSnapshot.artifactDigestSnapshot ?? "", /^[a-f0-9]{64}$/);
        assert.match(epfSnapshot.datasetDigestSnapshot ?? "", /^[a-f0-9]{64}$/);
        assert.match(epfSnapshot.fixtureDigestSnapshot ?? "", /^[a-f0-9]{64}$/);
        assert.equal(
          Number(loaded.netPay),
          Number(item.entry.grossPay) - Number(item.entry.otherDeductions) - amounts.employee / 100,
        );
      } else if (item.key === "EPF_UNKNOWN") {
        assert.equal(epfSnapshot.status, "BLOCKED");
        assert.equal(epfSnapshot.blockerCode, "STATUTORY_CLASSIFICATION_REQUIRED");
        assert.equal(loaded.components.some((line) => line.code === "EPF_EMPLOYEE"), false);
      } else {
        assert.equal(epfSnapshot.status, "BLOCKED");
        assert.equal(epfSnapshot.blockerCode, "STATUTORY_PROFILE_INCOMPLETE");
        assert.equal(loaded.components.some((line) => line.code === "EPF_EMPLOYEE"), false);
      }
    }

    const monthly = entries.find((item) => item.key === "EPF_MONTHLY")!;
    const before = await loadEntry(monthly.entry.id);
    const beforeDigest = before.statutorySnapshots.find((item) => item.scheme === "EPF")!.sourceDigest;
    await prisma.$transaction(async (transaction) => {
      await materializeStatutoryP2(transaction, {
        businessId: fixture.business.id,
        payrollRunId: fixture.run.id,
        payrollEntryId: monthly.entry.id,
        membershipId: monthly.membership.id,
        statutoryPeriod: fixture.run.periodStart,
        actorUserId: fixture.owner.id,
        preloadedRules,
        profile: profileFor(monthly.membership),
      });
      const current = await transaction.payrollEntry.findUniqueOrThrow({
        where: { id: monthly.entry.id },
      });
      await deriveAndPersistEntryAggregates(transaction, current, current.calculationRevision);
    });
    const recalculated = await loadEntry(monthly.entry.id);
    assert.equal(
      recalculated.statutorySnapshots.find((item) => item.scheme === "EPF")!.sourceDigest,
      beforeDigest,
    );
    assert.equal(recalculated.components.filter((line) => line.code === "EPF_EMPLOYEE").length, 1);

    const report = await loadStatutorySubmissionData(fixture.business.id, "2099-08");
    assert.notEqual(report.statutoryTotals.epfEmployee, "0.00");
    assert.notEqual(report.statutoryTotals.epfEmployer, "0.00");
  } finally {
    if (ruleSetId) {
      const rule = await prisma.statutoryRuleSet.findUnique({ where: { id: ruleSetId } });
      if (rule?.status === "ACTIVE") {
        await retireStatutoryRule({
          ruleSetId,
          actor,
          reason: "Retire isolated EPF integration-fixture activation after dry run",
        });
      }
    }
    assert.equal(
      await prisma.statutoryRuleSet.count({ where: { scheme: "EPF", status: "ACTIVE" } }),
      0,
    );
  }
});

async function createAndActivateEpfRule(input: {
  reviewerActor: StatutoryHumanActor;
  activatorActor: StatutoryHumanActor;
}) {
  const id = randomUUID();
  const version = `TEST_CLOSURE_EPF_${id.slice(0, 8)}`;
  const effectiveFrom = "2099-01-01";
  await prisma.statutoryRuleSet.create({
    data: {
      id,
      scheme: "EPF",
      version,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      authority: "KWSP",
      sourceReference: "Retained official Third Schedule; isolated integration fixture",
      sourceDocumentName: epfDataset.artifactId,
      ruleData: epfDataset as unknown as Prisma.InputJsonValue,
      classifications: {
        create: epfCandidate.classifications.filter((item) => item.EPF !== "UNKNOWN").map((item) => ({
          scheme: "EPF",
          componentCode: item.componentCode,
          sourceType: item.sourceType as PayrollEntryComponentSourceType,
          treatment: item.EPF as StatutoryComponentTreatment,
          rationale: item.notes.slice(0, 500),
          authorityRef: item.officialBasis.join(",").slice(0, 500),
        })),
      },
    },
  });
  const evidence: RuleActivationEvidence = {
    scheme: "EPF",
    ruleVersion: version,
    effectiveFrom,
    effectiveTo: null,
    artifactStatus: "VERIFIED",
    datasetStatus: "VERIFIED",
    independentReviewStatus: "PASS",
    fixtureStatus: "VERIFIED",
    classificationStatus: "VERIFIED",
    classificationApprovalStatus: "READY_FOR_HUMAN_SIGN_OFF",
    classificationApprovalRecordDigest: null,
    classificationApprovedByActorId: null,
    classificationApprovedAt: null,
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256: epfDataset.artifactSha256,
    datasetDigest: epfDataset.datasetDigest,
    independentReviewDigest: epfReview.reviewDigest,
    fixtureDigest: epfFixtures.fixtureDigest,
    classificationVersion: `TEST_SIGNED:${epfCandidate.version}`,
    classificationDigest: epfCandidate.classificationDigest,
    parserName: epfDataset.parserName,
    parserVersion: epfDataset.parserVersion,
    calculatorVersion: EPF_CALCULATOR_VERSION,
    calculatorTestDigest: "7130f1f87b1a6879d50186a1c09456a3e9d1be9d0da4a81e52e886152151fa14",
    datasetRowCount: epfDataset.rows.length,
    goldenFixtureCount: epfFixtures.fixtures.length,
    unresolvedBlockers: [],
  };
  await recordStatutoryCalculationVerification({
    ruleSetId: id,
    actor: input.reviewerActor,
    reason: "Test-only verified EPF closure evidence",
    evidence,
  });
  await prisma.statutoryRuleSet.update({
    where: { id },
    data: {
      humanReviewStatus: "COMPLETED",
      humanClassificationDigest: evidence.classificationDigest,
    },
  });
  const digestRule = await prisma.statutoryRuleSet.findUniqueOrThrow({ where: { id }, include: { classifications: true } });
  const evidenceDigest = statutoryRuleEvidenceDigest(digestRule);
  const signOff = await withBlockedRuleCleanup(id, () =>
    signOffStatutoryRule({
      ruleSetId: id,
      actor: input.reviewerActor,
      reason: "Dedicated QA reviewer approved isolated EPF fixture evidence",
      expectedEvidenceDigest: evidenceDigest,
    }),
  );
  await activateStatutoryRule({
    ruleSetId: id,
    actor: input.activatorActor,
    reason: "Explicit isolated EPF integration-fixture activation dry run",
    expectedScheme: "EPF",
    expectedRuleVersion: version,
    expectedEffectiveFrom: effectiveFrom,
    expectedEvidenceDigest: evidenceDigest,
    evidence: { ...evidence, classificationApprovalStatus: "HUMAN_SIGNED_OFF", classificationApprovalRecordDigest: evidenceDigest, classificationApprovedByActorId: input.reviewerActor.id, classificationApprovedAt: signOff.signOff.signedAt.toISOString(), unresolvedBlockers: [] },
  });
  return id;
}

async function createAndActivateRule(input: {
  reviewerActor: StatutoryHumanActor;
  activatorActor: StatutoryHumanActor;
  scheme: "SOCSO" | "EIS";
  dataset: NormalizedContributionDataset;
  reviewDigest: string;
  fixtureDigest: string;
  fixtureCount: number;
  calculatorTestDigest: string;
}) {
  const id = randomUUID();
  const version = `TEST_CLOSURE_${input.scheme}_${id.slice(0, 8)}`;
  const effectiveFrom = "2099-01-01";
  await prisma.statutoryRuleSet.create({
    data: {
      id,
      scheme: input.scheme,
      version,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      authority: "PERKESO",
      sourceReference: "Official retained dataset; isolated integration fixture",
      sourceDocumentName: input.dataset.artifactId,
      ruleData: input.dataset as unknown as Prisma.InputJsonValue,
      classifications: {
        create: closure.classifications.filter((item) => item[input.scheme] !== "UNKNOWN").map((item) => ({
          scheme: input.scheme,
          componentCode: item.componentCode,
          sourceType: item.sourceType as PayrollEntryComponentSourceType | null,
          treatment: item[input.scheme] as StatutoryComponentTreatment,
          rationale: item.notes.slice(0, 500),
          authorityRef: item.officialBasis.join(",").slice(0, 500),
        })),
      },
    },
  });
  const evidence: RuleActivationEvidence = {
    scheme: input.scheme,
    ruleVersion: version,
    effectiveFrom,
    effectiveTo: null,
    artifactStatus: "VERIFIED",
    datasetStatus: "VERIFIED",
    independentReviewStatus: "PASS",
    fixtureStatus: "VERIFIED",
    classificationStatus: "VERIFIED",
    classificationApprovalStatus: "READY_FOR_HUMAN_SIGN_OFF",
    classificationApprovalRecordDigest: null,
    classificationApprovedByActorId: null,
    classificationApprovedAt: null,
    calculatorStatus: "VERIFIED",
    boundaryTestStatus: "PASS",
    artifactSha256: input.dataset.artifactSha256,
    datasetDigest: input.dataset.datasetDigest,
    independentReviewDigest: input.reviewDigest,
    fixtureDigest: input.fixtureDigest,
    classificationVersion: `TEST_SIGNED:${closure.version}`,
    classificationDigest: closure.classificationDigest,
    parserName: input.dataset.parserName,
    parserVersion: input.dataset.parserVersion,
    calculatorVersion: STATUTORY_P2C_CALCULATOR_VERSION,
    calculatorTestDigest: input.calculatorTestDigest,
    datasetRowCount: input.dataset.rows.length,
    goldenFixtureCount: input.fixtureCount,
    unresolvedBlockers: [],
  };
  await recordStatutoryCalculationVerification({
    ruleSetId: id,
    actor: input.reviewerActor,
    reason: "Test-only verified SOCSO/EIS closure evidence",
    evidence,
  });
  await prisma.statutoryRuleSet.update({
    where: { id },
    data: {
      humanReviewStatus: "COMPLETED",
      humanClassificationDigest: evidence.classificationDigest,
    },
  });
  const digestRule = await prisma.statutoryRuleSet.findUniqueOrThrow({ where: { id }, include: { classifications: true } });
  const evidenceDigest = statutoryRuleEvidenceDigest(digestRule);
  const signOff = await withBlockedRuleCleanup(id, () =>
    signOffStatutoryRule({
      ruleSetId: id,
      actor: input.reviewerActor,
      reason: "Dedicated QA reviewer approved isolated SOCSO/EIS fixture evidence",
      expectedEvidenceDigest: evidenceDigest,
    }),
  );
  await activateStatutoryRule({
    ruleSetId: id,
    actor: input.activatorActor,
    reason: "Explicit isolated integration-fixture activation dry run",
    expectedScheme: input.scheme,
    expectedRuleVersion: version,
    expectedEffectiveFrom: effectiveFrom,
    expectedEvidenceDigest: evidenceDigest,
    evidence: { ...evidence, classificationApprovalStatus: "HUMAN_SIGNED_OFF", classificationApprovalRecordDigest: evidenceDigest, classificationApprovedByActorId: input.reviewerActor.id, classificationApprovedAt: signOff.signOff.signedAt.toISOString(), unresolvedBlockers: [] },
  });
  return id;
}

async function withBlockedRuleCleanup<T>(
  ruleSetId: string,
  operation: () => Promise<T>,
) {
  try {
    return await operation();
  } catch (error) {
    await prisma.statutoryRuleSet.update({
      where: { id: ruleSetId },
      data: { authority: "TEST_ONLY", status: "RETIRED" },
    });
    await prisma.$transaction([
      prisma.statutoryComponentReviewDecision.deleteMany({ where: { ruleSetId } }),
      prisma.statutoryComponentClassification.deleteMany({ where: { ruleSetId } }),
      prisma.statutoryRuleLifecycleAudit.deleteMany({ where: { ruleSetId } }),
      prisma.statutoryRuleSetSignOff.deleteMany({ where: { ruleSetId } }),
      prisma.statutoryRuleSet.deleteMany({ where: { id: ruleSetId } }),
    ]);
    throw error;
  }
}

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Statutory Closure ${token}`, slug: `statutory-closure-${token}` },
  });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const owner = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `statutory-closure-${token}@test.local`,
      name: "Test Platform Actor",
      role: "BUSINESS_OWNER",
    },
  });
  const approver = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `statutory-closure-approver-${token}@test.local`,
      name: "Independent Test Approver",
      role: "STAFF",
    },
  });
  const statutoryReviewer = await prisma.user.create({ data: { email: `statutory-human-reviewer-${token}@test.local`, name: "Statutory Reviewer QA", role: "PLATFORM_ADMIN", permissions: ["SIGN_OFF_STATUTORY_RULESET"] } });
  const statutoryActivator = await prisma.user.create({ data: { email: `statutory-human-activator-${token}@test.local`, name: "Statutory Activator QA", role: "PLATFORM_ADMIN", permissions: ["ACTIVATE_STATUTORY_RULESET"] } });
  const periodStart = new Date("2099-08-01T00:00:00.000Z");
  const periodEnd = new Date("2099-09-01T00:00:00.000Z");
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({
    data: { businessId: business.id, periodStart },
  });
  const timesheetRevision = await prisma.attendanceTimesheetRevision.create({
    data: {
      businessId: business.id,
      timesheetId: timesheet.id,
      periodStart,
      revision: 1,
      sourceDigest: "9".repeat(64),
      reason: "Statutory closure integration dry run",
      lockedById: owner.id,
    },
  });
  await prisma.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: timesheetRevision.id, status: "LOCKED" },
  });
  const run = await prisma.payrollRun.create({
    data: {
      businessId: business.id,
      periodStart,
      periodEnd,
      attendanceSource: "LOCKED_TIMESHEET_REVISION",
      attendanceTimesheetRevisionId: timesheetRevision.id,
      attendanceTimesheetRevisionSnapshot: timesheetRevision.revision,
      attendanceTimesheetDigestSnapshot: timesheetRevision.sourceDigest,
      attendanceTimesheetLockedAtSnapshot: timesheetRevision.lockedAt,
      workingDaysPerMonthSnapshot: 26,
      normalWorkMinutesPerDaySnapshot: 480,
      breakMinutesPerDaySnapshot: 60,
      overtimeMultiplierSnapshot: "1.50",
      publicHolidayExtraMultiplierSnapshot: "2.00",
      createdById: owner.id,
    },
  });
  return { business, branch, owner, approver, statutoryReviewer, statutoryActivator, run, timesheet, timesheetRevision, token };
}

function humanActor(id: string, capability: "SIGN_OFF_STATUTORY_RULESET" | "ACTIVATE_STATUTORY_RULESET"): StatutoryHumanActor {
  return { id, role: "PLATFORM_ADMIN", actorType: "HUMAN_USER", capabilities: [capability] };
}

async function createDryRunEntry(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: DryRunCase,
) {
  const suffix = `${input.key}-${randomUUID()}`;
  const phone = `+609${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await prisma.employeeAccount.create({
    data: { name: input.key, phoneNormalized: phone, phoneNumber: phone },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: fixture.business.id,
      employeeAccountId: account.id,
      employeeCode: suffix.slice(0, 30),
      fullName: `Dry Run ${input.key}`,
      joinedAt: new Date("2090-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      dateOfBirth:
        input.dateOfBirth === undefined
          ? new Date("2060-01-01T00:00:00.000Z")
          : input.dateOfBirth,
      statutoryNationality: input.nationality ?? "MALAYSIAN",
      epfEnabled: input.epfEnabled ?? false,
      epfMemberBeforeAug1998: input.epfMemberBeforeAug1998 ?? false,
      socsoEnabled: input.socsoEnabled ?? true,
      socsoCategory: input.socsoEnabled === false ? null : "FIRST",
      eisEnabled: input.eisEnabled ?? true,
      eisPreviouslyContributed: input.eisEnabled === false ? false : true,
      statutoryProfileRevision: 1,
    },
  });
  await prisma.employeeLindung24ParticipationVersion.create({
    data: {
      act4Covered: false,
      businessId: fixture.business.id,
      effectiveFromMonth: new Date("2026-06-01T00:00:00.000Z"),
      employerContext: "SINGLE_EMPLOYER",
      membershipId: membership.id,
      reason: "SOCSO/EIS fixture is explicitly outside LINDUNG24 Act 4 coverage.",
      recordedById: fixture.owner.id,
      revision: 1,
      selectedEmployer: "CURRENT_BUSINESS",
      sourceDigest: "f".repeat(64),
      sourceReference: "INTEGRATION_FIXTURE_NOT_ACT4_COVERED",
      sourceType: "OFFICIAL_TRANSITION",
      status: "DEFAULT_PARTICIPATING",
    },
  });
  return prisma.$transaction(async (transaction) => {
  const compensation = await transaction.employeeCompensationVersion.create({
    data: {
      businessId: fixture.business.id,
      membershipId: membership.id,
      effectiveFromMonth: fixture.run.periodStart,
      payBasis: input.payBasis,
      baseRate: centsToMoney(input.lines.reduce((total, line) => total + line.amountCents, 0)),
      source: "SYSTEM",
      reasonType: "OTHER",
      reasonNote: "Statutory closure integration dry run",
      createdById: fixture.owner.id,
    },
  });
  const grossCents = input.lines.reduce(
    (total, line) => total + (line.type === "EARNING" ? line.amountCents : 0),
    0,
  );
  const deductionCents = input.lines.reduce(
    (total, line) => total + (line.type === "DEDUCTION" ? line.amountCents : 0),
    0,
  );
  const allowanceCents = input.lines.reduce(
    (total, line) => total + (
      line.type === "EARNING" &&
      (line.sourceType === "RECURRING_PAY" || line.sourceType === "MANUAL_ADJUSTMENT")
        ? line.amountCents
        : 0
    ),
    0,
  );
  const recurringEarningCents = input.lines.reduce(
    (total, line) => total + (
      line.type === "EARNING" && line.sourceType === "RECURRING_PAY" ? line.amountCents : 0
    ),
    0,
  );
  const recurringDeductionCents = input.lines.reduce(
    (total, line) => total + (
      line.type === "DEDUCTION" && line.sourceType === "RECURRING_PAY" ? line.amountCents : 0
    ),
    0,
  );
  const entry = await transaction.payrollEntry.create({
    data: {
      payrollRunId: fixture.run.id,
      businessId: fixture.business.id,
      membershipId: membership.id,
      compensationVersionId: compensation.id,
      compensationEffectiveFromMonthSnapshot: compensation.effectiveFromMonth,
      compensationSourceSnapshot: compensation.source,
      employeeCodeSnapshot: membership.employeeCode,
      fullNameSnapshot: membership.fullName,
      payBasisSnapshot: input.payBasis,
      baseRateSnapshot: centsToMoney(input.lines.reduce((total, line) => total + line.amountCents, 0)),
      workingDaysSnapshot: 26,
      normalWorkMinutesSnapshot: 480,
      allowances: centsToMoney(allowanceCents),
      otherDeductions: centsToMoney(deductionCents),
      recurringAllowancesSnapshot: centsToMoney(recurringEarningCents),
      recurringDeductionsSnapshot: centsToMoney(recurringDeductionCents),
      grossPay: centsToMoney(grossCents),
      netPay: centsToMoney(grossCents - deductionCents),
    },
  });
  const attendanceSnapshot = input.lines.some((line) => line.sourceType === "ATTENDANCE")
    ? await transaction.payrollAttendanceInputSnapshot.create({
        data: {
          businessId: fixture.business.id,
          payrollRunId: fixture.run.id,
          payrollEntryId: entry.id,
          membershipId: membership.id,
          timesheetId: fixture.timesheet.id,
          timesheetRevisionId: fixture.timesheetRevision.id,
          timesheetRevision: fixture.timesheetRevision.revision,
          timesheetSourceDigest: fixture.timesheetRevision.sourceDigest,
          timesheetLockedAt: fixture.timesheetRevision.lockedAt,
          periodStart: fixture.run.periodStart,
          periodEnd: fixture.run.periodEnd,
          sourceDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        },
      })
    : null;
  const preparedLines: Array<Prisma.PayrollEntryComponentCreateManyInput> = [];
  for (const [index, line] of input.lines.entries()) {
    let sourceId: string | null = null;
    let sourceVersionId: string | null = null;
    let sourceRevision: number | null = null;
    let effectiveFromMonth: Date | null = null;
    let frozenLineKey: string | null = null;
    let frozenSourceReason: string | null = null;
    if (line.sourceType === "BASIC_SALARY") {
      sourceVersionId = compensation.id;
      effectiveFromMonth = compensation.effectiveFromMonth;
    } else if (line.sourceType === "ATTENDANCE") {
      assert.ok(attendanceSnapshot);
      sourceId = attendanceSnapshot.id;
      sourceVersionId = attendanceSnapshot.id;
      sourceRevision = fixture.timesheetRevision.revision;
      effectiveFromMonth = fixture.run.periodStart;
    } else if (line.sourceType === "RECURRING_PAY") {
      const recurring = await transaction.employeeRecurringPayComponent.create({
        data: {
          businessId: fixture.business.id,
          membershipId: membership.id,
          type: line.type,
          code: line.code,
          createdById: fixture.owner.id,
        },
      });
      const version = await transaction.employeeRecurringPayComponentVersion.create({
        data: {
          businessId: fixture.business.id,
          membershipId: membership.id,
          componentId: recurring.id,
          revision: 1,
          effectiveFromMonth: fixture.run.periodStart,
          name: line.code,
          amount: centsToMoney(line.amountCents),
          currency: "MYR",
          source: "SYSTEM",
          reasonType: "OTHER",
          reasonNote: "Statutory closure integration dry run",
          createdById: fixture.owner.id,
        },
      });
      await transaction.payrollEntryRecurringPaySnapshot.create({
        data: {
          businessId: fixture.business.id,
          payrollEntryId: entry.id,
          membershipId: membership.id,
          sourceComponentId: recurring.id,
          sourceVersionId: version.id,
          sourceRevision: version.revision,
          type: line.type,
          code: line.code,
          name: line.code,
          amount: centsToMoney(line.amountCents),
          currency: "MYR",
          effectiveFromMonth: fixture.run.periodStart,
        },
      });
      sourceId = recurring.id;
      sourceVersionId = version.id;
      sourceRevision = version.revision;
      effectiveFromMonth = fixture.run.periodStart;
    } else if (line.sourceType === "VARIABLE_PAY") {
      const variablePay = await transaction.payrollVariablePay.create({
        data: {
          businessId: fixture.business.id,
          membershipId: membership.id,
          type: line.code as "BONUS" | "COMMISSION" | "INCENTIVE" | "ONE_OFF_EARNING",
          code: line.code,
          name: line.code,
          amount: centsToMoney(line.amountCents),
          earnedPeriodStart: fixture.run.periodStart,
          earnedPeriodEnd: fixture.run.periodEnd,
          payrollPeriodStart: fixture.run.periodStart,
          origin: "SYSTEM",
          reason: "Statutory closure integration dry run",
          status: "APPROVED",
          revision: 1,
          createdById: fixture.owner.id,
          approvedById: fixture.approver.id,
          approvedAt: new Date(),
        },
      });
      sourceId = variablePay.id;
      sourceRevision = variablePay.revision;
      effectiveFromMonth = variablePay.payrollPeriodStart;
      frozenLineKey = `VARIABLE:${variablePay.id.toUpperCase()}`;
      frozenSourceReason = variablePay.reason;
    }
    const manual = line.sourceType === "MANUAL_ADJUSTMENT";
    preparedLines.push({
      businessId: fixture.business.id,
      payrollRunId: fixture.run.id,
      payrollEntryId: entry.id,
      membershipId: membership.id,
      lineKey:
        frozenLineKey ??
        (manual ? `MANUAL:${randomUUID().toUpperCase()}` : `DRY:${input.key}:${index}`),
      type: line.type,
      code: line.code,
      name: line.code,
      amount: centsToMoney(line.amountCents),
      sourceType: line.sourceType,
      sourceId,
      sourceVersionId,
      sourceRevision,
      effectiveFromMonth,
      calculationBasis: "STATUTORY_CLOSURE_DRY_RUN",
      origin: manual ? "MANUAL" : "SYSTEM",
      adjustmentCategory: manual ? "OTHER" : null,
      reason: manual ? "Unknown classification dry-run blocker" : null,
      sourceReason: frozenSourceReason,
      sortOrder: index + 1,
      createdById: fixture.owner.id,
    });
  }
  await transaction.payrollEntryComponent.createMany({
    data: preparedLines,
  });
  return { key: input.key, entry, membership };
  });
}

function profileFor(membership: Awaited<ReturnType<typeof createDryRunEntry>>["membership"]) {
  return {
    dateOfBirth: membership.dateOfBirth,
    statutoryNationality: membership.statutoryNationality,
    epfEnabled: membership.epfEnabled,
    epfMemberBeforeAug1998: membership.epfMemberBeforeAug1998,
    socsoEnabled: membership.socsoEnabled,
    socsoCategory: membership.socsoCategory,
    eisEnabled: membership.eisEnabled,
    eisPreviouslyContributed: membership.eisPreviouslyContributed,
    lindung24OptIn: membership.lindung24OptIn,
    statutoryProfileRevision: membership.statutoryProfileRevision,
    taxProfileRevision: membership.taxProfileRevision,
    taxIdentificationNumber: membership.taxIdentificationNumber,
  };
}

function loadEntry(id: string) {
  return prisma.payrollEntry.findUniqueOrThrow({
    where: { id },
    include: {
      components: {
        orderBy: { sortOrder: "asc" },
        include: { statutoryTreatments: true },
      },
      statutorySnapshots: { orderBy: { scheme: "asc" } },
    },
  });
}

function snapshot(entry: Awaited<ReturnType<typeof loadEntry>>, scheme: "SOCSO" | "EIS") {
  const result = entry.statutorySnapshots.find((item) => item.scheme === scheme);
  assert.ok(result, `${scheme} snapshot missing`);
  return result;
}

function earning(code: string, sourceType: PayrollEntryComponentSourceType, amountCents: number): DryRunLine {
  return { code, sourceType, amountCents, type: "EARNING" };
}

function deduction(code: string, sourceType: PayrollEntryComponentSourceType, amountCents: number): DryRunLine {
  return { code, sourceType, amountCents, type: "DEDUCTION" };
}

function manualUnknown(amountCents: number): DryRunLine {
  return {
    code: "MANUAL_ADJUSTMENT",
    sourceType: "MANUAL_ADJUSTMENT",
    amountCents,
    type: "EARNING",
  };
}

function centsToMoney(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

type DryRunLine = {
  code: string;
  sourceType: PayrollEntryComponentSourceType;
  amountCents: number;
  type: PayrollEntryComponentType;
};

type DryRunCase = {
  key: string;
  payBasis: "MONTHLY" | "DAILY" | "HOURLY";
  nationality?: "MALAYSIAN" | "PERMANENT_RESIDENT" | "NON_MALAYSIAN";
  dateOfBirth?: Date | null;
  epfEnabled?: boolean;
  epfMemberBeforeAug1998?: boolean;
  socsoEnabled?: boolean;
  eisEnabled?: boolean;
  lines: DryRunLine[];
};

type ClosureReview = {
  version: string;
  classificationDigest: string;
  classifications: Array<{
    componentCode: string;
    sourceType: string | null;
    SOCSO: string;
    EIS: string;
    officialBasis: string[];
    notes: string;
  }>;
};

type EpfClosureReview = {
  version: string;
  classificationDigest: string;
  classifications: Array<{
    componentCode: string;
    sourceType: string;
    EPF: string;
    officialBasis: string[];
    notes: string;
  }>;
};
