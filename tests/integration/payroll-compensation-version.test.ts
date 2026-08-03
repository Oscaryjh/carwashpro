import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  resolveEmployeeCompensationVersion,
  writeEmployeeCompensationVersionInTransaction,
} from "../../src/lib/payroll/compensation-version";
import {
  finalizePayrollRun,
  generatePayrollRun,
  reopenPayrollRun,
  submitPayrollRunForReview,
} from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

test("compensation versions enforce tenant, month, immutability and projection rules", async () => {
  const fixture = await createFixture();
  try {
    const august = await writeVersion(fixture, {
      baseRate: 2500,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
    });
    const november = await writeVersion(fixture, {
      baseRate: 2800,
      effectiveFromMonth: new Date("2026-11-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
    });

    assert.equal(
      (
        await resolveEmployeeCompensationVersion({
          businessId: fixture.business.id,
          membershipId: fixture.membership.id,
          payrollPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
        })
      ).versionId,
      august.id,
    );
    assert.equal(
      (
        await resolveEmployeeCompensationVersion({
          businessId: fixture.business.id,
          membershipId: fixture.membership.id,
          payrollPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        })
      ).versionId,
      november.id,
    );
    const projected = await prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: fixture.membership.id },
      select: { baseSalary: true },
    });
    assert.equal(projected.baseSalary?.toString(), "2500");

    await assert.rejects(
      prisma.employeeCompensationVersion.create({
        data: {
          baseRate: 2550,
          businessId: fixture.business.id,
          effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "OTHER",
          source: "MANUAL",
        },
      }),
      /Unique constraint|active_month_key/i,
    );
    await assert.rejects(
      prisma.employeeCompensationVersion.create({
        data: {
          baseRate: -1,
          businessId: fixture.business.id,
          effectiveFromMonth: new Date("2026-12-01T00:00:00.000Z"),
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "OTHER",
          source: "MANUAL",
        },
      }),
      /nonnegative_rate_check|check constraint/i,
    );
    await assert.rejects(
      prisma.employeeCompensationVersion.create({
        data: {
          baseRate: 3000,
          businessId: fixture.business.id,
          effectiveFromMonth: new Date("2026-12-15T00:00:00.000Z"),
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "OTHER",
          source: "MANUAL",
        },
      }),
      /month_start_check|check constraint/i,
    );
    const selfId = randomUUID();
    await assert.rejects(
      prisma.employeeCompensationVersion.create({
        data: {
          baseRate: 3000,
          businessId: fixture.business.id,
          effectiveFromMonth: new Date("2027-01-01T00:00:00.000Z"),
          id: selfId,
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "OTHER",
          source: "MANUAL",
          supersedesVersionId: selfId,
        },
      }),
      /self_supersession|check constraint|superseded compensation version does not exist/i,
    );
    await assert.rejects(
      prisma.employeeCompensationVersion.create({
        data: {
          baseRate: 3000,
          businessId: fixture.otherBusiness.id,
          effectiveFromMonth: new Date("2026-12-01T00:00:00.000Z"),
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "OTHER",
          source: "MANUAL",
        },
      }),
      /foreign key constraint|membership_business_fkey/i,
    );
    await assert.rejects(
      prisma.employeeCompensationVersion.update({
        where: { id: august.id },
        data: { baseRate: 9999 },
      }),
      /immutable|superseding version/i,
    );
    await assert.rejects(
      prisma.employeeCompensationVersion.delete({ where: { id: august.id } }),
      /append-only|cannot be deleted/i,
    );
    await assert.rejects(
      prisma.$transaction((transaction) =>
        writeEmployeeCompensationVersionInTransaction(
          {
            actor: actor(fixture),
            authorization: {
              access: access(fixture),
              allowedBranchIds: [fixture.branchA.id],
            },
            baseRate: 3100,
            businessId: fixture.business.id,
            effectiveFromMonth: new Date("2027-02-01T00:00:00.000Z"),
            membershipId: fixture.membership.id,
            payBasis: "MONTHLY",
            reasonType: "OTHER",
            source: "MANUAL",
          },
          transaction,
        ),
      ),
      /whole-business payroll scope/i,
    );
    await assert.rejects(
      prisma.$transaction((transaction) =>
        writeEmployeeCompensationVersionInTransaction(
          {
            actor: actor(fixture),
            authorization: {
              access: {
                ...access(fixture),
                businessId: fixture.otherBusiness.id,
                homeBusinessId: fixture.otherBusiness.id,
              } as ResolvedBusinessAccess,
              allowedBranchIds: [fixture.branchA.id, fixture.branchB.id],
            },
            baseRate: 3100,
            businessId: fixture.business.id,
            effectiveFromMonth: new Date("2027-02-01T00:00:00.000Z"),
            membershipId: fixture.membership.id,
            payBasis: "MONTHLY",
            reasonType: "OTHER",
            source: "MANUAL",
          },
          transaction,
        ),
      ),
      /not found in the selected business/i,
    );

    const corrected = await writeVersion(fixture, {
      baseRate: 2600,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
      reasonNote: "Correction RM 2,600 for IC 900101-12-3456.",
    });
    const old = await prisma.employeeCompensationVersion.findUniqueOrThrow({
      where: { id: august.id },
    });
    assert.equal(old.status, "SUPERSEDED");
    assert.equal(corrected.supersedesVersionId, august.id);
    assert.doesNotMatch(corrected.reasonNote ?? "", /2,600|900101|3456/);
    assert.match(corrected.reasonNote ?? "", /REDACTED/);
    assert.equal(
      (
        await resolveEmployeeCompensationVersion({
          businessId: fixture.business.id,
          membershipId: fixture.membership.id,
          payrollPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        })
      ).versionId,
      corrected.id,
    );

    const auditText = JSON.stringify(
      await prisma.auditLog.findMany({
        where: {
          businessId: fixture.business.id,
          entityType: "EmployeeCompensationVersion",
        },
        select: { after: true, before: true, metadata: true },
      }),
    );
    assert.doesNotMatch(auditText, /2500|2600|2800|9999/);
    assert.match(auditText, /\[REDACTED\]/);
  } finally {
    await cleanupFixture(fixture);
  }
});

test("payroll generate and refresh resolve compensation by run month", async () => {
  const fixture = await createFixture();
  try {
    const daily = await createAdditionalMembership(fixture, "DAILY", 100);
    const hourly = await createAdditionalMembership(fixture, "HOURLY", 15);
    const august = await writeVersion(fixture, {
      baseRate: 2600,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
    });
    const november = await writeVersion(fixture, {
      baseRate: 2800,
      effectiveFromMonth: new Date("2026-11-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
    });
    const dailyVersion = await writeVersion(fixture, {
      baseRate: 100,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      membershipId: daily.id,
      payBasis: "DAILY",
    });
    const hourlyVersion = await writeVersion(fixture, {
      baseRate: 15,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      membershipId: hourly.id,
      payBasis: "HOURLY",
    });
    const augustTimesheet = await createLockedTimesheet(fixture, "2026-08");
    const novemberTimesheet = await createLockedTimesheet(fixture, "2026-11");

    const augustRun = await generatePayrollRun({
      actor: actor(fixture),
      businessId: fixture.business.id,
      month: "2026-08",
    });
    assert.equal(augustRun.attendanceTimesheetRevisionId, augustTimesheet.id);
    const augustEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: {
        payrollRunId_membershipId: {
          membershipId: fixture.membership.id,
          payrollRunId: augustRun.id,
        },
      },
    });
    assert.equal(augustEntry.compensationVersionId, august.id);
    assert.equal(augustEntry.baseRateSnapshot.toString(), "2600");
    assert.equal(augustEntry.payBasisSnapshot, "MONTHLY");
    assert.equal(
      augustEntry.compensationEffectiveFromMonthSnapshot?.toISOString(),
      "2026-08-01T00:00:00.000Z",
    );
    const otherVersion = await prisma.employeeCompensationVersion.create({
      data: {
        baseRate: 3000,
        businessId: fixture.otherBusiness.id,
        effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
        membershipId: fixture.otherMembership.id,
        payBasis: "MONTHLY",
        reasonType: "OTHER",
        source: "MANUAL",
      },
    });
    await assert.rejects(
      prisma.payrollEntry.update({
        where: { id: augustEntry.id },
        data: { compensationVersionId: otherVersion.id },
      }),
      /foreign key constraint|compensation_version_business_fkey/i,
    );
    const basisEntries = await prisma.payrollEntry.findMany({
      where: { payrollRunId: augustRun.id },
      select: {
        compensationVersionId: true,
        membershipId: true,
        payBasisSnapshot: true,
      },
    });
    assert.deepEqual(
      basisEntries
        .map((entry) => ({
          basis: entry.payBasisSnapshot,
          membershipId: entry.membershipId,
          versionId: entry.compensationVersionId,
        }))
        .sort((a, b) => a.basis.localeCompare(b.basis)),
      [
        { basis: "DAILY", membershipId: daily.id, versionId: dailyVersion.id },
        { basis: "HOURLY", membershipId: hourly.id, versionId: hourlyVersion.id },
        { basis: "MONTHLY", membershipId: fixture.membership.id, versionId: august.id },
      ],
    );

    await prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command_maintenance', 'on', true)`;
      await transaction.employeeBusinessMembership.update({
        where: { id: fixture.membership.id },
        data: { baseSalary: 9999 },
      });
    });
    await prisma.payrollEntry.update({
      where: { id: augustEntry.id },
      data: {
        allowances: 123,
        notes: "This manual adjustment must be cleared by refresh.",
        otherDeductions: 45,
        pcb: 12,
      },
    });
    await generatePayrollRun({
      actor: actor(fixture),
      businessId: fixture.business.id,
      month: "2026-08",
    });
    const refreshedAugust = await prisma.payrollEntry.findUniqueOrThrow({
      where: {
        payrollRunId_membershipId: {
          membershipId: fixture.membership.id,
          payrollRunId: augustRun.id,
        },
      },
    });
    assert.equal(refreshedAugust.compensationVersionId, august.id);
    assert.equal(refreshedAugust.baseRateSnapshot.toString(), "2600");
    assert.equal(refreshedAugust.allowances.toString(), "0");
    assert.equal(refreshedAugust.otherDeductions.toString(), "0");
    assert.equal(refreshedAugust.pcb.toString(), "0");
    assert.equal(refreshedAugust.notes, null);

    const novemberRun = await generatePayrollRun({
      actor: actor(fixture),
      businessId: fixture.business.id,
      month: "2026-11",
    });
    assert.equal(novemberRun.attendanceTimesheetRevisionId, novemberTimesheet.id);
    const novemberEntry = await prisma.payrollEntry.findUniqueOrThrow({
      where: {
        payrollRunId_membershipId: {
          membershipId: fixture.membership.id,
          payrollRunId: novemberRun.id,
        },
      },
    });
    assert.equal(novemberEntry.compensationVersionId, november.id);
    assert.equal(novemberEntry.baseRateSnapshot.toString(), "2800");

    await prisma.payrollEntry.updateMany({
      where: { payrollRunId: novemberRun.id },
      data: { statutoryStatus: "AUTO_CALCULATED" },
    });
    await submitPayrollRunForReview({
      actor: actor(fixture),
      businessId: fixture.business.id,
      runId: novemberRun.id,
    });
    await assert.rejects(
      generatePayrollRun({
        actor: actor(fixture),
        businessId: fixture.business.id,
        month: "2026-11",
      }),
      /awaiting review or already finalized cannot be regenerated/i,
    );
    await finalizePayrollRun({
      actor: actor(fixture),
      allowSelfApprovalOverride: true,
      businessId: fixture.business.id,
      overrideReason: "Integration owner override.",
      runId: novemberRun.id,
    });
    await assert.rejects(
      generatePayrollRun({
        actor: actor(fixture),
        businessId: fixture.business.id,
        month: "2026-11",
      }),
      /awaiting review or already finalized cannot be regenerated/i,
    );
    const beforeReopen = await prisma.payrollEntry.findMany({
      where: { payrollRunId: novemberRun.id },
      orderBy: { membershipId: "asc" },
      select: {
        baseRateSnapshot: true,
        compensationVersionId: true,
        id: true,
        membershipId: true,
        netPay: true,
      },
    });
    await reopenPayrollRun({
      actor: actor(fixture),
      businessId: fixture.business.id,
      reason: "Integration reopen without recalculation.",
      runId: novemberRun.id,
    });
    const afterReopen = await prisma.payrollEntry.findMany({
      where: { payrollRunId: novemberRun.id },
      orderBy: { membershipId: "asc" },
      select: {
        baseRateSnapshot: true,
        compensationVersionId: true,
        id: true,
        membershipId: true,
        netPay: true,
      },
    });
    assert.deepEqual(afterReopen, beforeReopen);

    await assert.rejects(
      generatePayrollRun({
        actor: actor(fixture),
        businessId: fixture.business.id,
        month: "2026-07",
      }),
      /Lock the monthly Attendance Timesheet/i,
    );
    assert.equal(
      await prisma.payrollRun.count({
        where: {
          businessId: fixture.business.id,
          periodStart: new Date("2026-07-01T00:00:00.000Z"),
        },
      }),
      0,
    );

    const generationAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "PAYROLL_RUN_REGENERATED",
        businessId: fixture.business.id,
      },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    const auditText = JSON.stringify(generationAudit.metadata);
    assert.match(auditText, new RegExp(august.id));
    assert.doesNotMatch(auditText, /2600|2800|9999/);
  } finally {
    await cleanupFixture(fixture);
  }
});

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: { name: `Compensation ${token}`, slug: `compensation-${token}` },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: `Other ${token}`, slug: `compensation-other-${token}` },
  });
  const branchA = await prisma.branch.create({
    data: { businessId: business.id, name: "Main" },
  });
  const branchB = await prisma.branch.create({
    data: { businessId: business.id, name: "Second" },
  });
  const owner = await prisma.user.create({
    data: {
      branchId: branchA.id,
      businessId: business.id,
      email: `owner-${token}@test.local`,
      name: "Compensation Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const account = await prisma.employeeAccount.create({
    data: {
      name: "Compensation Employee",
      phoneNormalized: `+601${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
      phoneNumber: `+601${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
    },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      baseSalary: 2500,
      businessId: business.id,
      employeeAccountId: account.id,
      employeeCode: `C-${token.slice(0, 8)}`,
      fullName: "Compensation Employee",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
      phoneNumber: account.phoneNumber,
      phoneNumberNormalized: account.phoneNormalized,
    },
  });
  const otherAccount = await prisma.employeeAccount.create({
    data: {
      name: "Other Compensation Employee",
      phoneNormalized: `+609${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
      phoneNumber: `+609${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`,
    },
  });
  const otherMembership = await prisma.employeeBusinessMembership.create({
    data: {
      baseSalary: 3000,
      businessId: otherBusiness.id,
      employeeAccountId: otherAccount.id,
      employeeCode: `O-${token.slice(0, 8)}`,
      fullName: "Other Compensation Employee",
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      payBasis: "MONTHLY",
      phoneNumber: otherAccount.phoneNumber,
      phoneNumberNormalized: otherAccount.phoneNormalized,
    },
  });
  return {
    account,
    branchA,
    branchB,
    business,
    membership,
    otherAccount,
    otherBusiness,
    otherMembership,
    owner,
  };
}

async function createLockedTimesheet(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  month: string,
) {
  const periodStart = new Date(`${month}-01T00:00:00.000Z`);
  const timesheet = await prisma.attendanceMonthlyTimesheet.create({
    data: { businessId: fixture.business.id, periodStart },
  });
  const revision = await prisma.attendanceTimesheetRevision.create({
    data: {
      businessId: fixture.business.id,
      lockedById: fixture.owner.id,
      periodStart,
      reason: "Payroll bridge integration fixture.",
      revision: 1,
      sourceDigest: "a".repeat(64),
      timesheetId: timesheet.id,
    },
  });
  await prisma.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });
  return revision;
}

function access(fixture: Awaited<ReturnType<typeof createFixture>>): ResolvedBusinessAccess {
  return {
    actorRole: "BUSINESS_OWNER",
    branchId: fixture.branchA.id,
    businessId: fixture.business.id,
    capability: null,
    effectiveBusinessRole: "BUSINESS_OWNER",
    granted: true,
    groupId: null,
    groupUserId: null,
    homeBusinessId: fixture.business.id,
    identityRole: "BUSINESS_OWNER",
    industryType: "AUTO_DETAILING",
    permissions: [],
    source: "DIRECT_BUSINESS",
    userId: fixture.owner.id,
  };
}

function actor(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return {
    email: fixture.owner.email!,
    name: fixture.owner.name,
    userId: fixture.owner.id,
  };
}

async function writeVersion(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    baseRate: number;
    effectiveFromMonth: Date;
    membershipId?: string;
    payBasis: "MONTHLY" | "DAILY" | "HOURLY";
    reasonNote?: string;
  },
) {
  return prisma.$transaction((transaction) =>
    writeEmployeeCompensationVersionInTransaction(
      {
        actor: actor(fixture),
        authorization: {
          access: access(fixture),
          allowedBranchIds: [fixture.branchA.id, fixture.branchB.id],
        },
        baseRate: input.baseRate,
        businessId: fixture.business.id,
        effectiveFromMonth: input.effectiveFromMonth,
        membershipId: input.membershipId ?? fixture.membership.id,
        payBasis: input.payBasis,
        reasonNote:
          input.reasonNote ?? "Integration test without salary values.",
        reasonType: "OTHER",
        source: "MANUAL",
      },
      transaction,
    ),
  );
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const accountIds = (
    await prisma.employeeBusinessMembership.findMany({
      where: {
        businessId: { in: [fixture.business.id, fixture.otherBusiness.id] },
      },
      select: { employeeAccountId: true },
    })
  ).map((item) => item.employeeAccountId);
  await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT set_config('tetamu.compensation_version_maintenance', 'on', TRUE)`;
    await transaction.$executeRaw`SELECT set_config('tetamu.payroll_profile_command_maintenance', 'on', TRUE)`;
    await transaction.$executeRaw`SELECT set_config('tetamu.attendance_timesheet_test_maintenance', 'on', TRUE)`;
    await transaction.payrollEntry.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.payrollRun.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.attendanceTimesheetRevisionEntry.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.attendanceMonthlyTimesheet.updateMany({
      where: { businessId: fixture.business.id },
      data: { currentRevisionId: null, status: "DRAFT" },
    });
    await transaction.attendanceTimesheetRevision.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.attendanceMonthlyTimesheet.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.auditLog.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.employeeCompensationVersion.deleteMany({
      where: {
        businessId: { in: [fixture.business.id, fixture.otherBusiness.id] },
      },
    });
    await transaction.employeeBusinessMembership.deleteMany({
      where: {
        businessId: { in: [fixture.business.id, fixture.otherBusiness.id] },
      },
    });
    await transaction.employeeAccount.deleteMany({
      where: { id: { in: accountIds } },
    });
    await transaction.user.delete({ where: { id: fixture.owner.id } });
    await transaction.branch.deleteMany({
      where: { businessId: fixture.business.id },
    });
    await transaction.business.deleteMany({
      where: { id: { in: [fixture.business.id, fixture.otherBusiness.id] } },
    });
  });
}

async function createAdditionalMembership(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  payBasis: "DAILY" | "HOURLY",
  baseSalary: number,
) {
  const token = randomUUID();
  const phone = `+602${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await prisma.employeeAccount.create({
    data: { name: `${payBasis} Employee`, phoneNormalized: phone, phoneNumber: phone },
  });
  return prisma.employeeBusinessMembership.create({
    data: {
      baseSalary,
      businessId: fixture.business.id,
      employeeAccountId: account.id,
      employeeCode: `${payBasis.slice(0, 1)}-${token.slice(0, 8)}`,
      fullName: `${payBasis} Employee`,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
      payBasis,
      phoneNumber: phone,
      phoneNumberNormalized: phone,
    },
  });
}
