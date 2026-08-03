import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AttendanceServiceContext } from "../../src/lib/attendance/employee-service";
import {
  AttendanceResolutionError,
  materializeAttendanceResolutionFoundationInTransaction,
  resolveAttendanceCaseInTransaction,
} from "../../src/lib/attendance/resolution-service";

const prisma = new PrismaClient();
const rollbackMessage = "ATTENDANCE_RESOLUTION_TEST_ROLLBACK";
let savepointSequence = 0;

after(async () => {
  await prisma.$disconnect();
});

test("A1 Domain Service creates idempotent immutable results without changing finalized Payroll", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const context = serviceContext(fixture);
    const finalizedPayroll = await transaction.payrollRun.create({
      data: {
        businessId: fixture.business.id,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd: new Date("2026-07-31T00:00:00.000Z"),
        status: "FINALIZED",
        workingDaysPerMonthSnapshot: 26,
        normalWorkMinutesPerDaySnapshot: 480,
        breakMinutesPerDaySnapshot: 60,
        overtimeMultiplierSnapshot: "1.50",
        publicHolidayExtraMultiplierSnapshot: "2.00",
        createdById: fixture.owner.id,
        submittedById: fixture.owner.id,
        submittedAt: new Date("2026-08-01T01:00:00.000Z"),
        finalizedById: fixture.owner.id,
        finalizedAt: new Date("2026-08-01T02:00:00.000Z"),
      },
    });
    const payrollBefore = await transaction.payrollRun.findUniqueOrThrow({
      where: { id: finalizedPayroll.id },
    });

    const completed = await createSession(transaction, fixture, {
      status: "COMPLETED",
      approvalStatus: "NOT_REQUIRED",
    });
    const first = await materializeAttendanceResolutionFoundationInTransaction(
      { ...context, attendanceSessionId: completed.id },
      transaction,
    );
    assert.equal(first.status, "RESOLVED");
    assert.equal(first.currentFinalResult?.disposition, "INCLUDED");
    assert.equal(first.currentFinalResult?.version, 1);

    const replay = await materializeAttendanceResolutionFoundationInTransaction(
      { ...context, attendanceSessionId: completed.id },
      transaction,
    );
    assert.equal(replay.currentFinalResultId, first.currentFinalResultId);
    assert.equal(
      await transaction.attendanceFinalResult.count({
        where: { attendanceSessionId: completed.id },
      }),
      1,
    );

    const payrollAfter = await transaction.payrollRun.findUniqueOrThrow({
      where: { id: finalizedPayroll.id },
    });
    assert.deepEqual(payrollAfter, payrollBefore);

    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceFinalResult.update({
          where: { id: first.currentFinalResultId! },
          data: { totalWorkedMinutes: 1 },
        }),
      /Final Attendance Results are immutable/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceFinalResult.delete({
          where: { id: first.currentFinalResultId! },
        }),
      /Final Attendance Results are immutable/i,
    );

    return fixture.business.id;
  });
});

test("A1 keeps Pending, Rejected, and Incomplete sessions action-required and excludes Cancelled", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const context = serviceContext(fixture);
    const pending = await createSession(transaction, fixture, {
      status: "COMPLETED",
      approvalStatus: "PENDING",
    });
    const rejected = await createSession(transaction, fixture, {
      status: "COMPLETED",
      approvalStatus: "REJECTED",
    });
    const incomplete = await createSession(transaction, fixture, {
      status: "INCOMPLETE",
      approvalStatus: "PENDING",
      clockOutAt: null,
    });
    const cancelled = await createSession(transaction, fixture, {
      status: "CANCELLED",
      approvalStatus: "NOT_REQUIRED",
      clockOutAt: null,
    });

    for (const session of [pending, rejected, incomplete]) {
      const resolutionCase =
        await materializeAttendanceResolutionFoundationInTransaction(
          { ...context, attendanceSessionId: session.id },
          transaction,
        );
      assert.equal(resolutionCase.status, "OPEN");
      assert.equal(resolutionCase.currentFinalResult, null);
    }
    const cancelledCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...context, attendanceSessionId: cancelled.id },
        transaction,
      );
    assert.equal(cancelledCase.status, "RESOLVED");
    assert.equal(cancelledCase.currentFinalResult?.disposition, "EXCLUDED");

    return fixture.business.id;
  });
});

test("A1 resolution versions preserve history, enforce scope, and forbid self-resolution", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const context = serviceContext(fixture);
    const rejected = await createSession(transaction, fixture, {
      status: "COMPLETED",
      approvalStatus: "REJECTED",
    });
    const resolutionCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...context, attendanceSessionId: rejected.id },
        transaction,
      );

    const resolved = await resolveAttendanceCaseInTransaction(
      context,
      {
        resolutionCaseId: resolutionCase.id,
        disposition: "INCLUDED",
        source: "CORRECTION",
        expectedCurrentResultId: null,
      },
      transaction,
    );
    assert.equal(resolved.currentFinalResult?.version, 1);
    const firstResultId = resolved.currentFinalResultId!;

    const revised = await resolveAttendanceCaseInTransaction(
      context,
      {
        resolutionCaseId: resolutionCase.id,
        disposition: "EXCLUDED",
        source: "CORRECTION",
        expectedCurrentResultId: firstResultId,
      },
      transaction,
    );
    assert.equal(revised.currentFinalResult?.version, 2);
    assert.equal(revised.currentFinalResult?.supersedesResultId, firstResultId);
    assert.equal(
      await transaction.attendanceFinalResult.count({
        where: { resolutionCaseId: resolutionCase.id },
      }),
      2,
    );

    await assert.rejects(
      resolveAttendanceCaseInTransaction(
        { ...context, allowedBranchIds: [] },
        {
          resolutionCaseId: resolutionCase.id,
          disposition: "INCLUDED",
          source: "CORRECTION",
        },
        transaction,
      ),
      (error: unknown) => hasResolutionCode(error, "CASE_NOT_FOUND"),
    );
    await assert.rejects(
      resolveAttendanceCaseInTransaction(
        {
          ...context,
          actor: {
            userId: fixture.employeeUser.id,
            name: fixture.employeeUser.name,
            email: fixture.employeeUser.email ?? "",
          },
        },
        {
          resolutionCaseId: resolutionCase.id,
          disposition: "INCLUDED",
          source: "CORRECTION",
        },
        transaction,
      ),
      (error: unknown) => hasResolutionCode(error, "SELF_RESOLUTION_FORBIDDEN"),
    );

    return fixture.business.id;
  });
});

async function withRollback(
  operation: (transaction: Prisma.TransactionClient) => Promise<string>,
) {
  assertLocalDatabase();
  let businessId: string | null = null;
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      businessId = await operation(transaction);
      throw new Error(rollbackMessage);
    }),
    (error: unknown) =>
      error instanceof Error && error.message === rollbackMessage,
  );
  assert.ok(businessId);
  assert.equal(await prisma.business.count({ where: { id: businessId } }), 0);
}

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: {
      name: `Attendance Resolution ${token}`,
      slug: `attendance-resolution-${token}`,
    },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: `Main ${token}` },
  });
  const owner = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      name: "Resolution Owner",
      email: `resolution-owner-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const employeeAccount = await transaction.employeeAccount.create({
    data: {
      phoneNumber: phone,
      phoneNormalized: phone,
      name: "Resolution Employee",
    },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: employeeAccount.id,
      businessId: business.id,
      employeeCode: `RES-${token}`,
      fullName: "Resolution Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      attendanceEnabled: false,
    },
  });
  const employeeUser = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      employeeAccountId: employeeAccount.id,
      employeeBusinessMembershipId: membership.id,
      teamMemberLinkStatus: "LINKED",
      teamMemberLinkedAt: new Date(),
      name: "Resolution Employee",
      email: `resolution-employee-${token}@test.local`,
      role: "STAFF",
    },
  });
  return { business, branch, owner, employeeAccount, membership, employeeUser };
}

async function createSession(
  transaction: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  input: {
    status: "COMPLETED" | "INCOMPLETE" | "CANCELLED";
    approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
    clockOutAt?: Date | null;
  },
) {
  const clockInAt = new Date("2026-08-02T01:00:00.000Z");
  const clockOutAt =
    input.clockOutAt === undefined
      ? new Date("2026-08-02T10:00:00.000Z")
      : input.clockOutAt;
  return transaction.employeeAttendance.create({
    data: {
      employeeAccountId: fixture.employeeAccount.id,
      membershipId: fixture.membership.id,
      businessId: fixture.business.id,
      branchId: fixture.branch.id,
      workDate: new Date("2026-08-02T00:00:00.000Z"),
      status: input.status,
      clockInAt,
      clockOutAt,
      totalBreakMinutes: clockOutAt ? 60 : 0,
      totalWorkedMinutes: clockOutAt ? 480 : 0,
      expectedBreakMinutes: 60,
      confirmedBreakMinutes: clockOutAt ? 60 : null,
      requiresApproval: input.approvalStatus !== "NOT_REQUIRED",
      approvalStatus: input.approvalStatus,
    },
  });
}

function serviceContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): AttendanceServiceContext {
  return {
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    wholeBusinessScope: true,
    actor: {
      userId: fixture.owner.id,
      name: fixture.owner.name,
      email: fixture.owner.email ?? "",
    },
  };
}

async function expectDatabaseFailure(
  transaction: Prisma.TransactionClient,
  operation: () => Promise<unknown>,
  expected: RegExp,
) {
  const savepoint = `attendance_resolution_${++savepointSequence}`;
  await transaction.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
  try {
    await assert.rejects(operation(), expected);
  } finally {
    await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
    await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
  }
}

function hasResolutionCode(
  error: unknown,
  code: AttendanceResolutionError["code"],
) {
  return error instanceof AttendanceResolutionError && error.code === code;
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Attendance integration tests.");
  }
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Attendance integration tests are restricted to the local database.");
  }
}
