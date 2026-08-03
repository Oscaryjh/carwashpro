import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AttendanceTimesheetContext } from "../../src/lib/attendance/timesheet-service";
import {
  beginMonthlyAttendanceTimesheetRevision,
  loadMonthlyAttendanceTimesheet,
  lockMonthlyAttendanceTimesheet,
  markAttendanceTimesheetBranchReady,
} from "../../src/lib/attendance/timesheet-service";
import { materializeAttendanceResolutionFoundationInTransaction, resolveAttendanceCaseInTransaction } from "../../src/lib/attendance/resolution-service";
import { generatePayrollRun, submitPayrollRunForReview } from "../../src/lib/payroll/service";

const prisma = new PrismaClient();
const rollbackMessage = "ATTENDANCE_TIMESHEET_TEST_ROLLBACK";
let savepointSequence = 0;

after(async () => prisma.$disconnect());

test("A3 marks current branch evidence ready, locks immutable revision, and preserves Payroll", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const first = await createCompletedSession(transaction, fixture, fixture.branchA.id, 2);
    const second = await createCompletedSession(transaction, fixture, fixture.branchB.id, 3);
    for (const session of [first, second]) {
      await materializeAttendanceResolutionFoundationInTransaction({
        ...resolutionContext(fixture), attendanceSessionId: session.id,
      }, transaction);
    }
    const finalizedPayroll = await transaction.payrollRun.create({
      data: {
        attendanceSource: "LEGACY_OPERATIONAL_SESSION",
        businessId: fixture.business.id,
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-31T00:00:00.000Z"),
        status: "FINALIZED",
        workingDaysPerMonthSnapshot: 26,
        normalWorkMinutesPerDaySnapshot: 480,
        breakMinutesPerDaySnapshot: 60,
        overtimeMultiplierSnapshot: "1.50",
        publicHolidayExtraMultiplierSnapshot: "2.00",
        createdById: fixture.owner.id,
        submittedById: fixture.owner.id,
        submittedAt: new Date(),
        finalizedById: fixture.owner.id,
        finalizedAt: new Date(),
      },
    });
    const payrollBefore = await transaction.payrollRun.findUniqueOrThrow({ where: { id: finalizedPayroll.id } });
    const database = transactionDatabase(transaction);
    const context = timesheetContext(fixture, true);

    await markAttendanceTimesheetBranchReady({ context, month: "2026-08", branchId: fixture.branchA.id, database });
    await markAttendanceTimesheetBranchReady({ context, month: "2026-08", branchId: fixture.branchB.id, database });
    const ready = await loadMonthlyAttendanceTimesheet({
      businessId: fixture.business.id,
      allowedBranchIds: [fixture.branchA.id, fixture.branchB.id],
      month: "2026-08",
      database: transaction,
    });
    assert.equal(ready.allBranchesReady, true);
    assert.equal(ready.totals.blockers, 0);

    await assert.rejects(
      lockMonthlyAttendanceTimesheet({
        context: { ...context, wholeBusinessScope: false },
        month: "2026-08",
        reason: "Monthly approval",
        database,
      }),
      /Whole-business Attendance scope/i,
    );
    const locked = await lockMonthlyAttendanceTimesheet({
      context,
      month: "2026-08",
      reason: "Owner approved resolved August attendance.",
      expectedUpdatedAt: ready.timesheet?.updatedAt.toISOString(),
      database,
    });
    assert.equal(locked.revision, 1);
    assert.equal(await transaction.attendanceTimesheetRevisionEntry.count({ where: { revisionId: locked.revisionId } }), 2);
    assert.deepEqual(await transaction.payrollRun.findUniqueOrThrow({ where: { id: finalizedPayroll.id } }), payrollBefore);

    const revisionBefore = await transaction.attendanceTimesheetRevision.findUniqueOrThrow({ where: { id: locked.revisionId } });
    await expectDatabaseFailure(transaction, () => transaction.attendanceTimesheetRevision.update({ where: { id: locked.revisionId }, data: { reason: "tampered" } }), /immutable/i);
    await expectDatabaseFailure(transaction, () => transaction.attendanceTimesheetRevision.delete({ where: { id: locked.revisionId } }), /immutable/i);
    assert.deepEqual(await transaction.attendanceTimesheetRevision.findUniqueOrThrow({ where: { id: locked.revisionId } }), revisionBefore);
    return fixture.business.id;
  });
});

test("A3 invalidates stale Branch Ready and creates revision 2 without changing revision 1", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await createCompletedSession(transaction, fixture, fixture.branchA.id, 4);
    const caseRecord = await materializeAttendanceResolutionFoundationInTransaction({
      ...resolutionContext(fixture), attendanceSessionId: session.id,
    }, transaction);
    const database = transactionDatabase(transaction);
    const context = timesheetContext(fixture, true, [fixture.branchA.id]);
    await markAttendanceTimesheetBranchReady({ context, month: "2026-08", branchId: fixture.branchA.id, database });
    const beforeLock = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    const firstLock = await lockMonthlyAttendanceTimesheet({ context, month: "2026-08", reason: "Initial approved attendance.", expectedUpdatedAt: beforeLock.timesheet?.updatedAt.toISOString(), database });
    const firstEntries = await transaction.attendanceTimesheetRevisionEntry.findMany({ where: { revisionId: firstLock.revisionId } });

    await resolveAttendanceCaseInTransaction(resolutionContext(fixture), {
      resolutionCaseId: caseRecord.id,
      disposition: "INCLUDED",
      source: "CORRECTION",
      expectedCurrentResultId: caseRecord.currentFinalResultId,
      resultOverride: {
        clockInAt: session.clockInAt,
        clockOutAt: new Date(session.clockOutAt!.getTime() + 30 * 60_000),
        totalBreakMinutes: 60,
        totalWorkedMinutes: 510,
        confirmedBreakMinutes: 60,
      },
    }, transaction);
    const changed = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    assert.notEqual(changed.currentSourceDigest, changed.timesheet?.currentRevision?.sourceDigest);
    await beginMonthlyAttendanceTimesheetRevision({ context, month: "2026-08", reason: "Include approved corrected departure time.", expectedUpdatedAt: changed.timesheet?.updatedAt.toISOString(), database });
    const draft = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    assert.equal(draft.timesheet?.status, "DRAFT");
    assert.equal(draft.branches[0]?.readinessStatus, "NOT_READY");
    await markAttendanceTimesheetBranchReady({ context, month: "2026-08", branchId: fixture.branchA.id, database });
    const ready = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    const secondLock = await lockMonthlyAttendanceTimesheet({ context, month: "2026-08", reason: "Approved corrected attendance revision.", expectedUpdatedAt: ready.timesheet?.updatedAt.toISOString(), database });
    assert.equal(secondLock.revision, 2);
    assert.deepEqual(await transaction.attendanceTimesheetRevisionEntry.findMany({ where: { revisionId: firstLock.revisionId } }), firstEntries);
    assert.equal((await transaction.attendanceTimesheetRevisionEntry.findFirstOrThrow({ where: { revisionId: secondLock.revisionId } })).totalWorkedMinutes, 510);

    await transaction.employeeCompensationVersion.create({ data: {
      baseRate: 2600,
      businessId: fixture.business.id,
      effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
      membershipId: fixture.membership.id,
      payBasis: "MONTHLY",
      reasonType: "DATA_MIGRATION",
      source: "LEGACY_BASELINE",
    } });
    const payrollRun = await generatePayrollRun({
      actor: context.actor,
      businessId: fixture.business.id,
      month: "2026-08",
    }, database);
    assert.equal(payrollRun.attendanceSource, "LOCKED_TIMESHEET_REVISION");
    assert.equal(payrollRun.attendanceTimesheetRevisionId, secondLock.revisionId);
    const revisionTwoEntry = await transaction.payrollEntry.findFirstOrThrow({
      where: { payrollRunId: payrollRun.id, membershipId: fixture.membership.id },
    });
    assert.equal(revisionTwoEntry.regularMinutes, 480);
    assert.equal(revisionTwoEntry.overtimeMinutes, 30);

    const currentCase = await transaction.attendanceResolutionCase.findUniqueOrThrow({
      where: { id: caseRecord.id },
    });
    await resolveAttendanceCaseInTransaction(resolutionContext(fixture), {
      resolutionCaseId: caseRecord.id,
      disposition: "INCLUDED",
      source: "CORRECTION",
      expectedCurrentResultId: currentCase.currentFinalResultId,
      resultOverride: {
        clockInAt: session.clockInAt,
        clockOutAt: new Date(session.clockOutAt!.getTime() + 60 * 60_000),
        totalBreakMinutes: 60,
        totalWorkedMinutes: 540,
        confirmedBreakMinutes: 60,
      },
    }, transaction);
    const revisionNeeded = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    await beginMonthlyAttendanceTimesheetRevision({ context, month: "2026-08", reason: "Approved second correction.", expectedUpdatedAt: revisionNeeded.timesheet?.updatedAt.toISOString(), database });
    await markAttendanceTimesheetBranchReady({ context, month: "2026-08", branchId: fixture.branchA.id, database });
    const thirdReady = await loadMonthlyAttendanceTimesheet({ businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id], month: "2026-08", database: transaction });
    const thirdLock = await lockMonthlyAttendanceTimesheet({ context, month: "2026-08", reason: "Locked second correction.", expectedUpdatedAt: thirdReady.timesheet?.updatedAt.toISOString(), database });
    await assert.rejects(
      submitPayrollRunForReview({ actor: context.actor, businessId: fixture.business.id, runId: payrollRun.id }, database),
      /newer locked Timesheet revision|refresh/i,
    );
    const refreshed = await generatePayrollRun({ actor: context.actor, businessId: fixture.business.id, month: "2026-08" }, database);
    assert.equal(refreshed.attendanceTimesheetRevisionId, thirdLock.revisionId);
    const revisionThreeEntry = await transaction.payrollEntry.findFirstOrThrow({
      where: { payrollRunId: payrollRun.id, membershipId: fixture.membership.id },
    });
    assert.equal(revisionThreeEntry.regularMinutes, 480);
    assert.equal(revisionThreeEntry.overtimeMinutes, 60);
    return fixture.business.id;
  });
});

test("A3 keeps unresolved sessions blocked and enforces branch scope", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await createIncompleteSession(transaction, fixture, fixture.branchA.id, 5);
    await materializeAttendanceResolutionFoundationInTransaction({
      ...resolutionContext(fixture), attendanceSessionId: session.id,
    }, transaction);
    const database = transactionDatabase(transaction);
    const branchContext = timesheetContext(fixture, false, [fixture.branchA.id]);

    const summary = await loadMonthlyAttendanceTimesheet({
      businessId: fixture.business.id,
      allowedBranchIds: [fixture.branchA.id],
      month: "2026-08",
      database: transaction,
    });
    assert.equal(summary.totals.sessions, 1);
    assert.equal(summary.totals.blockers, 1);
    assert.equal(summary.branches[0]?.readinessStatus, "NOT_READY");

    await assert.rejects(
      markAttendanceTimesheetBranchReady({ context: branchContext, month: "2026-08", branchId: fixture.branchA.id, database }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "BLOCKERS_REMAIN",
    );
    await assert.rejects(
      markAttendanceTimesheetBranchReady({ context: branchContext, month: "2026-08", branchId: fixture.branchB.id, database }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "BRANCH_NOT_FOUND",
    );
    assert.equal(await transaction.attendanceTimesheetBranchReadiness.count({
      where: { timesheet: { businessId: fixture.business.id } },
    }), 0);
    return fixture.business.id;
  });
});

async function withRollback(operation: (transaction: Prisma.TransactionClient) => Promise<string>) {
  assertLocalDatabase();
  let businessId: string | null = null;
  await assert.rejects(prisma.$transaction(async (transaction) => {
    businessId = await operation(transaction);
    throw new Error(rollbackMessage);
  }), (error: unknown) => error instanceof Error && error.message === rollbackMessage);
  assert.ok(businessId);
  assert.equal(await prisma.business.count({ where: { id: businessId } }), 0);
}

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({ data: { name: `Timesheet ${token}`, slug: `timesheet-${token}` } });
  const branchA = await transaction.branch.create({ data: { businessId: business.id, name: `A ${token}` } });
  const branchB = await transaction.branch.create({ data: { businessId: business.id, name: `B ${token}` } });
  const owner = await transaction.user.create({ data: { businessId: business.id, name: "Timesheet Owner", email: `timesheet-${token}@test.local`, role: "BUSINESS_OWNER" } });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const employeeAccount = await transaction.employeeAccount.create({ data: { phoneNumber: phone, phoneNormalized: phone, name: "Timesheet Employee" } });
  const membership = await transaction.employeeBusinessMembership.create({ data: { employeeAccountId: employeeAccount.id, businessId: business.id, employeeCode: `TS-${token}`, fullName: "Timesheet Employee", phoneNumber: phone, phoneNumberNormalized: phone } });
  return { business, branchA, branchB, owner, employeeAccount, membership };
}

async function createCompletedSession(transaction: Prisma.TransactionClient, fixture: Awaited<ReturnType<typeof createFixture>>, branchId: string, day: number) {
  const date = `2026-08-${String(day).padStart(2, "0")}`;
  return transaction.employeeAttendance.create({ data: {
    employeeAccountId: fixture.employeeAccount.id,
    membershipId: fixture.membership.id,
    businessId: fixture.business.id,
    branchId,
    workDate: new Date(`${date}T00:00:00.000Z`),
    status: "COMPLETED",
    clockInAt: new Date(`${date}T01:00:00.000Z`),
    clockOutAt: new Date(`${date}T10:00:00.000Z`),
    totalBreakMinutes: 60,
    totalWorkedMinutes: 480,
    expectedBreakMinutes: 60,
    confirmedBreakMinutes: 60,
    approvalStatus: "NOT_REQUIRED",
  } });
}

async function createIncompleteSession(transaction: Prisma.TransactionClient, fixture: Awaited<ReturnType<typeof createFixture>>, branchId: string, day: number) {
  const date = `2026-08-${String(day).padStart(2, "0")}`;
  return transaction.employeeAttendance.create({ data: {
    employeeAccountId: fixture.employeeAccount.id,
    membershipId: fixture.membership.id,
    businessId: fixture.business.id,
    branchId,
    workDate: new Date(`${date}T00:00:00.000Z`),
    status: "INCOMPLETE",
    clockInAt: new Date(`${date}T01:00:00.000Z`),
    totalBreakMinutes: 0,
    totalWorkedMinutes: 0,
    expectedBreakMinutes: 60,
    confirmedBreakMinutes: 0,
    approvalStatus: "PENDING",
  } });
}

function resolutionContext(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return { businessId: fixture.business.id, allowedBranchIds: [fixture.branchA.id, fixture.branchB.id], actor: { userId: fixture.owner.id, name: fixture.owner.name, email: fixture.owner.email ?? "" } };
}
function timesheetContext(fixture: Awaited<ReturnType<typeof createFixture>>, wholeBusinessScope: boolean, branches = [fixture.branchA.id, fixture.branchB.id]): AttendanceTimesheetContext {
  return { ...resolutionContext(fixture), allowedBranchIds: branches, wholeBusinessScope };
}
function transactionDatabase(transaction: Prisma.TransactionClient) { return { $transaction: async <T>(operation: (client: Prisma.TransactionClient) => Promise<T>) => operation(transaction) } as unknown as PrismaClient; }
async function expectDatabaseFailure(transaction: Prisma.TransactionClient, operation: () => Promise<unknown>, expected: RegExp) {
  const savepoint = `attendance_timesheet_${++savepointSequence}`;
  await transaction.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
  try { await assert.rejects(operation(), expected); } finally { await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`); await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`); }
}
function assertLocalDatabase() { const databaseUrl = process.env.DATABASE_URL; if (!databaseUrl) throw new Error("DATABASE_URL is required."); const hostname = new URL(databaseUrl).hostname; if (!["localhost", "127.0.0.1"].includes(hostname)) throw new Error("Attendance integration tests are restricted to the local database."); }
