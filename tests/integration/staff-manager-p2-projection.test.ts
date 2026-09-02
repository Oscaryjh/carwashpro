import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadEmployeeCorrectionArchive } from "../../src/lib/attendance/employee-correction-archive";
import {
  AttendanceP2Error,
  submitAttendanceCorrectionRequest,
} from "../../src/lib/attendance/p2-service";
import {
  getStaffAttendanceCorrectionQueue,
  getStaffTeamApprovalSummary,
  reviewStaffAttendanceP2Correction,
} from "../../src/lib/staff-pwa/team-approvals";

const prisma = new PrismaClient();
const rollback = "STAFF_MANAGER_P2_PROJECTION_ROLLBACK";
after(async () => prisma.$disconnect());

test("Staff manager projection closes the canonical P2 correction lifecycle without count or scope drift", async () => {
  await withRollback(async (transaction) => {
    const database = transactionDatabase(transaction);
    const fixture = await createFixture(transaction);
    const pending = await createPendingCorrection(transaction, fixture, fixture.worker, fixture.branchA.id, 24);
    await transaction.attendanceException.create({
      data: {
        businessId: fixture.business.id,
        branchId: fixture.branchA.id,
        employeeId: fixture.worker.membership.id,
        type: "FORGOT_CLOCK_OUT",
        reason: "Earlier standalone correction.",
        requestedClockOutAt: instant(23, 10),
        createdAt: new Date("2026-08-23T11:00:00.000Z"),
      },
    });
    await createPendingCorrection(transaction, fixture, fixture.branchBWorker, fixture.branchB.id, 25);
    const selfReview = await createPendingCorrection(transaction, fixture, fixture.manager, fixture.branchA.id, 26);
    const cancelled = await createPendingCorrection(transaction, fixture, fixture.worker, fixture.branchA.id, 29);
    await transaction.attendanceCorrectionRequest.update({
      where: { id: cancelled.request.id },
      data: {
        status: "CANCELLED",
        reviewedAt: new Date(),
        reviewReason: "Employee cancelled the local fixture request.",
      },
    });

    const queue = await getStaffAttendanceCorrectionQueue({ auth: fixture.manager.auth, database });
    const summary = await getStaffTeamApprovalSummary(fixture.manager.auth, database);
    assert.ok(queue);
    assert.ok(summary);
    assert.equal(queue.totalActionable, 2, "one standalone and one scoped non-self P2 request are actionable");
    assert.equal(summary.attendance, queue.totalActionable, "Approval Center parent count equals the child queue");
    assert.deepEqual(queue.items.map((item) => item.sourceType), [
      "STANDALONE_EXCEPTION",
      "P2_CORRECTION_REQUEST",
    ]);
    assert.equal(queue.items.filter((item) => item.sourceType === "P2_CORRECTION_REQUEST").length, 1);
    await assert.rejects(
      reviewStaffAttendanceP2Correction({
        auth: fixture.manager.auth,
        correctionRequestId: selfReview.request.id,
        expectedRevision: selfReview.issue.revision,
        decision: "APPROVED",
        reason: "A manager must not review their own request.",
        database,
      }),
      /reviewed|scope/i,
    );

    await reviewStaffAttendanceP2Correction({
      auth: fixture.manager.auth,
      correctionRequestId: pending.request.id,
      expectedRevision: pending.issue.revision,
      decision: "APPROVED",
      reason: "Manager verified the employee clock-out time.",
      database,
    });
    const approved = await transaction.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: pending.request.id } });
    assert.equal(approved.status, "APPROVED");
    assert.ok(await transaction.attendanceP2Resolution.findFirst({ where: { exceptionId: pending.issue.id, createdById: fixture.manager.user.id } }));
    assert.ok(await transaction.attendanceP2FinalResult.findFirst({ where: { businessId: fixture.business.id, membershipId: fixture.worker.membership.id, workDate: day(24) } }));

    const afterDecision = await getStaffAttendanceCorrectionQueue({ auth: fixture.manager.auth, database });
    assert.equal(afterDecision?.totalActionable, 1);
    assert.equal(afterDecision?.items.some((item) => item.sourceType === "P2_CORRECTION_REQUEST"), false);
    const employeeArchive = await loadEmployeeCorrectionArchive({ auth: fixture.worker.auth, database });
    assert.equal(employeeArchive.items.find((item) => item.sourceKey === `p2-request:${pending.request.id}`)?.employeeStatus, "APPROVED");
    const immutableManagerDecision = await transaction.attendanceP2Resolution.findFirstOrThrow({
      where: {
        exceptionId: pending.issue.id,
        createdById: fixture.manager.user.id,
      },
    });
    assert.equal(immutableManagerDecision.reason, "Manager verified the employee clock-out time.");

    await assert.rejects(
      reviewStaffAttendanceP2Correction({
        auth: fixture.manager.auth,
        correctionRequestId: pending.request.id,
        expectedRevision: pending.issue.revision,
        decision: "APPROVED",
        reason: "Duplicate decision attempt.",
        database,
      }),
      /already been reviewed/i,
    );
    return fixture.business.id;
  });
});

test("P2 rejection requires a reason and approved or locked Timesheets fail closed", async () => {
  await withRollback(async (transaction) => {
    const database = transactionDatabase(transaction);
    const fixture = await createFixture(transaction);
    const rejected = await createPendingCorrection(transaction, fixture, fixture.worker, fixture.branchA.id, 27);
    await reviewStaffAttendanceP2Correction({
      auth: fixture.manager.auth,
      correctionRequestId: rejected.request.id,
      expectedRevision: rejected.issue.revision,
      decision: "REJECTED",
      reason: "The requested time could not be verified.",
      database,
    });
    assert.equal((await transaction.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: rejected.request.id } })).status, "REJECTED");

    const locked = await createPendingCorrection(transaction, fixture, fixture.worker, fixture.branchA.id, 28);
    await transaction.attendanceMonthlyTimesheet.create({
      data: {
        businessId: fixture.business.id,
        periodStart: day(1),
        status: "APPROVED",
        approvalRevision: 1,
        approvalSourceDigest: "a".repeat(64),
        approvalReason: "Approved local projection fixture.",
        approvedAt: new Date(),
        approvedById: fixture.manager.user.id,
      },
    });
    await assert.rejects(
      reviewStaffAttendanceP2Correction({
        auth: fixture.manager.auth,
        correctionRequestId: locked.request.id,
        expectedRevision: locked.issue.revision,
        decision: "APPROVED",
        reason: "Attempt after Timesheet approval.",
        database,
      }),
      (error: unknown) => error instanceof AttendanceP2Error && error.code === "TIMESHEET_LOCKED",
    );
    assert.equal((await transaction.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: locked.request.id } })).status, "PENDING");

    const capabilityRevoked = await createPendingCorrection(transaction, fixture, fixture.worker, fixture.branchA.id, 30);
    await transaction.user.update({
      where: { id: fixture.manager.user.id },
      data: { permissions: [] },
    });
    await assert.rejects(
      reviewStaffAttendanceP2Correction({
        auth: fixture.manager.auth,
        correctionRequestId: capabilityRevoked.request.id,
        expectedRevision: capabilityRevoked.issue.revision,
        decision: "REJECTED",
        reason: "This action must fail after capability revocation.",
        database,
      }),
      /permission/i,
    );
    return fixture.business.id;
  });
});

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({ data: { name: `Staff P2 ${token}`, slug: `staff-p2-${token}` } });
  const [branchA, branchB] = await Promise.all([
    transaction.branch.create({ data: { businessId: business.id, name: "Authorized Branch" } }),
    transaction.branch.create({ data: { businessId: business.id, name: "Other Branch" } }),
  ]);
  const manager = await createEmployee(transaction, business.id, branchA.id, `M-${token}`, "Projection Manager");
  const user = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branchA.id,
      employeeAccountId: manager.account.id,
      employeeBusinessMembershipId: manager.membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: manager.membership.fullName,
      email: `${token}@manager.test`,
      role: "STAFF",
      permissions: ["ATTENDANCE_EMPLOYEE_MANAGE"],
      status: "active",
    },
  });
  await transaction.businessModuleEntitlement.create({
    data: {
      businessId: business.id,
      moduleKey: "HR",
      status: "ENABLED",
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "MANUAL",
      createdById: user.id,
      updatedById: user.id,
    },
  });
  const worker = await createEmployee(transaction, business.id, branchA.id, `W-${token}`, "Visible Worker");
  const branchBWorker = await createEmployee(transaction, business.id, branchB.id, `B-${token}`, "Other Branch Worker");
  return { business, branchA, branchB, manager: { ...manager, user }, worker, branchBWorker };
}

async function createEmployee(
  transaction: Prisma.TransactionClient,
  businessId: string,
  branchId: string,
  code: string,
  fullName: string,
) {
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await transaction.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: fullName } });
  const membership = await transaction.employeeBusinessMembership.create({
    data: { employeeAccountId: account.id, businessId, employeeCode: code, fullName, phoneNumber: phone, phoneNumberNormalized: phone, attendanceEnabled: true, joinedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  await transaction.employeeBranchAssignment.create({ data: { businessId, branchId, membershipId: membership.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const device = await transaction.employeeDevice.create({ data: { employeeAccountId: account.id, displayName: "Staff P2 test", deviceIdentifierHash: randomUUID(), status: "ACTIVE", canView: true, canPunch: true, firstVerifiedAt: new Date(), lastActiveAt: new Date() } });
  const session = await transaction.employeeSession.create({ data: { employeeAccountId: account.id, membershipId: membership.id, businessId, primaryBranchId: branchId, employeeDeviceId: device.id, refreshTokenHash: randomUUID(), expiresAt: new Date("2030-01-01T00:00:00.000Z") } });
  return { account, membership, auth: { sessionId: session.id, employeeAccountId: account.id, membershipId: membership.id, businessId, primaryBranchId: branchId, attendanceBranchId: branchId, deviceId: device.id } };
}

async function createPendingCorrection(
  transaction: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  employee: Awaited<ReturnType<typeof createEmployee>>,
  branchId: string,
  dayValue: number,
) {
  const issue = await transaction.attendanceP2Exception.create({
    data: {
      businessId: fixture.business.id,
      branchId,
      membershipId: employee.membership.id,
      workDate: day(dayValue),
      type: "MISSING_CLOCK_OUT",
      stableKey: `staff-manager-p2:${randomUUID()}`,
      actualClockInAt: instant(dayValue, 1),
      reasonCode: "MISSING_CLOCK_OUT",
      sourceDigest: "b".repeat(64),
    },
  });
  const request = await submitAttendanceCorrectionRequest({
    auth: employee.auth,
    exceptionId: issue.id,
    requestedClockOutAt: instant(dayValue, 10),
    reason: "Forgot to clock out after completing the shift.",
    requestKey: `staff-p2-${randomUUID()}`,
    database: transactionDatabase(transaction),
  });
  const currentIssue = await transaction.attendanceP2Exception.findUniqueOrThrow({ where: { id: issue.id } });
  return { issue: currentIssue, request };
}

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return new Proxy(transaction as unknown as PrismaClient, {
    get(target, property, receiver) {
      if (property === "$transaction") {
        return async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function day(value: number) {
  return new Date(`2026-08-${String(value).padStart(2, "0")}T00:00:00.000Z`);
}

function instant(dayValue: number, hour: number) {
  return new Date(`2026-08-${String(dayValue).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`);
}

async function withRollback(operation: (transaction: Prisma.TransactionClient) => Promise<string>) {
  assertLocalDatabase();
  let businessId: string | null = null;
  await assert.rejects(prisma.$transaction(async (transaction) => {
    businessId = await operation(transaction);
    throw new Error(rollback);
  }, { timeout: 60_000 }), (error: unknown) => error instanceof Error && error.message === rollback);
  assert.ok(businessId);
  assert.equal(await prisma.business.count({ where: { id: businessId } }), 0);
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error("Staff manager P2 integration tests require the local database.");
  }
}
