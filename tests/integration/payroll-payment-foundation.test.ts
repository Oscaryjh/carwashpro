import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import type { UserRole } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import {
  approvePayrollPaymentBatch,
  cancelPayrollPaymentBatch,
  createCorrectionPaymentBatch,
  createEmployeeBankVersion,
  createInternalTestPaymentArtifact,
  createPayrollPaymentBatch,
  deactivateEmployeeBankVersion,
  decryptInternalTestPaymentArtifact,
  evaluatePayrollPaymentReadiness,
  PayrollPaymentError,
  submitPayrollPaymentBatch,
  verifyEmployeeBankVersion,
  type PayrollPaymentContext,
} from "../../src/lib/payroll/payment";
import { reopenPayrollRun } from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

Object.assign(process.env, { NODE_ENV: "test" });
process.env.PAYROLL_PAYMENT_ACTIVE_KEY_VERSION = "integration-v1";
process.env.PAYROLL_PAYMENT_ENCRYPTION_KEYS = JSON.stringify({
  "integration-v1": randomBytes(32).toString("base64"),
});
process.env.PAYROLL_PAYMENT_FINGERPRINT_KEY = randomBytes(32).toString("hex");

test("Payment P0 bank, readiness, batch, artifact, guards and rollback are integrated", async () => {
  const fixture = await createFixture();
  const owner = paymentContext(fixture, fixture.owner, []);
  const approver = paymentContext(fixture, fixture.approver, [
    "ALL_BRANCHES",
    "PAYROLL_READ",
    "VIEW_PAYMENT_BATCH",
    "APPROVE_PAYMENT_BATCH",
  ]);

  const firstCommandId = randomUUID();
  const firstBank = await createEmployeeBankVersion(owner, {
    accountHolderName: fixture.readyMembership.fullName,
    accountNumber: "1234-5678-9012",
    bankCode: "MAY-BANK",
    bankName: "Maybank",
    commandId: firstCommandId,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    expectedRevision: 0,
    membershipId: fixture.readyMembership.id,
    reason: "Initial verified salary account for Payment P0 integration.",
    reasonType: "INITIAL_SETUP",
  });
  assert.equal(firstBank.commandReplay, false);
  assert.equal(firstBank.last4, "9012");

  const replay = await createEmployeeBankVersion(owner, {
    accountHolderName: fixture.readyMembership.fullName,
    accountNumber: "1234-5678-9012",
    bankCode: "MAY-BANK",
    bankName: "Maybank",
    commandId: firstCommandId,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    expectedRevision: 0,
    membershipId: fixture.readyMembership.id,
    reason: "Initial verified salary account for Payment P0 integration.",
    reasonType: "INITIAL_SETUP",
  });
  assert.equal(replay.commandReplay, true);
  assert.equal(replay.bankAccountVersionId, firstBank.bankAccountVersionId);
  await assert.rejects(
    createEmployeeBankVersion(owner, {
      accountHolderName: fixture.readyMembership.fullName,
      accountNumber: "9999999999",
      bankCode: "MAYBANK",
      bankName: "Maybank",
      commandId: firstCommandId,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      expectedRevision: 0,
      membershipId: fixture.readyMembership.id,
      reason: "Different payload must not replay the first payment command.",
      reasonType: "INITIAL_SETUP",
    }),
    (error: unknown) => paymentError(error, "DUPLICATE_COMMAND"),
  );

  await verifyEmployeeBankVersion(owner, {
    bankAccountVersionId: firstBank.bankAccountVersionId,
    commandId: randomUUID(),
    expectedRevision: 1,
    membershipId: fixture.readyMembership.id,
    reason: "Account ownership checked manually against the Testing fixture.",
    reasonType: "MANUAL_VERIFICATION",
  });

  const futureBank = await createEmployeeBankVersion(owner, {
    accountHolderName: fixture.readyMembership.fullName,
    accountNumber: "5555-6666-7777",
    bankCode: "CIMB",
    bankName: "CIMB Bank",
    commandId: randomUUID(),
    effectiveFrom: new Date("2026-10-01T00:00:00.000Z"),
    expectedRevision: 1,
    membershipId: fixture.readyMembership.id,
    reason: "Future salary account becomes effective after the August payroll.",
    reasonType: "ACCOUNT_CHANGE",
  });
  assert.equal(futureBank.revision, 2);
  const historical = await prisma.employeeBankAccountVersion.findUniqueOrThrow({
    where: { id: firstBank.bankAccountVersionId },
  });
  assert.equal(historical.status, "SUPERSEDED");
  assert.equal(historical.effectiveUntil?.toISOString(), "2026-10-01T00:00:00.000Z");

  await assert.rejects(
    prisma.employeeBankAccountVersion.update({
      where: { id: firstBank.bankAccountVersionId },
      data: { accountHolderName: "Tampered Name" },
    }),
    /immutable/i,
  );
  await assert.rejects(
    prisma.employeeBankAccountVersion.delete({
      where: { id: firstBank.bankAccountVersionId },
    }),
    /append-only/i,
  );

  await assert.rejects(
    createEmployeeBankVersion(
      { ...owner, allowedBranchIds: [fixture.branchA.id] },
      {
        accountHolderName: fixture.missingMembership.fullName,
        accountNumber: "888899990000",
        bankCode: "HLB",
        bankName: "Hong Leong Bank",
        commandId: randomUUID(),
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        expectedRevision: 0,
        membershipId: fixture.missingMembership.id,
        reason: "Branch-limited actors must not maintain payroll bank data.",
        reasonType: "INITIAL_SETUP",
      },
    ),
    (error: unknown) => paymentError(error, "ACCESS_DENIED"),
  );
  await assert.rejects(
    createEmployeeBankVersion(owner, {
      accountHolderName: fixture.otherMembership.fullName,
      accountNumber: "888899990000",
      bankCode: "HLB",
      bankName: "Hong Leong Bank",
      commandId: randomUUID(),
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      expectedRevision: 0,
      membershipId: fixture.otherMembership.id,
      reason: "Cross-business bank writes must be hidden as not found.",
      reasonType: "INITIAL_SETUP",
    }),
    (error: unknown) => paymentError(error, "NOT_FOUND"),
  );

  const ready = await evaluatePayrollPaymentReadiness(owner, fixture.readyRun.id);
  assert.deepEqual(
    {
      blocked: ready.blockedCount,
      entries: ready.entryCount,
      excluded: ready.excludedCount,
      ready: ready.readyCount,
      total: ready.totalReadyAmount,
    },
    { blocked: 0, entries: 1, excluded: 0, ready: 1, total: "2500.00" },
  );
  assert.match(ready.calculationDigest, /^[0-9a-f]{64}$/);

  const blocked = await evaluatePayrollPaymentReadiness(owner, fixture.blockedRun.id);
  assert.equal(blocked.blockedCount, 1);
  assert.equal(blocked.excludedCount, 1);
  assert.equal(blocked.blockerCounts.MISSING_BANK_ACCOUNT, 1);
  assert.equal(blocked.totalReadyAmount, "0.00");
  await assert.rejects(
    evaluatePayrollPaymentReadiness(owner, fixture.draftRun.id),
    (error: unknown) => paymentError(error, "VALIDATION_ERROR"),
  );

  const blockedBatch = await createPayrollPaymentBatch(owner, {
    commandId: randomUUID(),
    expectedRevision: 0,
    payrollRunId: fixture.blockedRun.id,
    reason: "Create a draft so blockers remain visible instead of being skipped.",
    reasonType: "MONTHLY_PAYROLL",
  });
  assert.equal(blockedBatch.blockedCount, 1);
  await assert.rejects(
    submitPayrollPaymentBatch(owner, {
      commandId: randomUUID(),
      expectedRevision: blockedBatch.revision,
      paymentBatchId: blockedBatch.paymentBatchId,
      reason: "Blocked batch must not advance to maker-checker approval.",
      reasonType: "MONTHLY_PAYROLL",
    }),
    (error: unknown) => paymentError(error, "BLOCKED"),
  );

  const readyBatch = await createPayrollPaymentBatch(owner, {
    commandId: randomUUID(),
    expectedRevision: 0,
    payrollRunId: fixture.readyRun.id,
    reason: "Create the August salary transfer instruction foundation.",
    reasonType: "MONTHLY_PAYROLL",
  });
  await assert.rejects(
    createPayrollPaymentBatch(owner, {
      commandId: randomUUID(),
      expectedRevision: 0,
      payrollRunId: fixture.readyRun.id,
      reason: "A finalized run may only have one active payment batch.",
      reasonType: "MONTHLY_PAYROLL",
    }),
    (error: unknown) => paymentError(error, "CONFLICT"),
  );
  const instructionBeforeBankChange =
    await prisma.payrollPaymentInstruction.findFirstOrThrow({
      where: { paymentBatchId: readyBatch.paymentBatchId },
    });
  assert.equal(instructionBeforeBankChange.bankAccountVersionId, firstBank.bankAccountVersionId);
  assert.equal(instructionBeforeBankChange.accountNumberLast4Snapshot, "9012");
  assert.equal(instructionBeforeBankChange.netPaySnapshot.toString(), "2500");

  const submitted = await submitPayrollPaymentBatch(owner, {
    commandId: randomUUID(),
    expectedRevision: readyBatch.revision,
    paymentBatchId: readyBatch.paymentBatchId,
    reason: "Submit the deterministic payment instructions for independent approval.",
    reasonType: "MONTHLY_PAYROLL",
  });
  assert.equal(submitted.workflowStatus, "AWAITING_APPROVAL");
  await assert.rejects(
    approvePayrollPaymentBatch(owner, {
      commandId: randomUUID(),
      expectedRevision: submitted.revision,
      paymentBatchId: submitted.paymentBatchId,
      reason: "The batch creator must never approve the same payment batch.",
      reasonType: "MONTHLY_PAYROLL",
    }),
    (error: unknown) => paymentError(error, "ACCESS_DENIED"),
  );
  const approved = await approvePayrollPaymentBatch(approver, {
    commandId: randomUUID(),
    expectedRevision: submitted.revision,
    paymentBatchId: submitted.paymentBatchId,
    reason: "Independent approver checked the finalized payroll instructions.",
    reasonType: "MONTHLY_PAYROLL",
  });
  assert.equal(approved.workflowStatus, "APPROVED");
  const mixedEntry = await prisma.payrollEntry.findFirstOrThrow({
    where: { payrollRunId: fixture.blockedRun.id },
  });
  await assert.rejects(
    prisma.payrollPaymentInstruction.create({
      data: {
        accountHolderNameSnapshot: null,
        accountNumberLast4Snapshot: null,
        bankCodeSnapshot: null,
        bankNameSnapshot: null,
        blockerCode: "MISSING_BANK_ACCOUNT",
        businessId: fixture.business.id,
        employeeCodeSnapshot: mixedEntry.employeeCodeSnapshot,
        employeeMembershipId: mixedEntry.membershipId,
        employeeNameSnapshot: mixedEntry.fullNameSnapshot,
        netPaySnapshot: mixedEntry.netPay,
        paymentBatchId: approved.paymentBatchId,
        payrollEntryId: mixedEntry.id,
        reference: "MIXED-RUN-PROBE",
        status: "BLOCKED",
      },
    }),
    /identity does not match/i,
  );
  await assert.rejects(
    cancelPayrollPaymentBatch(owner, {
      commandId: randomUUID(),
      expectedRevision: approved.revision,
      paymentBatchId: approved.paymentBatchId,
      reason: "Approved instructions cannot be cancelled through the draft workflow.",
      reasonType: "MONTHLY_PAYROLL",
    }),
    (error: unknown) => paymentError(error, "IMMUTABLE_HISTORY"),
  );

  const bytes = Buffer.from("P0 internal exact bytes\r\n", "utf8");
  const artifactResult = await createInternalTestPaymentArtifact(
    owner,
    {
      allowInternalTestArtifact: true,
      bytes,
      filename: "internal-p0.bin",
      paymentBatchId: approved.paymentBatchId,
      recordCount: 1,
    },
  );
  const artifact = await prisma.payrollPaymentArtifact.findUniqueOrThrow({
    where: { id: artifactResult.artifactId },
  });
  assert.deepEqual(
    await decryptInternalTestPaymentArtifact(
      {
        artifactId: artifact.id,
        authTag: artifact.authTag,
        businessId: artifact.businessId,
        ciphertext: artifact.ciphertext,
        encryptionKeyVersion: artifact.encryptionKeyVersion,
        formatVersion: artifact.formatVersion,
        iv: artifact.iv,
        paymentBatchId: artifact.paymentBatchId,
        providerKey: artifact.providerKey,
        revision: artifact.revision,
        sha256: artifact.sha256,
      },
      process.env,
    ),
    bytes,
  );
  const deactivated = await deactivateEmployeeBankVersion(owner, {
    bankAccountVersionId: futureBank.bankAccountVersionId,
    commandId: randomUUID(),
    expectedRevision: futureBank.revision,
    membershipId: fixture.readyMembership.id,
    reason: "Deactivate the future account without altering retained instructions.",
    reasonType: "ACCOUNT_DEACTIVATED",
  });
  assert.equal(deactivated.status, "SUCCESS");
  assert.equal(
    (
      await prisma.employeeBankAccountVersion.findUniqueOrThrow({
        where: { id: futureBank.bankAccountVersionId },
      })
    ).status,
    "INACTIVE",
  );
  assert.equal(
    (
      await prisma.payrollPaymentInstruction.findUniqueOrThrow({
        where: { id: instructionBeforeBankChange.id },
      })
    ).accountNumberLast4Snapshot,
    "9012",
  );
  await assert.rejects(
    prisma.payrollPaymentArtifact.update({
      where: { id: artifact.id },
      data: { filename: "tampered.bin" },
    }),
    /append-only/i,
  );
  await assert.rejects(
    prisma.payrollPaymentArtifact.delete({ where: { id: artifact.id } }),
    /append-only/i,
  );
  await assert.rejects(
    reopenPayrollRun({
      actor: owner.actor,
      businessId: fixture.business.id,
      reason: "Approved payment instructions must keep finalized payroll immutable.",
      runId: fixture.readyRun.id,
    }),
    /approved payment instruction/i,
  );

  const cancelled = await cancelPayrollPaymentBatch(owner, {
    commandId: randomUUID(),
    expectedRevision: blockedBatch.revision,
    paymentBatchId: blockedBatch.paymentBatchId,
    reason: "Cancel the blocked draft before creating a correction revision.",
    reasonType: "MONTHLY_PAYROLL",
  });
  assert.equal(cancelled.workflowStatus, "CANCELLED");
  const correction = await createCorrectionPaymentBatch(owner, {
    commandId: randomUUID(),
    expectedRevision: cancelled.revision,
    reason: "Create an append-only correction revision from the cancelled draft.",
    reasonType: "CORRECTION",
    supersedesBatchId: cancelled.paymentBatchId,
  });
  assert.equal(correction.revision, 2);
  const originalAfterCorrection = await prisma.payrollPaymentBatch.findUniqueOrThrow({
    where: { id: cancelled.paymentBatchId },
  });
  assert.equal(originalAfterCorrection.supersededById, correction.paymentBatchId);

  const event = await prisma.payrollPaymentEvent.findFirstOrThrow({
    where: { batchId: readyBatch.paymentBatchId },
  });
  await assert.rejects(
    prisma.payrollPaymentEvent.update({
      where: { id: event.id },
      data: { reasonType: "TAMPERED" },
    }),
    /append-only/i,
  );
  const commandRecord = await prisma.payrollPaymentCommandRecord.findFirstOrThrow({
    where: { businessId: fixture.business.id },
  });
  await assert.rejects(
    prisma.payrollPaymentCommandRecord.delete({ where: { id: commandRecord.id } }),
    /append-only/i,
  );

  const auditText = JSON.stringify(
    await prisma.auditLog.findMany({ where: { businessId: fixture.business.id } }),
  );
  assert.doesNotMatch(auditText, /123456789012|555566667777|accountNumberCiphertext|authTag|fingerprintHmac/i);

  const rollbackMembership = await createMembership(
    fixture.business.id,
    "ROLLBACK",
    `+6011${randomUUID().replace(/\D/g, "").slice(0, 8).padEnd(8, "9")}`,
  );
  const rollbackCommandId = randomUUID();
  const rollbackBatchRun = await createRun(
    fixture.business.id,
    fixture.owner.id,
    10,
    [[fixture.readyMembership, "2750.00"]],
  );
  const rollbackBatchCommandId = randomUUID();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION tetamu_test_fail_payment_audit() RETURNS trigger AS $$
    BEGIN
      IF NEW.action IN ('EMPLOYEE_BANK_VERSION_CREATED', 'PAYROLL_PAYMENT_BATCH_CREATED') THEN
        RAISE EXCEPTION 'Payment audit failure probe';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER tetamu_test_fail_payment_audit_trigger
    BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION tetamu_test_fail_payment_audit();
  `);
  try {
    await assert.rejects(
      createEmployeeBankVersion(owner, {
        accountHolderName: rollbackMembership.fullName,
        accountNumber: "777788889999",
        bankCode: "RHB",
        bankName: "RHB Bank",
        commandId: rollbackCommandId,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        expectedRevision: 0,
        membershipId: rollbackMembership.id,
        reason: "Audit failure must roll back the entire sensitive bank command.",
        reasonType: "INITIAL_SETUP",
      }),
      /Payment audit failure probe/,
    );
    await assert.rejects(
      createPayrollPaymentBatch(owner, {
        commandId: rollbackBatchCommandId,
        expectedRevision: 0,
        payrollRunId: rollbackBatchRun.id,
        reason: "Audit failure must roll back the batch, instructions, events, and command record.",
        reasonType: "MONTHLY_PAYROLL",
      }),
      /Payment audit failure probe/,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS tetamu_test_fail_payment_audit_trigger ON audit_logs",
    );
    await prisma.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS tetamu_test_fail_payment_audit()",
    );
  }
  assert.equal(
    await prisma.employeeBankAccountVersion.count({
      where: { employeeMembershipId: rollbackMembership.id },
    }),
    0,
  );
  assert.equal(
    await prisma.payrollPaymentCommandRecord.count({
      where: { commandId: rollbackCommandId },
    }),
    0,
  );
  assert.equal(
    await prisma.payrollPaymentBatch.count({
      where: { payrollRunId: rollbackBatchRun.id },
    }),
    0,
  );
  assert.equal(
    await prisma.payrollPaymentCommandRecord.count({
      where: { commandId: rollbackBatchCommandId },
    }),
    0,
  );
});

async function createFixture() {
  const token = randomUUID();
  const business = await prisma.business.create({
    data: {
      name: `Payment P0 ${token}`,
      slug: `payment-p0-${token}`,
      timezone: "Asia/Kuching",
    },
  });
  const otherBusiness = await prisma.business.create({
    data: {
      name: `Payment P0 Other ${token}`,
      slug: `payment-p0-other-${token}`,
    },
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
      email: `payment-owner-${token}@test.local`,
      name: "Payment Owner",
      role: "BUSINESS_OWNER",
    },
  });
  const approver = await prisma.user.create({
    data: {
      branchId: branchA.id,
      businessId: business.id,
      email: `payment-approver-${token}@test.local`,
      name: "Payment Approver",
      permissions: [
        "ALL_BRANCHES",
        "PAYROLL_READ",
        "VIEW_PAYMENT_BATCH",
        "APPROVE_PAYMENT_BATCH",
      ],
      role: "STAFF",
    },
  });
  const readyMembership = await createMembership(
    business.id,
    "READY",
    `+6011${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "1")}`,
  );
  const missingMembership = await createMembership(
    business.id,
    "MISSING",
    `+6012${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "2")}`,
  );
  const zeroMembership = await createMembership(
    business.id,
    "ZERO",
    `+6014${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "4")}`,
  );
  const otherMembership = await createMembership(
    otherBusiness.id,
    "OTHER",
    `+6015${token.replace(/\D/g, "").slice(0, 8).padEnd(8, "5")}`,
  );

  const readyRun = await createRun(business.id, owner.id, 7, [
    [readyMembership, "2500.00"],
  ]);
  const blockedRun = await createRun(business.id, owner.id, 8, [
    [missingMembership, "1800.00"],
    [zeroMembership, "0.00"],
  ]);
  const draftRun = await createRun(
    business.id,
    owner.id,
    9,
    [[readyMembership, "2600.00"]],
    false,
  );
  return {
    approver,
    blockedRun,
    branchA,
    branchB,
    business,
    draftRun,
    missingMembership,
    otherMembership,
    owner,
    readyMembership,
    readyRun,
  };
}

async function createMembership(
  businessId: string,
  code: string,
  phone: string,
) {
  const account = await prisma.employeeAccount.create({
    data: { name: `Payment ${code}`, phoneNormalized: phone, phoneNumber: phone },
  });
  return prisma.employeeBusinessMembership.create({
    data: {
      businessId,
      employeeAccountId: account.id,
      employeeCode: `PAY-${code}-${randomUUID().slice(0, 5)}`,
      fullName: `Payment ${code}`,
      joinedAt: new Date("2025-01-01T00:00:00.000Z"),
      phoneNumber: phone,
      phoneNumberNormalized: phone,
    },
  });
}

async function createRun(
  businessId: string,
  ownerId: string,
  monthIndex: number,
  entries: Array<[
    Awaited<ReturnType<typeof createMembership>>,
    string,
  ]>,
  finalized = true,
) {
  const run = await prisma.payrollRun.create({
    data: {
      attendanceSource: "LEGACY_OPERATIONAL_SESSION",
      breakMinutesPerDaySnapshot: 60,
      businessId,
      normalWorkMinutesPerDaySnapshot: 480,
      overtimeMultiplierSnapshot: "1.50",
      periodEnd: new Date(Date.UTC(2026, monthIndex + 1, 1)),
      periodStart: new Date(Date.UTC(2026, monthIndex, 1)),
      publicHolidayExtraMultiplierSnapshot: "2.00",
      status: "DRAFT",
      workingDaysPerMonthSnapshot: 26,
    },
  });
  for (const [membership, netPay] of entries) {
    await prisma.payrollEntry.create({
      data: {
        baseRateSnapshot: "2000.00",
        basicPay: netPay,
        businessId,
        employeeCodeSnapshot: membership.employeeCode,
        fullNameSnapshot: membership.fullName,
        grossPay: netPay,
        membershipId: membership.id,
        netPay,
        normalWorkMinutesSnapshot: 480,
        payBasisSnapshot: "MONTHLY",
        payrollRunId: run.id,
        workingDaysSnapshot: 26,
      },
    });
  }
  if (!finalized) return run;
  await prisma.payrollRun.update({
    where: { id: run.id },
    data: { status: "REVIEW", submittedAt: new Date(), submittedById: ownerId },
  });
  return prisma.payrollRun.update({
    where: { id: run.id },
    data: { finalizedAt: new Date(), finalizedById: ownerId, status: "FINALIZED" },
  });
}

function paymentContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  user: { email: string | null; id: string; name: string; role: UserRole },
  permissions: string[],
): PayrollPaymentContext {
  if (user.role !== "BUSINESS_OWNER" && user.role !== "STAFF") {
    throw new Error("Payment P0 integration fixture requires an owner or staff actor.");
  }
  const access: ResolvedBusinessAccess = {
    actorRole: user.role,
    branchId: fixture.branchA.id,
    businessId: fixture.business.id,
    capability: null,
    effectiveBusinessRole: user.role,
    granted: true,
    groupId: null,
    groupUserId: null,
    homeBusinessId: fixture.business.id,
    identityRole: user.role,
    industryType: "SALON_BEAUTY",
    permissions,
    source: "DIRECT_BUSINESS",
    userId: user.id,
  };
  return {
    access,
    actor: { email: user.email!, name: user.name, userId: user.id },
    allowedBranchIds: [fixture.branchA.id, fixture.branchB.id],
    businessId: fixture.business.id,
    request: { ipAddress: "127.0.0.1", userAgent: "payment-p0-integration" },
  };
}

function paymentError(error: unknown, code: string) {
  return error instanceof PayrollPaymentError && error.code === code;
}
