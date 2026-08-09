import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { materializeStatutoryP2 } from "../../src/lib/payroll/statutory-p2";
import type { NormalizedContributionDataset } from "../../src/lib/payroll/statutory-artifact-pipeline";

test("LINDUNG24 participation history is additive, tenant-bound and overlap-safe", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const token = randomUUID();
      const business = await transaction.business.create({
        data: { name: `L24 ${token}`, slug: `l24-${token}` },
      });
      const otherBusiness = await transaction.business.create({
        data: { name: `L24 Other ${token}`, slug: `l24-other-${token}` },
      });
      const branch = await transaction.branch.create({
        data: { businessId: business.id, name: "Main" },
      });
      const owner = await transaction.user.create({
        data: {
          branchId: branch.id,
          businessId: business.id,
          email: `l24-${token}@test.local`,
          name: "L24 Owner",
          role: "BUSINESS_OWNER",
        },
      });
      const membership = await createMembership(transaction, business.id, `A-${token}`, "MALAYSIAN");
      const otherMembership = await createMembership(transaction, otherBusiness.id, `B-${token}`, "MALAYSIAN");

      const initial = await transaction.employeeLindung24ParticipationVersion.create({
        data: {
          act4Covered: true,
          businessId: business.id,
          effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
          employerContext: "SINGLE_EMPLOYER",
          membershipId: membership.id,
          reason: "Official transition evidence",
          recordedById: owner.id,
          revision: 1,
          selectedEmployer: "CURRENT_BUSINESS",
          sourceDigest: "a".repeat(64),
          sourceReference: "PERKESO FAQ v2.1",
          sourceType: "OFFICIAL_TRANSITION",
          status: "DEFAULT_PARTICIPATING",
        },
      });

      await transaction.employeeLindung24ParticipationVersion.update({
        where: { id: initial.id },
        data: {
          effectiveToMonth: new Date("2026-08-01T00:00:00.000Z"),
          supersededAt: new Date("2026-08-15T00:00:00.000Z"),
        },
      });
      const optedOut = await transaction.employeeLindung24ParticipationVersion.create({
        data: {
          act4Covered: true,
          businessId: business.id,
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          employerContext: "SINGLE_EMPLOYER",
          membershipId: membership.id,
          officialSubmittedAt: new Date("2026-08-15T01:00:00.000Z"),
          reason: "Employee official opt-out evidence",
          recordedById: owner.id,
          revision: 2,
          selectedEmployer: "CURRENT_BUSINESS",
          sourceDigest: "c".repeat(64),
          sourceReference: "NPL24/JUN26 v2.1",
          sourceType: "EMPLOYEE_OPT_OUT",
          status: "VOLUNTARY_OPT_OUT",
          supersedesVersionId: initial.id,
        },
      });
      assert.equal(optedOut.revision, 2);
      assert.equal(
        (await transaction.employeeLindung24ParticipationVersion.findUniqueOrThrow({ where: { id: initial.id } }))
          .status,
        "DEFAULT_PARTICIPATING",
      );
      throw new Error("ROLLBACK_LINDUNG24_INTEGRATION_FIXTURE");
    }),
    /ROLLBACK_LINDUNG24_INTEGRATION_FIXTURE/,
  );
});

test("LINDUNG24 database trigger rejects overlapping periods", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createMinimalFixture(transaction);
      await transaction.employeeLindung24ParticipationVersion.create({
        data: participationData(fixture, { revision: 1 }),
      });
      await transaction.employeeLindung24ParticipationVersion.create({
        data: participationData(fixture, {
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          revision: 2,
          sourceDigest: "b".repeat(64),
        }),
      });
    }),
    /LINDUNG24_PARTICIPATION_PERIOD_OVERLAP/,
  );
});

test("LINDUNG24 database trigger rejects fact mutation", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createMinimalFixture(transaction);
      const initial = await transaction.employeeLindung24ParticipationVersion.create({
        data: participationData(fixture, { revision: 1 }),
      });
      await transaction.employeeLindung24ParticipationVersion.update({
        where: { id: initial.id },
        data: { status: "VOLUNTARY_OPT_OUT" },
      });
    }),
    /LINDUNG24_PARTICIPATION_VERSION_IMMUTABLE/,
  );
});

test("LINDUNG24 composite tenant foreign key rejects cross-business membership", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createMinimalFixture(transaction);
      await transaction.employeeLindung24ParticipationVersion.create({
        data: participationData(fixture, {
          membershipId: fixture.otherMembership.id,
          revision: 1,
        }),
      });
    }),
  );
});

test("LINDUNG24 refund events append status history instead of mutating it", async () => {
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createMinimalFixture(transaction);
      const refund = await transaction.employeeLindung24RefundEvent.create({
        data: {
          businessId: fixture.business.id,
          caseKey: `L24:${fixture.membership.id}:2026-07`,
          contributionMonth: new Date("2026-07-01T00:00:00.000Z"),
          employeeAmount: "44.65",
          membershipId: fixture.membership.id,
          reason: "TRANSITION_OPT_OUT",
          recordedById: fixture.owner.id,
          revision: 1,
          sourceDigest: "e".repeat(64),
          status: "REVIEW_REQUIRED",
        },
      });
      await transaction.employeeLindung24RefundEvent.update({
        where: { id: refund.id },
        data: { status: "REFUNDED" },
      });
    }),
    /LINDUNG24_REFUND_EVENT_IMMUTABLE/,
  );
});

test("LINDUNG24 payroll dry run freezes participation, rule, wage and employee-only money", async () => {
  const dataset = JSON.parse(
    readFileSync("statutory/official/datasets/perkeso-act4-lindung24-2026-06.json", "utf8"),
  ) as NormalizedContributionDataset;
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createMinimalFixture(transaction);
      const participation = await transaction.employeeLindung24ParticipationVersion.create({
        data: participationData(fixture, { revision: 1 }),
      });
      const run = await transaction.payrollRun.create({
        data: {
          attendanceSource: "LEGACY_OPERATIONAL_SESSION",
          breakMinutesPerDaySnapshot: 60,
          businessId: fixture.business.id,
          createdById: fixture.owner.id,
          normalWorkMinutesPerDaySnapshot: 480,
          overtimeMultiplierSnapshot: "1.50",
          periodEnd: new Date("2026-08-01T00:00:00.000Z"),
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
          publicHolidayExtraMultiplierSnapshot: "2.00",
          workingDaysPerMonthSnapshot: 26,
        },
      });
      const compensation = await transaction.employeeCompensationVersion.create({
        data: {
          baseRate: "5000.00",
          businessId: fixture.business.id,
          createdById: fixture.owner.id,
          effectiveFromMonth: run.periodStart,
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonNote: "LINDUNG24 payroll dry run",
          reasonType: "OTHER",
          source: "SYSTEM",
        },
      });
      const entry = await transaction.payrollEntry.create({
        data: {
          baseRateSnapshot: "5000.00",
          businessId: fixture.business.id,
          compensationEffectiveFromMonthSnapshot: compensation.effectiveFromMonth,
          compensationSourceSnapshot: compensation.source,
          compensationVersionId: compensation.id,
          employeeCodeSnapshot: fixture.membership.employeeCode,
          fullNameSnapshot: fixture.membership.fullName,
          grossPay: "5000.00",
          membershipId: fixture.membership.id,
          netPay: "5000.00",
          normalWorkMinutesSnapshot: 480,
          payBasisSnapshot: "MONTHLY",
          payrollRunId: run.id,
          workingDaysSnapshot: 26,
        },
      });
      await transaction.payrollEntryComponent.create({
        data: {
          amount: "5000.00",
          businessId: fixture.business.id,
          calculationBasis: "COMPENSATION_VERSION",
          code: "BASIC_SALARY",
          createdById: fixture.owner.id,
          effectiveFromMonth: run.periodStart,
          lineKey: "SYSTEM:BASIC_SALARY",
          membershipId: fixture.membership.id,
          name: "Basic salary",
          origin: "SYSTEM",
          payrollEntryId: entry.id,
          payrollRunId: run.id,
          sortOrder: 10,
          sourceType: "BASIC_SALARY",
          sourceVersionId: compensation.id,
          type: "EARNING",
        },
      });
      const ruleSet = await transaction.statutoryRuleSet.create({
        data: {
          authority: "PERKESO",
          calculatorVersion: "statutory-p2c-calculators/1.0.0",
          classificationVersion: "MALAYSIA_LINDUNG24_2026_SIGNOFF_CANDIDATE_1",
          datasetDigest: dataset.datasetDigest,
          effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
          effectiveTo: new Date("2028-06-01T00:00:00.000Z"),
          goldenFixtureDigest: "71f7882669ed7c3be53b6b7497dd95f4ad440dbc48b314dea9c7630d5698db14",
          parserVersion: dataset.parserVersion,
          ruleData: dataset as unknown as Prisma.InputJsonValue,
          scheme: "LINDUNG24",
          sourceDigest: dataset.artifactSha256,
          sourceDocumentName: "New Contribution Rate Including SKBBK",
          sourceReference: "PERKESO official retained schedule",
          version: `TEST_L24_${randomUUID()}`,
        },
      });
      const classification = await transaction.statutoryComponentClassification.create({
        data: {
          authorityRef: "PERKESO FAQ v2.1 question 33",
          componentCode: "BASIC_SALARY",
          rationale: "Act 4 section 2(24) contractual remuneration",
          ruleSetId: ruleSet.id,
          scheme: "LINDUNG24",
          sourceType: "BASIC_SALARY",
          treatment: "INCLUDED",
        },
      });
      await materializeStatutoryP2(transaction, {
        actorUserId: fixture.owner.id,
        businessId: fixture.business.id,
        membershipId: fixture.membership.id,
        payrollEntryId: entry.id,
        payrollRunId: run.id,
        statutoryPeriod: run.periodStart,
        preloadedLindung24Participation: [participation],
        preloadedRules: [{
          ...ruleSet,
          status: "ACTIVE",
          readiness: "CALCULATION_VERIFIED",
          classifications: [{
            componentCode: "BASIC_SALARY",
            id: classification.id,
            rationale: "Act 4 section 2(24) contractual remuneration",
            sourceType: "BASIC_SALARY",
            treatment: "INCLUDED",
          }],
        }],
        profile: {
          dateOfBirth: null,
          eisEnabled: false,
          eisPreviouslyContributed: false,
          epfEnabled: false,
          epfMemberBeforeAug1998: false,
          lindung24OptIn: false,
          socsoCategory: null,
          socsoEnabled: false,
          statutoryNationality: "MALAYSIAN",
          statutoryProfileRevision: 1,
          taxIdentificationNumber: null,
          taxProfileRevision: 0,
        },
      });
      const snapshot = await transaction.payrollEntryStatutorySnapshot.findUniqueOrThrow({
        where: { payrollEntryId_scheme: { payrollEntryId: entry.id, scheme: "LINDUNG24" } },
      });
      const line = await transaction.payrollEntryComponent.findUniqueOrThrow({
        where: { payrollEntryId_lineKey: { payrollEntryId: entry.id, lineKey: "STATUTORY:LINDUNG24_EMPLOYEE" } },
      });
      assert.equal(snapshot.status, "CALCULATED");
      assert.equal(snapshot.lindung24ParticipationVersionId, participation.id);
      assert.equal(snapshot.lindung24ParticipationRevisionSnapshot, 1);
      assert.equal(snapshot.lindung24EmployerSelectionSnapshot, "CURRENT_BUSINESS");
      assert.equal(snapshot.employerContribution.toString(), "0");
      assert.equal(line.amount.toString(), snapshot.employeeContribution.toString());
      assert.ok(Number(line.amount) > 0);
      throw new Error("ROLLBACK_LINDUNG24_PAYROLL_DRY_RUN");
    }),
    /ROLLBACK_LINDUNG24_PAYROLL_DRY_RUN/,
  );
});

async function createMinimalFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: { name: `L24 Guard ${token}`, slug: `l24-guard-${token}` },
  });
  const otherBusiness = await transaction.business.create({
    data: { name: `L24 Guard Other ${token}`, slug: `l24-guard-other-${token}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: "Main" },
  });
  const owner = await transaction.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `l24-guard-${token}@test.local`,
      name: "L24 Guard Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const membership = await createMembership(transaction, business.id, `A-${token}`, "MALAYSIAN");
  const otherMembership = await createMembership(transaction, otherBusiness.id, `B-${token}`, "MALAYSIAN");
  return { business, membership, otherMembership, owner };
}

function participationData(
  fixture: Awaited<ReturnType<typeof createMinimalFixture>>,
  overrides: Record<string, unknown>,
) {
  return {
    act4Covered: true,
    businessId: fixture.business.id,
    effectiveFromMonth: new Date("2026-07-01T00:00:00.000Z"),
    employerContext: "SINGLE_EMPLOYER" as const,
    membershipId: fixture.membership.id,
    reason: "Official transition evidence",
    recordedById: fixture.owner.id,
    revision: 1,
    selectedEmployer: "CURRENT_BUSINESS" as const,
    sourceDigest: "a".repeat(64),
    sourceReference: "PERKESO FAQ v2.1",
    sourceType: "OFFICIAL_TRANSITION" as const,
    status: "DEFAULT_PARTICIPATING" as const,
    ...overrides,
  };
}

async function createMembership(
  transaction: Prisma.TransactionClient,
  businessId: string,
  suffix: string,
  nationality: "MALAYSIAN" | "NON_MALAYSIAN",
) {
  const phone = `+609${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await transaction.employeeAccount.create({
    data: { name: suffix, phoneNormalized: phone, phoneNumber: phone },
  });
  return transaction.employeeBusinessMembership.create({
    data: {
      businessId,
      employeeAccountId: account.id,
      employeeCode: suffix.slice(0, 30),
      fullName: suffix,
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      statutoryNationality: nationality,
    },
  });
}
