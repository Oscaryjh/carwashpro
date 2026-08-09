import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  AttendanceP2Error,
  materializeAttendanceP2Day,
  recordExpectedAttendance,
  resolveAttendanceP2Exception,
  submitAttendanceCorrectionRequest,
} from "../../src/lib/attendance/p2-service";

const prisma = new PrismaClient();
const rollback = "ATTENDANCE_P2_TEST_ROLLBACK";
after(async () => prisma.$disconnect());

test("P2 scheduled no-punch detection is idempotent and resolves to an immutable final day", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const context = managerContext(fixture);
    await recordExpectedAttendance({ context, input: {
      branchId: fixture.branch.id,
      membershipId: fixture.membership.id,
      workDate: day(5),
      kind: "WORKDAY",
      source: "MANUAL_EVIDENCE",
      expectedStartAt: instant(5, 1),
      expectedEndAt: instant(5, 10),
      graceMinutes: 5,
      timezoneSnapshot: "Asia/Kuala_Lumpur",
      evidenceReference: "August manager roster",
    }, database });
    await materializeAttendanceP2Day({ context, membershipId: fixture.membership.id, workDate: day(5), database });
    await materializeAttendanceP2Day({ context, membershipId: fixture.membership.id, workDate: day(5), database });
    const issue = await transaction.attendanceP2Exception.findFirstOrThrow({ where: { businessId: fixture.business.id } });
    assert.equal(issue.type, "SUSPECTED_NO_SHOW");
    assert.equal(await transaction.attendanceP2Exception.count({ where: { businessId: fixture.business.id } }), 1);
    const resolved = await resolveAttendanceP2Exception({ context, input: {
      exceptionId: issue.id,
      expectedRevision: issue.revision,
      type: "UNAUTHORIZED",
      reason: "Manager confirmed unauthorized absence.",
    }, database });
    assert.equal(resolved.finalResult?.outcome, "UNAUTHORIZED_ABSENCE");
    await expectDatabaseFailure(transaction, () => transaction.attendanceP2FinalResult.update({ where: { id: resolved.finalResult!.id }, data: { totalWorkedMinutes: 1 } }), /append-only/i);
    return fixture.business.id;
  });
});

test("P2 no schedule plus no punch remains NO_ATTENDANCE_RECORDED and employee cannot self-approve", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction, true);
    const database = transactionDatabase(transaction);
    const context = managerContext(fixture);
    await materializeAttendanceP2Day({ context, membershipId: fixture.membership.id, workDate: day(6), database });
    const issue = await transaction.attendanceP2Exception.findFirstOrThrow({ where: { businessId: fixture.business.id } });
    assert.equal(issue.type, "NO_ATTENDANCE_RECORDED");
    assert.equal(await transaction.attendanceP2FinalResult.count({ where: { businessId: fixture.business.id } }), 0);
    await assert.rejects(resolveAttendanceP2Exception({
      context: { ...context, actor: actor(fixture.staffUser!) },
      input: { exceptionId: issue.id, expectedRevision: issue.revision, type: "AUTHORIZED", reason: "Attempt own approval." },
      database,
    }), (error: unknown) => error instanceof AttendanceP2Error && error.code === "SELF_APPROVAL_FORBIDDEN");
    return fixture.business.id;
  });
});

test("P2 employee missing-punch correction is own-scoped, reviewed and historically retained", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const database = transactionDatabase(transaction);
    const context = managerContext(fixture);
    await recordExpectedAttendance({ context, input: {
      branchId: fixture.branch.id,
      membershipId: fixture.membership.id,
      workDate: day(7),
      kind: "WORKDAY",
      source: "MANUAL_EVIDENCE",
      expectedStartAt: instant(7, 1),
      expectedEndAt: instant(7, 10),
      graceMinutes: 0,
      timezoneSnapshot: "Asia/Kuala_Lumpur",
    }, database });
    await transaction.employeeAttendance.create({ data: {
      employeeAccountId: fixture.account.id,
      membershipId: fixture.membership.id,
      businessId: fixture.business.id,
      branchId: fixture.branch.id,
      workDate: day(7),
      status: "INCOMPLETE",
      clockInAt: instant(7, 1),
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      expectedBreakMinutes: 60,
      confirmedBreakMinutes: 0,
      approvalStatus: "PENDING",
    } });
    await materializeAttendanceP2Day({ context, membershipId: fixture.membership.id, workDate: day(7), database });
    const issue = await transaction.attendanceP2Exception.findFirstOrThrow({ where: { businessId: fixture.business.id, type: "MISSING_CLOCK_OUT" } });
    const request = await submitAttendanceCorrectionRequest({
      auth: fixture.auth,
      exceptionId: issue.id,
      requestedClockOutAt: instant(7, 10),
      reason: "Forgot to clock out after completing work.",
      requestKey: `request-${randomUUID()}`,
      database,
    });
    const pendingIssue = await transaction.attendanceP2Exception.findUniqueOrThrow({ where: { id: issue.id } });
    const decision = await resolveAttendanceP2Exception({ context, input: {
      exceptionId: issue.id,
      expectedRevision: pendingIssue.revision,
      type: "CORRECTED",
      reason: "Manager verified the proposed departure time.",
      correctedClockOutAt: instant(7, 10),
      correctedBreakMinutes: 60,
    }, database });
    assert.equal(decision.finalResult?.outcome, "PRESENT");
    assert.equal((await transaction.attendanceCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } })).status, "APPROVED");
    await expectDatabaseFailure(transaction, () => transaction.attendanceCorrectionRequest.delete({ where: { id: request.id } }), /cannot be deleted/i);
    return fixture.business.id;
  });
});

async function createFixture(transaction: Prisma.TransactionClient, linkStaff = false) {
  const token = randomUUID();
  const business = await transaction.business.create({ data: { name: `P2 ${token}`, slug: `p2-${token}` } });
  const branch = await transaction.branch.create({ data: { businessId: business.id, name: "P2 Branch" } });
  const owner = await transaction.user.create({ data: { businessId: business.id, name: "P2 Owner", email: `${token}@owner.test`, role: "BUSINESS_OWNER" } });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const account = await transaction.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: "P2 Employee" } });
  const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: `P2-${token}`, fullName: "P2 Employee", phoneNumber: account.phoneNumber, phoneNumberNormalized: account.phoneNormalized, attendanceEnabled: true, joinedAt: new Date("2026-01-01T00:00:00.000Z") } });
  await transaction.employeeBranchAssignment.create({ data: { businessId: business.id, branchId: branch.id, membershipId: membership.id, isPrimary: true, canClockIn: true, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
  const device = await transaction.employeeDevice.create({ data: { employeeAccountId: account.id, displayName: "P2 test", deviceIdentifierHash: randomUUID(), status: "ACTIVE", canView: true, canPunch: true, firstVerifiedAt: new Date(), lastActiveAt: new Date() } });
  const session = await transaction.employeeSession.create({ data: { employeeAccountId: account.id, membershipId: membership.id, businessId: business.id, primaryBranchId: branch.id, employeeDeviceId: device.id, refreshTokenHash: randomUUID(), expiresAt: new Date("2030-01-01T00:00:00.000Z") } });
  const staffUser = linkStaff ? await transaction.user.create({ data: { businessId: business.id, branchId: branch.id, employeeAccountId: account.id, employeeBusinessMembershipId: membership.id, teamMemberLinkStatus: "LINKED", teamMemberLinkedAt: new Date(), name: "P2 Linked Staff", email: `${token}@staff.test`, role: "STAFF" } }) : null;
  return { business, branch, owner, account, membership, staffUser, auth: { sessionId: session.id, employeeAccountId: account.id, membershipId: membership.id, businessId: business.id, primaryBranchId: branch.id, deviceId: device.id } };
}

function managerContext(fixture: Awaited<ReturnType<typeof createFixture>>) { return { businessId: fixture.business.id, allowedBranchIds: [fixture.branch.id], actor: actor(fixture.owner) }; }
function actor(user: { id: string; name: string; email: string | null }) { return { userId: user.id, name: user.name, email: user.email ?? "" }; }
function transactionDatabase(transaction: Prisma.TransactionClient) { return { ...transaction, $transaction: async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction) } as unknown as PrismaClient; }
function day(value: number) { return new Date(`2026-08-${String(value).padStart(2, "0")}T00:00:00.000Z`); }
function instant(dayValue: number, hour: number) { return new Date(`2026-08-${String(dayValue).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`); }
async function withRollback(operation: (transaction: Prisma.TransactionClient) => Promise<string>) { assertLocalDatabase(); let id: string | null = null; await assert.rejects(prisma.$transaction(async (transaction) => { id = await operation(transaction); throw new Error(rollback); }), (error: unknown) => error instanceof Error && error.message === rollback); assert.ok(id); assert.equal(await prisma.business.count({ where: { id } }), 0); }
let savepoint = 0;
async function expectDatabaseFailure(transaction: Prisma.TransactionClient, operation: () => Promise<unknown>, expected: RegExp) { const name = `attendance_p2_${++savepoint}`; await transaction.$executeRawUnsafe(`SAVEPOINT "${name}"`); try { await assert.rejects(operation(), expected); } finally { await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${name}"`); await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${name}"`); } }
function assertLocalDatabase() { const value = process.env.DATABASE_URL; if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) throw new Error("Attendance P2 integration tests require the local database."); }
