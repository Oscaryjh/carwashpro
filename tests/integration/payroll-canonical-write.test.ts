import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  scheduleEmployeeCompensationChange,
  updateEmployeePayrollWorkTarget,
  updateEmployeeStatutoryProfile,
  updateEmployeeTaxProfile,
  type PayrollProfileWriteContext,
  PayrollProfileWriteError,
} from "../../src/lib/payroll/employee-profile-write";
import { prisma } from "../../src/lib/prisma";

test("canonical payroll profile commands are idempotent, scoped, concurrent and immutable", async () => {
  const fixture = await createFixture();
  try {
    const currentMonth = monthStart(new Date());
    const futureMonth = addMonths(currentMonth, 2);
    const context = ownerContext(fixture);
    const initialAuditCount = await prisma.auditLog.count({
      where: { businessId: fixture.business.id },
    });

    const compensationCommandId = randomUUID();
    const compensation = await scheduleEmployeeCompensationChange({
      context,
      command: {
        baseRate: "2345.67",
        commandId: compensationCommandId,
        effectiveFromMonth: currentMonth,
        expectedRevision: 0,
        membershipId: fixture.membership.id,
        payBasis: "MONTHLY",
        reasonNote: "Approved correction RM 2,345.67 for employee@example.test and IC 900101-12-3456.",
        reasonType: "SALARY_CORRECTION",
        source: "MANUAL",
      },
    });
    assert.equal(compensation.commandReplay, false);
    assert.equal(compensation.isCurrent, true);
    assert.equal(compensation.newRevision, 1);
    assert.equal(
      (
        await prisma.employeeBusinessMembership.findUniqueOrThrow({
          where: { id: fixture.membership.id },
          select: { baseSalary: true, compensationRevision: true },
        })
      ).baseSalary?.toString(),
      "2345.67",
    );

    const replay = await scheduleEmployeeCompensationChange({
      context,
      command: {
        baseRate: "2345.67",
        commandId: compensationCommandId,
        effectiveFromMonth: currentMonth,
        expectedRevision: 0,
        membershipId: fixture.membership.id,
        payBasis: "MONTHLY",
        reasonNote: "Approved correction RM 2,345.67 for employee@example.test and IC 900101-12-3456.",
        reasonType: "SALARY_CORRECTION",
        source: "MANUAL",
      },
    });
    assert.equal(replay.commandReplay, true);
    assert.equal(replay.newVersionId, compensation.newVersionId);
    assert.equal(
      await prisma.employeeCompensationVersion.count({
        where: { membershipId: fixture.membership.id },
      }),
      1,
    );
    assert.equal(
      await prisma.auditLog.count({ where: { businessId: fixture.business.id } }),
      initialAuditCount + 1,
    );

    await assert.rejects(
      scheduleEmployeeCompensationChange({
        context,
        command: {
          baseRate: "9999",
          commandId: compensationCommandId,
          effectiveFromMonth: currentMonth,
          expectedRevision: 1,
          membershipId: fixture.membership.id,
          payBasis: "MONTHLY",
          reasonType: "SALARY_CORRECTION",
          source: "MANUAL",
        },
      }),
      (error: unknown) => hasCode(error, "DUPLICATE_COMMAND"),
    );

    const concurrentId = randomUUID();
    const concurrentCommand = {
      baseRate: "2600",
      commandId: concurrentId,
      effectiveFromMonth: futureMonth,
      expectedRevision: 1,
      membershipId: fixture.membership.id,
      payBasis: "MONTHLY" as const,
      reasonType: "ANNUAL_INCREMENT" as const,
      source: "MANUAL" as const,
    };
    const concurrent = await Promise.all([
      scheduleEmployeeCompensationChange({ context, command: concurrentCommand }),
      scheduleEmployeeCompensationChange({ context, command: concurrentCommand }),
    ]);
    assert.equal(concurrent.filter((result) => result.commandReplay).length, 1);
    assert.equal(concurrent[0].newVersionId, concurrent[1].newVersionId);
    assert.equal(
      await prisma.employeeCompensationVersion.count({
        where: {
          effectiveFromMonth: futureMonth,
          membershipId: fixture.membership.id,
          status: "ACTIVE",
        },
      }),
      1,
    );
    const afterFuture = await prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: fixture.membership.id },
      select: { baseSalary: true, compensationRevision: true },
    });
    assert.equal(afterFuture.baseSalary?.toString(), "2345.67");
    assert.equal(afterFuture.compensationRevision, 2);
    await assert.rejects(
      scheduleEmployeeCompensationChange({
        context,
        command: {
          ...concurrentCommand,
          commandId: randomUUID(),
          expectedRevision: 1,
        },
      }),
      (error: unknown) => hasCode(error, "CONFLICT"),
    );

    const runStateBefore = await snapshotRunState(fixture.business.id);
    const attendanceCountBefore = await prisma.employeeAttendance.count({
      where: { businessId: fixture.business.id },
    });
    const workTarget = await updateEmployeePayrollWorkTarget({
      context,
      command: {
        commandId: randomUUID(),
        expectedRevision: 0,
        membershipId: fixture.membership.id,
        normalWorkMinutesPerDay: 480,
        reasonType: "PAYROLL_POLICY_CHANGE",
        targetBreakMinutes: 60,
      },
    });
    assert.equal(workTarget.affectedDrafts, 1);
    assert.equal(workTarget.newRevision, 1);
    await assert.rejects(
      updateEmployeePayrollWorkTarget({
        context,
        command: {
          commandId: randomUUID(),
          expectedRevision: 0,
          membershipId: fixture.membership.id,
          normalWorkMinutesPerDay: 420,
          reasonType: "PAYROLL_POLICY_CHANGE",
          targetBreakMinutes: 45,
        },
      }),
      (error: unknown) => hasCode(error, "CONFLICT"),
    );
    const cleared = await updateEmployeePayrollWorkTarget({
      context,
      command: {
        commandId: randomUUID(),
        expectedRevision: 1,
        membershipId: fixture.membership.id,
        normalWorkMinutesPerDay: null,
        reasonNote: "Employee override removed; future drafts use company policy.",
        reasonType: "PAYROLL_POLICY_CHANGE",
        targetBreakMinutes: null,
      },
    });
    assert.equal(cleared.normalWorkMinutesPerDay, null);
    assert.equal(cleared.targetBreakMinutes, null);

    const artifactBefore = await prisma.payrollStatutoryExportArtifact.findUniqueOrThrow({
      where: { id: fixture.artifact.id },
      select: { ciphertext: true, plaintextSha256: true },
    });
    const submissionBefore = await prisma.payrollStatutorySubmission.findUniqueOrThrow({
      where: { id: fixture.submission.id },
      select: { status: true, updatedAt: true },
    });
    const taxBefore = await prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: fixture.membership.id },
      select: {
        epfMemberNumber: true,
        statutoryIdentityNumber: true,
        taxIdentificationNumber: true,
      },
    });
    const statutory = await updateEmployeeStatutoryProfile({
      context,
      command: {
        commandId: randomUUID(),
        eisEnabled: true,
        eisPreviouslyContributed: false,
        epfEnabled: true,
        epfMemberBeforeAug1998: false,
        expectedRevision: 0,
        lindung24OptIn: false,
        membershipId: fixture.membership.id,
        reasonType: "STATUTORY_CORRECTION",
        socsoCategory: "FIRST",
        socsoEnabled: true,
        statutoryNationality: "MALAYSIAN",
      },
    });
    assert.equal(statutory.existingArtifactWarning, true);
    assert.equal(statutory.newRevision, 1);
    assert.deepEqual(
      await prisma.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: fixture.membership.id },
        select: {
          epfMemberNumber: true,
          statutoryIdentityNumber: true,
          taxIdentificationNumber: true,
        },
      }),
      taxBefore,
    );
    await assert.rejects(
      updateEmployeeStatutoryProfile({
        context,
        command: {
          commandId: randomUUID(),
          eisEnabled: false,
          eisPreviouslyContributed: false,
          epfEnabled: false,
          epfMemberBeforeAug1998: false,
          expectedRevision: 0,
          lindung24OptIn: false,
          membershipId: fixture.membership.id,
          reasonType: "STATUTORY_CORRECTION",
          socsoCategory: null,
          socsoEnabled: false,
          statutoryNationality: null,
        },
      }),
      (error: unknown) => hasCode(error, "CONFLICT"),
    );

    const enrollmentBefore = await prisma.employeeBusinessMembership.findUniqueOrThrow({
      where: { id: fixture.membership.id },
      select: { eisEnabled: true, epfEnabled: true, socsoEnabled: true },
    });
    const fullIdentity = "991122-12-3456";
    const fullTin = "TIN99887766";
    const tax = await updateEmployeeTaxProfile({
      context,
      command: {
        commandId: randomUUID(),
        epfMemberNumber: "EPF12345678",
        expectedRevision: 0,
        membershipId: fixture.membership.id,
        reasonNote: `Employee provided ${fullIdentity}, ${fullTin}, person@example.test and RM 1,234.56.`,
        reasonType: "EMPLOYEE_PROVIDED_CORRECTION",
        socsoMemberNumber: "SOCSO123456",
        statutoryCountryCode: "MY",
        statutoryIdentityNumber: fullIdentity,
        statutoryIdentityType: "NEW_IC",
        taxIdentificationNumber: fullTin,
      },
    });
    assert.equal(tax.newRevision, 1);
    assert.ok(tax.masked.statutoryIdentityNumber?.endsWith("3456"));
    assert.ok(tax.masked.taxIdentificationNumber?.endsWith("7766"));
    assert.doesNotMatch(JSON.stringify(tax), new RegExp(fullIdentity));
    assert.doesNotMatch(JSON.stringify(tax), new RegExp(fullTin));
    assert.deepEqual(
      await prisma.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: fixture.membership.id },
        select: { eisEnabled: true, epfEnabled: true, socsoEnabled: true },
      }),
      enrollmentBefore,
    );
    await assert.rejects(
      updateEmployeeTaxProfile({
        context,
        command: {
          commandId: randomUUID(),
          epfMemberNumber: null,
          expectedRevision: 0,
          membershipId: fixture.membership.id,
          reasonType: "TAX_INFORMATION_UPDATE",
          socsoMemberNumber: null,
          statutoryCountryCode: null,
          statutoryIdentityNumber: null,
          statutoryIdentityType: null,
          taxIdentificationNumber: null,
        },
      }),
      (error: unknown) => hasCode(error, "CONFLICT"),
    );

    assert.deepEqual(await snapshotRunState(fixture.business.id), runStateBefore);
    assert.equal(
      await prisma.employeeAttendance.count({ where: { businessId: fixture.business.id } }),
      attendanceCountBefore,
    );
    assert.deepEqual(
      await prisma.payrollStatutoryExportArtifact.findUniqueOrThrow({
        where: { id: fixture.artifact.id },
        select: { ciphertext: true, plaintextSha256: true },
      }),
      artifactBefore,
    );
    assert.deepEqual(
      await prisma.payrollStatutorySubmission.findUniqueOrThrow({
        where: { id: fixture.submission.id },
        select: { status: true, updatedAt: true },
      }),
      submissionBefore,
    );

    const auditText = JSON.stringify(
      await prisma.auditLog.findMany({
        where: { businessId: fixture.business.id },
        select: { after: true, before: true, metadata: true },
      }),
    );
    assert.doesNotMatch(auditText, /2345\.67|2600|991122-12-3456|TIN99887766|EPF12345678|SOCSO123456|person@example\.test/);
    assert.match(auditText, /REDACTED/);

    const rollbackCommandId = randomUUID();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION tetamu_test_fail_canonical_audit()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = 'EMPLOYEE_PAYROLL_WORK_TARGET_COMMAND_APPLIED' THEN
          RAISE EXCEPTION 'forced canonical audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "tetamu_test_fail_canonical_audit_trigger"
      BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION tetamu_test_fail_canonical_audit()
    `);
    try {
      await assert.rejects(
        updateEmployeePayrollWorkTarget({
          context,
          command: {
            commandId: rollbackCommandId,
            expectedRevision: 2,
            membershipId: fixture.membership.id,
            normalWorkMinutesPerDay: 420,
            reasonType: "PAYROLL_POLICY_CHANGE",
            targetBreakMinutes: 30,
          },
        }),
        (error: unknown) => hasCode(error, "AUDIT_FAILED"),
      );
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS "tetamu_test_fail_canonical_audit_trigger" ON "audit_logs"`,
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS tetamu_test_fail_canonical_audit()",
      );
    }
    assert.deepEqual(
      await prisma.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: fixture.membership.id },
        select: {
          normalWorkMinutesPerDay: true,
          targetBreakMinutes: true,
          workTargetRevision: true,
        },
      }),
      {
        normalWorkMinutesPerDay: null,
        targetBreakMinutes: null,
        workTargetRevision: 2,
      },
    );
    assert.equal(
      await prisma.payrollProfileCommandRecord.count({
        where: { commandId: rollbackCommandId },
      }),
      0,
    );

    await assertDeniedScenarios(fixture, context);
    await assert.rejects(
      prisma.employeeBusinessMembership.update({
        where: { id: fixture.membership.id },
        data: { targetBreakMinutes: 30 },
      }),
      /canonical command service/i,
    );
    const commandRecord = await prisma.payrollProfileCommandRecord.findFirstOrThrow({
      where: { businessId: fixture.business.id },
    });
    await assert.rejects(
      prisma.payrollProfileCommandRecord.update({
        where: { id: commandRecord.id },
        data: { commandId: randomUUID() },
      }),
      /append-only/i,
    );
    await assert.rejects(
      prisma.payrollProfileCommandRecord.delete({ where: { id: commandRecord.id } }),
      /append-only/i,
    );
  } finally {
    // The embedded PostgreSQL database is disposable. Immutable artifacts,
    // compensation versions, audits and command records are intentionally not
    // bypassed or deleted by the test process.
  }
});

async function assertDeniedScenarios(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  context: PayrollProfileWriteContext,
) {
  const baseCommand = {
    commandId: randomUUID(),
    expectedRevision: 2,
    membershipId: fixture.membership.id,
    normalWorkMinutesPerDay: 480,
    reasonType: "PAYROLL_POLICY_CHANGE" as const,
    targetBreakMinutes: 60,
  };
  await assert.rejects(
    updateEmployeePayrollWorkTarget({
      context: { ...context, allowedBranchIds: [fixture.branchA.id] },
      command: baseCommand,
    }),
    (error: unknown) => hasCode(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    updateEmployeePayrollWorkTarget({
      context: {
        ...context,
        access: {
          ...(context.access as Extract<ResolvedBusinessAccess, { granted: true }>),
          actorRole: "GROUP_MANAGER",
          effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY",
          source: "GROUP_ACCESS",
        },
      },
      command: { ...baseCommand, commandId: randomUUID() },
    }),
    (error: unknown) => hasCode(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    updateEmployeePayrollWorkTarget({
      context: {
        ...context,
        access: {
          ...(context.access as Extract<ResolvedBusinessAccess, { granted: true }>),
          effectiveBusinessRole: "STAFF",
          identityRole: "STAFF",
          permissions: ["ALL_BRANCHES"],
        },
      },
      command: { ...baseCommand, commandId: randomUUID() },
    }),
    (error: unknown) => hasCode(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    updateEmployeePayrollWorkTarget({
      context,
      command: {
        ...baseCommand,
        commandId: randomUUID(),
        membershipId: fixture.otherMembership.id,
      },
    }),
    (error: unknown) => hasCode(error, "NOT_FOUND"),
  );
}

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: {
      name: `Canonical ${token}`,
      slug: `canonical-${token}`,
      timezone: "Asia/Kuching",
    },
  });
  const otherBusiness = await prisma.business.create({
    data: { name: `Canonical Other ${token}`, slug: `canonical-other-${token}` },
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
      email: `canonical-owner-${token}@test.local`,
      name: "Canonical Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+601${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const account = await prisma.employeeAccount.create({
    data: { name: "Canonical Employee", phoneNormalized: phone, phoneNumber: phone },
  });
  const membership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: business.id,
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      employeeAccountId: account.id,
      employeeCode: `CAN-${token.slice(0, 8)}`,
      epfMemberNumber: "OLD-EPF-0001",
      fullName: "Canonical Employee",
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      statutoryIdentityNumber: "OLD-IC-0001",
      statutoryIdentityType: "OTHER",
      taxIdentificationNumber: "OLD-TIN-0001",
    },
  });
  await prisma.employeeBranchAssignment.create({
    data: {
      branchId: branchA.id,
      businessId: business.id,
      isPrimary: true,
      membershipId: membership.id,
    },
  });
  const otherPhone = `+609${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "0")}`;
  const otherAccount = await prisma.employeeAccount.create({
    data: { name: "Other Employee", phoneNormalized: otherPhone, phoneNumber: otherPhone },
  });
  const otherMembership = await prisma.employeeBusinessMembership.create({
    data: {
      businessId: otherBusiness.id,
      employeeAccountId: otherAccount.id,
      employeeCode: `OTH-${token.slice(0, 8)}`,
      fullName: "Other Employee",
      phoneNumber: otherPhone,
      phoneNumberNormalized: otherPhone,
    },
  });

  const runs = [];
  for (const [index, status] of (["DRAFT", "REVIEW", "FINALIZED"] as const).entries()) {
    const periodStart = new Date(Date.UTC(2024, index, 1));
    const periodEnd = new Date(Date.UTC(2024, index + 1, 1));
    const run = await prisma.payrollRun.create({
      data: {
        attendanceSource: "LEGACY_OPERATIONAL_SESSION",
        businessId: business.id,
        breakMinutesPerDaySnapshot: 60,
        normalWorkMinutesPerDaySnapshot: 480,
        overtimeMultiplierSnapshot: "1.50",
        periodEnd,
        periodStart,
        publicHolidayExtraMultiplierSnapshot: "2.00",
        status: "DRAFT",
        workingDaysPerMonthSnapshot: 26,
      },
    });
    await prisma.payrollEntry.create({
      data: {
        baseRateSnapshot: "1000.00",
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
    let completedRun = run;
    if (status === "REVIEW" || status === "FINALIZED") {
      completedRun = await prisma.payrollRun.update({
        where: { id: run.id },
        data: {
          status: "REVIEW",
          submittedAt: new Date(),
          submittedById: owner.id,
        },
      });
    }
    if (status === "FINALIZED") {
      completedRun = await prisma.payrollRun.update({
        where: { id: run.id },
        data: {
          finalizedAt: new Date(),
          finalizedById: owner.id,
          status: "FINALIZED",
        },
      });
    }
    runs.push(completedRun);
  }
  const submission = await prisma.payrollStatutorySubmission.create({
    data: {
      businessId: business.id,
      exportVersion: "integration-v1",
      integrityStatus: "VERIFIED",
      payrollRunId: runs[2].id,
      provider: "EPF",
      status: "EXPORTED",
    },
  });
  const artifact = await prisma.payrollStatutoryExportArtifact.create({
    data: {
      authenticationTag: Buffer.alloc(16, 2),
      businessId: business.id,
      byteLength: 16,
      ciphertext: Buffer.from("encrypted-bytes"),
      contentType: "text/csv",
      createdById: owner.id,
      encryptionKeyVersion: "integration-v1",
      exportVersion: "integration-v1",
      fileName: "retained.csv",
      initializationVector: Buffer.alloc(12, 1),
      payrollRunId: runs[2].id,
      plaintextSha256: "a".repeat(64),
      provider: "EPF",
      revision: 1,
      submissionId: submission.id,
    },
  });
  return {
    account,
    artifact,
    branchA,
    branchB,
    business,
    membership,
    otherAccount,
    otherBusiness,
    otherMembership,
    owner,
    submission,
  };
}

function ownerContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): PayrollProfileWriteContext {
  const access: ResolvedBusinessAccess = {
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
  return {
    access,
    actor: {
      email: fixture.owner.email!,
      name: fixture.owner.name,
      userId: fixture.owner.id,
    },
    allowedBranchIds: [fixture.branchA.id, fixture.branchB.id],
    businessId: fixture.business.id,
    caller: "SYSTEM",
    request: { ipAddress: "127.0.0.1", userAgent: "integration-test" },
  };
}

async function snapshotRunState(businessId: string) {
  const [runs, entries, artifacts, submissions] = await Promise.all([
    prisma.payrollRun.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
      select: { id: true, status: true, updatedAt: true },
    }),
    prisma.payrollEntry.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
      select: { id: true, updatedAt: true },
    }),
    prisma.payrollStatutoryExportArtifact.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
      select: { id: true, plaintextSha256: true },
    }),
    prisma.payrollStatutorySubmission.findMany({
      where: { businessId },
      orderBy: { id: "asc" },
      select: { id: true, status: true, updatedAt: true },
    }),
  ]);
  return { artifacts, entries, runs, submissions };
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function hasCode(error: unknown, code: string) {
  return error instanceof PayrollProfileWriteError && error.code === code;
}
