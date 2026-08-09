import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  loadOwnPublishedPayslip,
  publishPayrollPayslips,
} from "../../src/lib/payroll/payslip-publication";
import { reopenPayrollRun } from "../../src/lib/payroll/service";

const prisma = new PrismaClient();

test.after(async () => {
  await prisma.$disconnect();
});

test("P4D publishes immutable snapshot bytes and enforces own-only self service", async () => {
  const fixture = await createFixture();
  const before = await loadOwnPublishedPayslip({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    publicationId: randomUUID(),
  });
  assert.equal(before, null);

  const result = await publishPayrollPayslips({
    businessId: fixture.business.id,
    runId: fixture.run.id,
    actor: actor(fixture.owner),
  });
  assert.deepEqual(result, {
    employeeCount: 1,
    publishedCount: 1,
    alreadyPublishedCount: 0,
  });
  const publication = await prisma.payrollPayslipPublication.findUniqueOrThrow({
    where: { payrollEntryId: fixture.entry.id },
  });
  assert.equal(Buffer.from(publication.documentBytes).subarray(0, 4).toString("ascii"), "%PDF");
  assert.equal(publication.documentSha256.length, 64);

  const own = await loadOwnPublishedPayslip({
    businessId: fixture.business.id,
    membershipId: fixture.membership.id,
    publicationId: publication.id,
  });
  assert.ok(own);
  assert.deepEqual(Buffer.from(own.documentBytes), Buffer.from(publication.documentBytes));
  assert.equal(await loadOwnPublishedPayslip({
    businessId: fixture.business.id,
    membershipId: fixture.otherMembership.id,
    publicationId: publication.id,
  }), null);

  await assert.rejects(
    prisma.payrollPayslipPublication.update({
      where: { id: publication.id },
      data: { documentSha256: "0".repeat(64) },
    }),
    /Published payslips are immutable/,
  );
  await assert.rejects(
    reopenPayrollRun({
      businessId: fixture.business.id,
      runId: fixture.run.id,
      actor: actor(fixture.owner),
      reason: "Published snapshot must remain immutable.",
    }),
    /published payslips cannot be reopened/i,
  );
});

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `P4D ${token}`, slug: `p4d-${token}` },
  });
  const branch = await prisma.branch.create({
    data: { businessId: business.id, name: "Main" },
  });
  const owner = await prisma.user.create({
    data: {
      branchId: branch.id,
      businessId: business.id,
      email: `p4d-${token}@test.local`,
      name: "P4D Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const membership = await createMembership(business.id, `P4D-${token.slice(0, 6)}`, token, "1");
  const otherMembership = await createMembership(business.id, `P4D-O-${token.slice(0, 6)}`, token, "2");
  const draftRun = await prisma.payrollRun.create({
    data: {
      businessId: business.id,
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      status: "DRAFT",
      attendanceSource: "LEGACY_OPERATIONAL_SESSION",
      workingDaysPerMonthSnapshot: 26,
      normalWorkMinutesPerDaySnapshot: 480,
      breakMinutesPerDaySnapshot: 60,
      overtimeMultiplierSnapshot: 1.5,
      publicHolidayExtraMultiplierSnapshot: 2,
      createdById: owner.id,
    },
  });
  const entry = await prisma.payrollEntry.create({
    data: {
      businessId: business.id,
      payrollRunId: draftRun.id,
      membershipId: membership.id,
      employeeCodeSnapshot: membership.employeeCode,
      fullNameSnapshot: membership.fullName,
      payBasisSnapshot: "MONTHLY",
      baseRateSnapshot: 0,
      workingDaysSnapshot: 26,
      normalWorkMinutesSnapshot: 480,
    },
  });
  const run = await prisma.payrollRun.update({
    where: { id: draftRun.id },
    data: {
      status: "FINALIZED",
      submittedAt: new Date("2026-08-31T00:00:00.000Z"),
      submittedById: owner.id,
      finalizedAt: new Date("2026-09-01T00:00:00.000Z"),
      finalizedById: owner.id,
    },
  });
  return { business, entry, membership, otherMembership, owner, run };
}

async function createMembership(
  businessId: string,
  employeeCode: string,
  token: string,
  suffix: string,
) {
  const digits = token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  const phone = `+601${digits}${suffix}`;
  const account = await prisma.employeeAccount.create({
    data: { name: employeeCode, phoneNormalized: phone, phoneNumber: phone },
  });
  return prisma.employeeBusinessMembership.create({
    data: {
      businessId,
      employeeAccountId: account.id,
      employeeCode,
      fullName: employeeCode,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
    },
  });
}

function actor(user: { id: string; name: string; email: string | null }) {
  return { userId: user.id, name: user.name, email: user.email ?? "" };
}
