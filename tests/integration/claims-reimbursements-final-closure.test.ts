import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth";
import { findEligibleEmployeeIdentityByPhone } from "../../src/lib/attendance/employee-auth/membership";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { requestEmployeeOtp, verifyEmployeeOtp } from "../../src/lib/attendance/employee-auth/otp-service";
import { CapturingEmployeeOtpProvider } from "../../src/lib/attendance/employee-auth/provider";
import { CLAIM_STATUTORY_TREATMENT_NOT_READY, markClaimReimbursementPaidOutsidePayroll, selectClaimReimbursementChannel } from "../../src/lib/claim/reimbursement";
import { cancelApprovedEmployeeClaim, getAuthorizedClaimAttachment, reviewEmployeeClaim, submitEmployeeClaim } from "../../src/lib/claim/service";
import { FileSystemClaimPrivateAttachmentStore } from "../../src/lib/claim/private-attachment-storage";
import { prisma } from "../../src/lib/prisma";

test("Claims self-service identity can authenticate without enabling Attendance", async () => {
  const fixture = await createFixture();
  const attendanceIdentity = await findEligibleEmployeeIdentityByPhone(
    fixture.account.phoneNormalized,
    new Date(),
    prisma,
  );
  const selfServiceIdentity = await findEligibleEmployeeIdentityByPhone(
    fixture.account.phoneNormalized,
    new Date(),
    prisma,
    false,
  );

  assert.equal(attendanceIdentity, null);
  assert.equal(selfServiceIdentity?.memberships[0]?.membershipId, fixture.membership.id);

  const provider = new CapturingEmployeeOtpProvider();
  const deviceIdentifier = `claims-device:${randomUUID()}`;
  const config = getEmployeeAuthConfig({
    ...process.env,
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: "claims-self-service-auth-secret-0001",
    EMPLOYEE_OTP_SEND_MODE: "mock",
    EMPLOYEE_OTP_MOCK_CODE: "123456",
  });
  const requested = await requestEmployeeOtp(
    {
      phoneNumber: fixture.account.phoneNormalized,
      deviceIdentifier,
    },
    { database: prisma, config, provider, requireAttendance: false },
  );
  assert.equal(provider.sent.length, 1);
  const authenticated = await verifyEmployeeOtp(
    {
      challengeId: requested.challengeId,
      otp: provider.sent[0]!.otp,
      deviceIdentifier,
    },
    { database: prisma, config, requireAttendance: false },
  );
  assert.equal(authenticated.status, "AUTHENTICATED");
});

test("Claim partial approval creates one independent reimbursement and outside-Payroll settlement is idempotent", async () => {
  const fixture = await createFixture();
  const clientRequestId = randomUUID();
  const submitted = await submitEmployeeClaim(fixture.auth, {
    clientRequestId,
    purpose: "Local QA expense",
    currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-10", merchant: "QA Shop", description: "Test supplies", amount: "100.00" }],
  }, []);
  const replay = await submitEmployeeClaim(fixture.auth, {
    clientRequestId,
    purpose: "Local QA expense",
    currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-10", merchant: "QA Shop", description: "Test supplies", amount: "100.00" }],
  }, []);
  assert.equal(replay.id, submitted.id);

  const line = await prisma.claimLine.findFirstOrThrow({ where: { claimId: submitted.id } });
  await reviewEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: {
      claimId: submitted.id,
      expectedRevision: 1,
      reason: "Personal portion removed.",
      lines: [{ lineId: line.id, approvedAmount: "80.00", reason: "RM20 personal." }],
    },
  });
  const approved = await prisma.employeeClaim.findUniqueOrThrow({ where: { id: submitted.id }, include: { reimbursement: true } });
  assert.equal(approved.status, "PARTIALLY_APPROVED");
  assert.equal(approved.approvedTotal.toFixed(2), "80.00");
  assert.equal(approved.reimbursement?.amount.toFixed(2), "80.00");

  const reimbursement = approved.reimbursement!;
  const race = await Promise.allSettled([randomUUID(), randomUUID()].map((operationKey) => selectClaimReimbursementChannel({
    businessId: fixture.business.id,
    actor: fixture.actor,
    rawInput: { reimbursementId: reimbursement.id, expectedRevision: 0, operationKey, channel: "OUTSIDE_PAYROLL" },
  })));
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);

  const selected = await prisma.claimReimbursement.findUniqueOrThrow({ where: { id: reimbursement.id } });
  const paymentOperationKey = randomUUID();
  const paid = await markClaimReimbursementPaidOutsidePayroll({
    businessId: fixture.business.id,
    actor: fixture.actor,
    rawInput: { reimbursementId: reimbursement.id, expectedRevision: selected.revision, operationKey: paymentOperationKey, paymentReference: "LOCAL-QA-001" },
  });
  const paidReplay = await markClaimReimbursementPaidOutsidePayroll({
    businessId: fixture.business.id,
    actor: fixture.actor,
    rawInput: { reimbursementId: reimbursement.id, expectedRevision: selected.revision, operationKey: paymentOperationKey, paymentReference: "LOCAL-QA-001" },
  });
  assert.equal(paid.status, "OUTSIDE_PAYROLL_PAID");
  assert.equal(paidReplay.id, paid.id);
  assert.equal(await prisma.claimReimbursement.count({ where: { claimId: submitted.id } }), 1);
  await assert.rejects(cancelApprovedEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { claimId: submitted.id, expectedRevision: 2, reason: "Paid Claim cannot be simply cancelled." },
  }), /CLAIM_ALREADY_REIMBURSED/);
});

test("duplicate is warning-only and Payroll bridge fails closed without changing wage or net", async () => {
  const fixture = await createFixture();
  const first = await submitAndApprove(fixture, "First matching Claim");
  const second = await submitEmployeeClaim(fixture.auth, {
    clientRequestId: randomUUID(),
    purpose: "Possible duplicate",
    currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-10", description: "Test supplies", amount: "100.00" }],
  }, []);
  assert.equal(second.duplicateWarning, true);
  assert.equal(second.status, "SUBMITTED");

  const { run, entry } = await createDraftPayroll(fixture);
  const linked = await selectClaimReimbursementChannel({
    businessId: fixture.business.id,
    actor: fixture.actor,
    rawInput: {
      reimbursementId: first.reimbursementId,
      expectedRevision: 0,
      operationKey: randomUUID(),
      channel: "PAYROLL",
      payrollRunId: run.id,
    },
  });
  const snapshot = await prisma.payrollClaimReimbursementSnapshot.findUniqueOrThrow({ where: { reimbursementId: linked.id } });
  assert.equal(snapshot.status, "BLOCKED_STATUTORY");
  assert.equal(snapshot.blockerCode, CLAIM_STATUTORY_TREATMENT_NOT_READY);
  const unchanged = await prisma.payrollEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.equal(unchanged.grossPay.toFixed(2), "3000.00");
  assert.equal(unchanged.netPay.toFixed(2), "3000.00");
  await assert.rejects(prisma.claimPolicyRevision.update({ where: { id: fixture.policy.id }, data: { reason: "Rewrite" } }), /CLAIM_IMMUTABLE_RECORD|immutable/i);
  await assert.rejects(prisma.claimEvent.deleteMany({ where: { claimId: first.claimId } }), /CLAIM_IMMUTABLE_RECORD|immutable/i);
});

test("receipt bytes stay private and tenant/employee authorization is enforced", async () => {
  const fixture = await createFixture();
  const root = await mkdtemp(path.join(tmpdir(), "tetamu-claim-receipts-"));
  const store = new FileSystemClaimPrivateAttachmentStore(root, { applicationRoot: process.cwd() });
  try {
    const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44]);
    const claim = await submitEmployeeClaim(fixture.auth, {
      clientRequestId: randomUUID(), purpose: "Private receipt", currency: "MYR",
      lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-11", description: "Private receipt test", amount: "10.00" }],
    }, [{ lineNumber: 1, bytes: png, claimedMimeType: "image/png", originalFileName: "../receipt.png" }], { store });
    const attachment = await prisma.claimAttachment.findFirstOrThrow({ where: { claimId: claim.id } });
    const own = await getAuthorizedClaimAttachment({ attachmentId: attachment.id, businessId: fixture.business.id, membershipId: fixture.membership.id }, prisma, store);
    assert.deepEqual([...own.bytes], [...png]);
    assert.equal(own.fileName, "receipt.png");
    await assert.rejects(getAuthorizedClaimAttachment({ attachmentId: attachment.id, businessId: fixture.business.id, membershipId: randomUUID() }, prisma, store), /authorized scope/i);
    await assert.rejects(getAuthorizedClaimAttachment({ attachmentId: attachment.id, businessId: randomUUID(), allowedBranchIds: [fixture.branch.id] }, prisma, store), /authorized scope/i);
    assert.equal(attachment.malwareStatus, "NOT_SCANNED");
    assert.equal(attachment.quarantineDisposition, "QUARANTINED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approved unpaid Claim cancellation reverses one obligation while paid Claim is protected", async () => {
  const fixture = await createFixture();
  const approved = await submitAndApprove(fixture, "Cancellation coverage");
  const cancelled = await cancelApprovedEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { claimId: approved.claimId, expectedRevision: 2, reason: "Manager confirmed incorrect expense." },
  });
  assert.equal(cancelled.status, "CANCELLED");
  const reimbursement = await prisma.claimReimbursement.findUniqueOrThrow({ where: { id: approved.reimbursementId } });
  assert.equal(reimbursement.status, "CANCELLED");
  assert.equal(await prisma.claimEvent.count({ where: { claimId: approved.claimId, type: "REIMBURSEMENT_CANCELLED" } }), 1);
  await assert.rejects(cancelApprovedEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { claimId: approved.claimId, expectedRevision: 2, reason: "Repeat cancellation is rejected." },
  }), /not found|changed/i);
});

test("concurrent manager approval has one canonical winner and one reimbursement obligation", async () => {
  const fixture = await createFixture();
  const claim = await submitEmployeeClaim(fixture.auth, {
    clientRequestId: randomUUID(), purpose: "Approval concurrency", currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-12", description: "Concurrent approval", amount: "25.00" }],
  }, []);
  const line = await prisma.claimLine.findFirstOrThrow({ where: { claimId: claim.id } });
  const review = () => reviewEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { claimId: claim.id, expectedRevision: 1, lines: [{ lineId: line.id, approvedAmount: "25.00" }] },
  });
  const results = await Promise.allSettled([review(), review()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await prisma.claimReimbursement.count({ where: { claimId: claim.id } }), 1);
  assert.equal(await prisma.claimEvent.count({ where: { claimId: claim.id, type: "APPROVED" } }), 1);
});

async function submitAndApprove(fixture: Awaited<ReturnType<typeof createFixture>>, purpose: string) {
  const claim = await submitEmployeeClaim(fixture.auth, {
    clientRequestId: randomUUID(), purpose, currency: "MYR",
    lines: [{ lineNumber: 1, categoryId: fixture.category.id, expenseDate: "2026-08-10", description: "Test supplies", amount: "100.00" }],
  }, []);
  const line = await prisma.claimLine.findFirstOrThrow({ where: { claimId: claim.id } });
  await reviewEmployeeClaim({
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: fixture.actor,
    rawInput: { claimId: claim.id, expectedRevision: 1, lines: [{ lineId: line.id, approvedAmount: "100.00" }] },
  });
  const reimbursement = await prisma.claimReimbursement.findUniqueOrThrow({ where: { claimId: claim.id } });
  return { claimId: claim.id, reimbursementId: reimbursement.id };
}

async function createFixture() {
  assertLocalDatabase();
  const token = randomUUID();
  const business = await prisma.business.create({ data: { name: `Claims closure ${token}`, slug: `claims-closure-${token}`, timezone: "Asia/Kuala_Lumpur" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Claims QA Branch" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Claims QA Manager", email: `${token}@claims.test`, role: "BUSINESS_OWNER" } });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await prisma.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: "Claims QA Employee" } });
  const membership = await prisma.employeeBusinessMembership.create({ data: {
    employeeAccountId: account.id, businessId: business.id, employeeCode: `CL-${token}`,
    fullName: "Claims QA Employee", phoneNumber: phone, phoneNumberNormalized: phone,
    attendanceEnabled: false, joinedAt: new Date("2025-01-01T00:00:00.000Z"),
  } });
  await prisma.employeeBranchAssignment.create({ data: {
    businessId: business.id, branchId: branch.id, membershipId: membership.id,
    isPrimary: true, canClockIn: false, effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
  } });
  for (const moduleKey of ["HR", "CLAIMS", "PAYROLL"] as const) {
    await prisma.businessModuleEntitlement.create({ data: {
      businessId: business.id, moduleKey, status: "ENABLED", enabledFrom: new Date("2025-01-01T00:00:00.000Z"), source: "MANUAL", revision: 1,
    } });
  }
  const category = await prisma.claimCategory.create({ data: { businessId: business.id, code: "GENERAL", name: "General", nature: "GENERAL" } });
  const policy = await prisma.claimPolicyRevision.create({ data: {
    businessId: business.id, categoryId: category.id, revision: 1,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), nameSnapshot: "General", natureSnapshot: "GENERAL",
    receiptRequired: false, descriptionRequired: true, statutoryTreatmentStatus: "REVIEW_REQUIRED",
    reason: "Local test policy", createdById: owner.id,
  } });
  const auth: EmployeeAuthContext = { sessionId: randomUUID(), employeeAccountId: account.id, membershipId: membership.id, businessId: business.id, primaryBranchId: branch.id, attendanceBranchId: branch.id, deviceId: randomUUID() };
  const actor: AppSession = { userId: owner.id, homeBusinessId: business.id, activeBusinessId: business.id, contextVersion: 1, businessId: business.id, branchId: branch.id, name: owner.name, email: owner.email ?? "", role: "BUSINESS_OWNER", permissions: [], status: "active" };
  return { business, branch, owner, account, membership, category, policy, auth, actor };
}

async function createDraftPayroll(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const run = await prisma.payrollRun.create({ data: {
    businessId: fixture.business.id,
    periodStart: new Date("2026-08-01T00:00:00.000Z"), periodEnd: new Date("2026-08-31T00:00:00.000Z"),
    status: "DRAFT", attendanceSource: "LEGACY_OPERATIONAL_SESSION",
    workingDaysPerMonthSnapshot: 26, normalWorkMinutesPerDaySnapshot: 480, breakMinutesPerDaySnapshot: 60,
    overtimeMultiplierSnapshot: "1.50", publicHolidayExtraMultiplierSnapshot: "2.00", createdById: fixture.owner.id,
  } });
  const entry = await prisma.$transaction(async (transaction) => {
    const created = await transaction.payrollEntry.create({ data: {
      payrollRunId: run.id, businessId: fixture.business.id, membershipId: fixture.membership.id,
      employeeCodeSnapshot: fixture.membership.employeeCode, fullNameSnapshot: fixture.membership.fullName,
      payBasisSnapshot: "MONTHLY", baseRateSnapshot: "3000.00", workingDaysSnapshot: 26, normalWorkMinutesSnapshot: 480,
      basicPay: "3000.00", grossPay: "3000.00", netPay: "3000.00",
    } });
    await transaction.payrollEntryComponent.create({ data: {
      businessId: fixture.business.id, payrollRunId: run.id, payrollEntryId: created.id, membershipId: fixture.membership.id,
      lineKey: "SYSTEM:CLAIM_FIXTURE", type: "EARNING", code: "CLAIM_FIXTURE", name: "Claim fixture wage",
      amount: "3000.00", currency: "MYR", sourceType: "PAYROLL_CALCULATION", calculationBasis: "LOCAL_CLAIMS_TEST",
      origin: "SYSTEM", sortOrder: 10, createdById: fixture.owner.id,
    } });
    return created;
  });
  return { run, entry };
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) throw new Error("Claims integration tests require the Local database.");
}
