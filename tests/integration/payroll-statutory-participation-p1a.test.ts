import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";

function digest(character: string) {
  return character.repeat(64);
}

test("effective-dated statutory participation rejects overlaps and fact mutation", async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({
    data: {
      name: `P1A Participation ${suffix}`,
      slug: `p1a-participation-${suffix}`,
    },
  });
  const actor = await prisma.user.create({
    data: {
      businessId: business.id,
      email: `p1a-${suffix}@test.local`,
      name: "P1A Statutory Reviewer",
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+601${Number.parseInt(suffix.slice(0, 8), 16)
    .toString()
    .padStart(9, "0")
    .slice(-8)}`;
  const account = await prisma.employeeAccount.create({
    data: {
      name: "P1A Employee",
      phoneNumber: phone,
      phoneNormalized: phone,
    },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: business.id,
      employeeAccountId: account.id,
      employeeCode: `P1A-${suffix.slice(0, 8)}`,
      fullName: "P1A Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
    },
  });

  const august = await prisma.employeeStatutoryParticipationPeriod.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      scheme: "EPF",
      revision: 1,
      effectiveFromMonth: new Date("2050-08-01T00:00:00.000Z"),
      status: "NOT_PARTICIPATING",
      sourceType: "OFFICIAL_RECORD",
      sourceReference: "HASIL-Q4-Aug-Oct",
      reason: "No EPF participation for the initial contract period.",
      sourceDigest: digest("a"),
      recordedById: actor.id,
      confirmedById: actor.id,
      confirmedAt: new Date("2050-07-31T00:00:00.000Z"),
    },
  });

  await prisma.employeeStatutoryParticipationPeriod.update({
    where: { id: august.id },
    data: {
      effectiveToMonth: new Date("2050-11-01T00:00:00.000Z"),
      supersededAt: new Date("2050-10-31T00:00:00.000Z"),
    },
  });
  await prisma.employeeStatutoryParticipationPeriod.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      scheme: "EPF",
      revision: 2,
      effectiveFromMonth: new Date("2050-11-01T00:00:00.000Z"),
      status: "PARTICIPATING",
      sourceType: "EMPLOYMENT_CHANGE",
      sourceReference: "HASIL-Q4-Nov-Dec",
      reason: "EPF participation begins with the extended contract.",
      sourceDigest: digest("b"),
      recordedById: actor.id,
      confirmedById: actor.id,
      confirmedAt: new Date("2050-10-31T00:00:00.000Z"),
      supersedesPeriodId: august.id,
    },
  });

  await assert.rejects(
    prisma.employeeStatutoryParticipationPeriod.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        scheme: "EPF",
        revision: 3,
        effectiveFromMonth: new Date("2050-10-01T00:00:00.000Z"),
        effectiveToMonth: new Date("2050-12-01T00:00:00.000Z"),
        status: "PARTICIPATING",
        sourceType: "OTHER",
        reason: "This overlapping period must be rejected.",
        sourceDigest: digest("c"),
        recordedById: actor.id,
        confirmedById: actor.id,
        confirmedAt: new Date("2050-09-30T00:00:00.000Z"),
      },
    }),
    /STATUTORY_PARTICIPATION_PERIOD_OVERLAP/,
  );
  await assert.rejects(
    prisma.employeeStatutoryParticipationPeriod.update({
      where: { id: august.id },
      data: { reason: "History must not be rewritten." },
    }),
    /STATUTORY_PARTICIPATION_PERIOD_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.employeeStatutoryParticipationPeriod.delete({ where: { id: august.id } }),
    /STATUTORY_PARTICIPATION_PERIOD_IMMUTABLE/,
  );
});

test("finalized payroll snapshot retains the historical participation period", async () => {
  const suffix = randomUUID();
  const business = await prisma.business.create({
    data: {
      name: `P1A Snapshot ${suffix}`,
      slug: `p1a-snapshot-${suffix}`,
    },
  });
  const actor = await prisma.user.create({
    data: {
      businessId: business.id,
      email: `p1a-snapshot-${suffix}@test.local`,
      name: "P1A Snapshot Reviewer",
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+601${Number.parseInt(suffix.slice(0, 8), 16)
    .toString()
    .padStart(9, "0")
    .slice(-8)}`;
  const account = await prisma.employeeAccount.create({
    data: {
      name: "P1A Snapshot Employee",
      phoneNumber: phone,
      phoneNormalized: phone,
    },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: business.id,
      employeeAccountId: account.id,
      employeeCode: `P1AS-${suffix.slice(0, 8)}`,
      fullName: "P1A Snapshot Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
    },
  });
  const augustParticipation = await prisma.employeeStatutoryParticipationPeriod.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      scheme: "EPF",
      revision: 1,
      effectiveFromMonth: new Date("2051-08-01T00:00:00.000Z"),
      effectiveToMonth: new Date("2051-11-01T00:00:00.000Z"),
      status: "NOT_PARTICIPATING",
      sourceType: "OFFICIAL_RECORD",
      sourceReference: "HASIL-Q4-Aug-Oct",
      reason: "Historical August participation state.",
      sourceDigest: digest("d"),
      recordedById: actor.id,
      confirmedById: actor.id,
      confirmedAt: new Date("2051-07-31T00:00:00.000Z"),
    },
  });
  await prisma.employeeStatutoryParticipationPeriod.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      scheme: "EPF",
      revision: 2,
      effectiveFromMonth: new Date("2051-11-01T00:00:00.000Z"),
      status: "PARTICIPATING",
      sourceType: "EMPLOYMENT_CHANGE",
      sourceReference: "HASIL-Q4-Nov-Dec",
      reason: "Later participation must not rewrite August.",
      sourceDigest: digest("e"),
      recordedById: actor.id,
      confirmedById: actor.id,
      confirmedAt: new Date("2051-10-31T00:00:00.000Z"),
      supersedesPeriodId: augustParticipation.id,
    },
  });
  const run = await prisma.payrollRun.create({
    data: {
      attendanceSource: "LEGACY_OPERATIONAL_SESSION",
      businessId: business.id,
      breakMinutesPerDaySnapshot: 60,
      normalWorkMinutesPerDaySnapshot: 480,
      overtimeMultiplierSnapshot: "1.50",
      periodEnd: new Date("2051-09-01T00:00:00.000Z"),
      periodStart: new Date("2051-08-01T00:00:00.000Z"),
      publicHolidayExtraMultiplierSnapshot: "2.00",
      status: "DRAFT",
      workingDaysPerMonthSnapshot: 26,
    },
  });
  const entry = await prisma.payrollEntry.create({
    data: {
      baseRateSnapshot: "3000.00",
      businessId: business.id,
      employeeCodeSnapshot: membership.employeeCode,
      fullNameSnapshot: membership.fullName,
      membershipId: membership.id,
      normalWorkMinutesSnapshot: 480,
      payBasisSnapshot: "MONTHLY",
      payrollRunId: run.id,
      workingDaysSnapshot: 26,
    },
  });
  const snapshot = await prisma.payrollEntryStatutorySnapshot.create({
    data: {
      businessId: business.id,
      payrollRunId: run.id,
      payrollEntryId: entry.id,
      membershipId: membership.id,
      scheme: "EPF",
      status: "NOT_APPLICABLE",
      calculationSource: "NOT_APPLICABLE",
      profileRevisionSnapshot: 1,
      taxProfileRevisionSnapshot: 0,
      statutoryParticipationPeriodId: augustParticipation.id,
      statutoryParticipationStatusSnapshot: "NOT_PARTICIPATING",
      statutoryParticipationFromSnapshot: new Date("2051-08-01T00:00:00.000Z"),
      statutoryParticipationToSnapshot: new Date("2051-11-01T00:00:00.000Z"),
      statutoryParticipationRevisionSnapshot: 1,
      statutoryParticipationSourceSnapshot: "OFFICIAL_RECORD:HASIL-Q4-Aug-Oct",
      calculationMetadata: { participationSource: "EFFECTIVE_DATED" },
      sourceDigest: digest("f"),
    },
  });
  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      status: "FINALIZED",
      submittedAt: new Date("2051-09-01T23:55:00.000Z"),
      submittedById: actor.id,
      finalizedAt: new Date("2051-09-02T00:00:00.000Z"),
      finalizedById: actor.id,
    },
  });

  const retained = await prisma.payrollEntryStatutorySnapshot.findUniqueOrThrow({
    where: { id: snapshot.id },
  });
  assert.equal(retained.statutoryParticipationPeriodId, augustParticipation.id);
  assert.equal(retained.statutoryParticipationStatusSnapshot, "NOT_PARTICIPATING");
  assert.equal(retained.statutoryParticipationRevisionSnapshot, 1);
  await assert.rejects(
    prisma.payrollEntryStatutorySnapshot.update({
      where: { id: snapshot.id },
      data: { statutoryParticipationStatusSnapshot: "PARTICIPATING" },
    }),
    /FINALIZED_STATUTORY_SNAPSHOT_IMMUTABLE/,
  );
});
