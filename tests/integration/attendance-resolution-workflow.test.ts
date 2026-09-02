import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import type { AttendanceServiceContext } from "../../src/lib/attendance/employee-service";
import { materializeAttendanceResolutionFoundationInTransaction } from "../../src/lib/attendance/resolution-service";
import {
  applyManagerAttendanceResolution,
  cancelEmployeeAttendanceResolution,
  submitEmployeeAttendanceResolution,
} from "../../src/lib/attendance/resolution-workflow-service";
import { loadAttendanceResolutionQueue } from "../../src/lib/attendance/resolution-read-service";

const prisma = new PrismaClient();
const rollbackMessage = "ATTENDANCE_RESOLUTION_WORKFLOW_TEST_ROLLBACK";
let savepointSequence = 0;

after(async () => {
  await prisma.$disconnect();
});

test("A2 employee resubmit, manager return, and correction create an immutable workflow", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await createSession(transaction, fixture, "INCOMPLETE");
    const resolutionCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        {
          ...managerContext(fixture),
          attendanceSessionId: session.id,
        },
        transaction,
      );
    const database = transactionDatabase(transaction);

    await assert.rejects(
      applyManagerAttendanceResolution({
        context: managerContext(fixture),
        input: {
          resolutionCaseId: resolutionCase.id,
          action: "EXCLUDE",
          reason: "Manager must wait for the employee response.",
          expectedUpdatedAt: resolutionCase.updatedAt.toISOString(),
        },
        database,
      }),
      /not ready for manager review/i,
    );

    const submitted = await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        reason: "I forgot to clock out after closing duties.",
        proposedClockInLocal: "2026-08-02T09:00",
        proposedClockOutLocal: "2026-08-02T18:00",
        proposedBreakMinutes: 60,
      },
      database,
    });
    assert.equal(submitted.status, "UNDER_REVIEW");

    const afterSubmission =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    const returned = await applyManagerAttendanceResolution({
      context: managerContext(fixture),
      input: {
        resolutionCaseId: resolutionCase.id,
        action: "RETURN_TO_EMPLOYEE",
        reason: "Confirm the actual closing time.",
        expectedUpdatedAt: afterSubmission.updatedAt.toISOString(),
        expectedCurrentResultId: null,
      },
      database,
    });
    assert.equal(returned.status, "RETURNED_FOR_CORRECTION");

    const returnedCase =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    await assert.rejects(
      applyManagerAttendanceResolution({
        context: managerContext(fixture),
        input: {
          resolutionCaseId: resolutionCase.id,
          action: "EXCLUDE",
          reason: "Manager must wait for the corrected employee response.",
          expectedUpdatedAt: returnedCase.updatedAt.toISOString(),
        },
        database,
      }),
      /not ready for manager review/i,
    );

    await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        reason: "Confirmed with the closing checklist: I left at 6:15 pm.",
        proposedClockInLocal: "2026-08-02T09:00",
        proposedClockOutLocal: "2026-08-02T18:15",
        proposedBreakMinutes: 60,
      },
      database,
    });
    const resubmittedCase =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    await assert.rejects(
      cancelEmployeeAttendanceResolution({
        auth: fixture.employeeAuth,
        input: {
          resolutionCaseId: resolutionCase.id,
          expectedUpdatedAt: resubmittedCase.updatedAt.toISOString(),
        },
        database,
      }),
      /can no longer be cancelled/i,
    );
    const beforeDecision =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    const resolved = await applyManagerAttendanceResolution({
      context: managerContext(fixture),
      input: {
        resolutionCaseId: resolutionCase.id,
        action: "APPLY_CORRECTION",
        reason: "Closing checklist confirms the corrected clock-out.",
        correctedClockInLocal: "2026-08-02T09:00",
        correctedClockOutLocal: "2026-08-02T18:15",
        correctedBreakMinutes: 60,
        expectedUpdatedAt: beforeDecision.updatedAt.toISOString(),
        expectedCurrentResultId: null,
      },
      database,
    });
    assert.equal(resolved.status, "RESOLVED");

    const finalResult = await transaction.attendanceFinalResult.findUniqueOrThrow({
      where: { id: resolved.finalResultId! },
    });
    assert.equal(finalResult.source, "CORRECTION");
    assert.equal(finalResult.totalBreakMinutes, 60);
    assert.equal(finalResult.totalWorkedMinutes, 495);
    assert.equal(
      await transaction.attendanceResolutionEvent.count({
        where: { resolutionCaseId: resolutionCase.id },
      }),
      4,
    );
    assert.equal(
      await transaction.attendanceAdjustment.count({
        where: { attendanceSessionId: session.id },
      }),
      1,
    );

    const firstAdjustment =
      await transaction.attendanceAdjustment.findFirstOrThrow({
        where: { attendanceSessionId: session.id },
      });
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceAdjustment.update({
          where: { id: firstAdjustment.id },
          data: { reason: "tampered" },
        }),
      /Attendance Adjustments are immutable/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceAdjustment.delete({
          where: { id: firstAdjustment.id },
        }),
      /Attendance Adjustments are immutable/i,
    );
    assert.deepEqual(
      await transaction.attendanceAdjustment.findUniqueOrThrow({
        where: { id: firstAdjustment.id },
      }),
      firstAdjustment,
    );

    const resolvedCase =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    const revised = await applyManagerAttendanceResolution({
      context: managerContext(fixture),
      input: {
        resolutionCaseId: resolutionCase.id,
        action: "APPLY_CORRECTION",
        reason: "Manager confirmed a later departure after the first decision.",
        correctedClockInLocal: "2026-08-02T09:00",
        correctedClockOutLocal: "2026-08-02T18:30",
        correctedBreakMinutes: 60,
        expectedUpdatedAt: resolvedCase.updatedAt.toISOString(),
        expectedCurrentResultId: finalResult.id,
      },
      database,
    });
    const revisedResult =
      await transaction.attendanceFinalResult.findUniqueOrThrow({
        where: { id: revised.finalResultId! },
      });
    assert.equal(revisedResult.version, 2);
    assert.equal(revisedResult.supersedesResultId, finalResult.id);
    assert.equal(revisedResult.totalWorkedMinutes, 510);
    assert.equal(
      (await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      })).currentFinalResultId,
      revisedResult.id,
    );
    assert.deepEqual(
      await transaction.attendanceFinalResult.findUniqueOrThrow({
        where: { id: finalResult.id },
      }),
      finalResult,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceFinalResult.update({
          where: { id: finalResult.id },
          data: { totalWorkedMinutes: 1 },
        }),
      /Final Attendance Results are immutable/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceFinalResult.delete({
          where: { id: finalResult.id },
        }),
      /Final Attendance Results are immutable/i,
    );
    assert.equal(
      await transaction.attendanceAdjustment.count({
        where: { attendanceSessionId: session.id },
      }),
      2,
    );
    assert.equal(
      await transaction.attendanceResolutionEvent.count({
        where: { resolutionCaseId: resolutionCase.id },
      }),
      5,
    );

    const operationalSession =
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: session.id },
      });
    assert.equal(operationalSession.status, "INCOMPLETE");
    assert.equal(operationalSession.clockOutAt, null);

    const event = await transaction.attendanceResolutionEvent.findFirstOrThrow({
      where: { resolutionCaseId: resolutionCase.id },
    });
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.attendanceResolutionEvent.update({
          where: { id: event.id },
          data: { reason: "tampered" },
        }),
      /Attendance Resolution Events are immutable/i,
    );
    await expectDatabaseFailure(
      transaction,
      () => transaction.attendanceResolutionEvent.delete({ where: { id: event.id } }),
      /Attendance Resolution Events are immutable/i,
    );

    return fixture.business.id;
  });
});

test("A2.1 employee cancellation is append-only, owned, deadline-bound, and resubmittable", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await createSession(transaction, fixture, "INCOMPLETE");
    const resolutionCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...managerContext(fixture), attendanceSessionId: session.id },
        transaction,
      );
    const database = transactionDatabase(transaction);
    await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        reason: "I need to correct my first explanation.",
      },
      database,
    });
    const submittedCase =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    const sessionBefore =
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: session.id },
      });
    const cancelled = await cancelEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        expectedUpdatedAt: submittedCase.updatedAt.toISOString(),
      },
      now: new Date(),
      database,
    });
    assert.equal(cancelled.status, "ACTION_REQUIRED");
    const afterCancel =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
    assert.equal(afterCancel.status, "OPEN");
    assert.equal(afterCancel.currentFinalResultId, null);
    assert.deepEqual(
      afterCancel.events.map((event) => event.type),
      ["EMPLOYEE_SUBMITTED", "EMPLOYEE_CANCELLED"],
    );
    assert.deepEqual(
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: session.id },
      }),
      sessionBefore,
    );
    assert.equal(
      await transaction.attendanceFinalResult.count({
        where: { resolutionCaseId: resolutionCase.id },
      }),
      0,
    );
    assert.equal(
      await transaction.auditLog.count({
        where: {
          action: "ATTENDANCE_RESOLUTION_EMPLOYEE_CANCELLED",
          entityId: resolutionCase.id,
        },
      }),
      1,
    );

    const resubmitted = await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        reason: "This is my corrected explanation.",
      },
      database,
    });
    assert.equal(resubmitted.status, "UNDER_REVIEW");
    const afterResubmit =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      });
    await assert.rejects(
      cancelEmployeeAttendanceResolution({
        auth: { ...fixture.employeeAuth, membershipId: randomUUID() },
        input: {
          resolutionCaseId: resolutionCase.id,
          expectedUpdatedAt: afterResubmit.updatedAt.toISOString(),
        },
        database,
      }),
      /can no longer be cancelled/i,
    );

    const deadlineSession = await createSession(transaction, fixture, "INCOMPLETE");
    const deadlineCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...managerContext(fixture), attendanceSessionId: deadlineSession.id },
        transaction,
      );
    await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: deadlineCase.id,
        reason: "Deadline cancellation test.",
      },
      database,
    });
    const deadlineCurrent =
      await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: deadlineCase.id },
        include: { events: { orderBy: { sequence: "desc" }, take: 1 } },
      });
    await assert.rejects(
      cancelEmployeeAttendanceResolution({
        auth: fixture.employeeAuth,
        input: {
          resolutionCaseId: deadlineCase.id,
          expectedUpdatedAt: deadlineCurrent.updatedAt.toISOString(),
        },
        now: new Date(
          deadlineCurrent.events[0]!.createdAt.getTime() + 16 * 60_000,
        ),
        database,
      }),
      /can no longer be cancelled/i,
    );

    return fixture.business.id;
  });
});

test("A2.1 resolution queue paginates 25 stable cases without duplicates or omissions", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    for (let index = 0; index < 25; index += 1) {
      const session = await createSession(transaction, fixture, "INCOMPLETE");
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...managerContext(fixture), attendanceSessionId: session.id },
        transaction,
      );
    }
    const base = {
      scope: {
        businessId: fixture.business.id,
        allowedBranchIds: [fixture.branch.id],
      },
      pageSize: 20,
      status: "ACTION_REQUIRED" as const,
      branchId: fixture.branch.id,
      employeeQuery: "Workflow Employee",
      database: transaction as unknown as PrismaClient,
    };
    const first = await loadAttendanceResolutionQueue({ ...base, page: 1 });
    const second = await loadAttendanceResolutionQueue({ ...base, page: 2 });
    assert.equal(first.pagination.total, 25);
    assert.equal(first.pagination.totalPages, 2);
    assert.equal(first.items.length, 20);
    assert.equal(second.items.length, 5);
    const allIds = [...first.items, ...second.items].map((item) => item.id);
    assert.equal(new Set(allIds).size, 25);
    assert.equal(
      await transaction.attendanceResolutionCase.count({
        where: { id: { in: allIds } },
      }),
      25,
    );
    return fixture.business.id;
  });
});

test("A2 enforces employee ownership, branch scope, self-resolution, and atomic rollback", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await createSession(transaction, fixture, "INCOMPLETE");
    const resolutionCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...managerContext(fixture), attendanceSessionId: session.id },
        transaction,
      );
    const database = transactionDatabase(transaction);

    await assert.rejects(
      submitEmployeeAttendanceResolution({
        auth: { ...fixture.employeeAuth, membershipId: randomUUID() },
        input: { resolutionCaseId: resolutionCase.id, reason: "Wrong employee." },
        database,
      }),
      /no longer waiting/i,
    );

    await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: { resolutionCaseId: resolutionCase.id, reason: "Please review this shift." },
      database,
    });
    const current = await transaction.attendanceResolutionCase.findUniqueOrThrow({
      where: { id: resolutionCase.id },
    });
    await assert.rejects(
      applyManagerAttendanceResolution({
        context: { ...managerContext(fixture), allowedBranchIds: [] },
        input: {
          resolutionCaseId: resolutionCase.id,
          action: "EXCLUDE",
          reason: "Out of scope attempt.",
          expectedUpdatedAt: current.updatedAt.toISOString(),
        },
        database,
      }),
      /authorized branch scope/i,
    );
    await assert.rejects(
      applyManagerAttendanceResolution({
        context: {
          ...managerContext(fixture),
          actor: {
            userId: fixture.employeeUser.id,
            name: fixture.employeeUser.name,
            email: fixture.employeeUser.email ?? "",
          },
        },
        input: {
          resolutionCaseId: resolutionCase.id,
          action: "EXCLUDE",
          reason: "Self resolution attempt.",
          expectedUpdatedAt: current.updatedAt.toISOString(),
        },
        database,
      }),
      /cannot resolve their own/i,
    );

    const eventsBefore = await transaction.attendanceResolutionEvent.count({
      where: { resolutionCaseId: resolutionCase.id },
    });
    await assert.rejects(
      applyManagerAttendanceResolution({
        context: managerContext(fixture),
        input: {
          resolutionCaseId: resolutionCase.id,
          action: "ACCEPT_AS_RECORDED",
          reason: "Invalid because the session has no clock-out.",
          expectedUpdatedAt: current.updatedAt.toISOString(),
          expectedCurrentResultId: null,
        },
        database,
      }),
      /requires a valid clock-in and clock-out/i,
    );
    assert.equal(
      await transaction.attendanceResolutionEvent.count({
        where: { resolutionCaseId: resolutionCase.id },
      }),
      eventsBefore,
    );
    assert.equal(
      (await transaction.attendanceResolutionCase.findUniqueOrThrow({
        where: { id: resolutionCase.id },
      })).status,
      "UNDER_REVIEW",
    );

    return fixture.business.id;
  });
});

test("A2 manager acceptance synchronizes legacy approval state before creating the final result", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const session = await transaction.employeeAttendance.create({
      data: {
        employeeAccountId: fixture.employeeAccount.id,
        membershipId: fixture.membership.id,
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        workDate: new Date("2026-08-03T00:00:00.000Z"),
        status: "COMPLETED",
        clockInAt: new Date("2026-08-03T01:00:00.000Z"),
        clockOutAt: new Date("2026-08-03T10:00:00.000Z"),
        totalBreakMinutes: 60,
        totalWorkedMinutes: 480,
        expectedBreakMinutes: 60,
        requiresApproval: true,
        approvalStatus: "PENDING",
      },
    });
    const exception = await transaction.attendanceException.create({
      data: {
        attendanceSessionId: session.id,
        employeeId: fixture.membership.id,
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        type: "OUTSIDE_GEOFENCE",
        reason: "Manager review required for the accepted location exception.",
        status: "PENDING",
      },
    });
    const resolutionCase =
      await materializeAttendanceResolutionFoundationInTransaction(
        { ...managerContext(fixture), attendanceSessionId: session.id },
        transaction,
      );
    const database = transactionDatabase(transaction);

    await submitEmployeeAttendanceResolution({
      auth: fixture.employeeAuth,
      input: {
        resolutionCaseId: resolutionCase.id,
        reason: "I was working at the approved off-site location.",
      },
      database,
    });
    const current = await transaction.attendanceResolutionCase.findUniqueOrThrow({
      where: { id: resolutionCase.id },
    });
    const resolved = await applyManagerAttendanceResolution({
      context: managerContext(fixture),
      input: {
        resolutionCaseId: resolutionCase.id,
        action: "ACCEPT_AS_RECORDED",
        reason: "The off-site attendance is approved.",
        expectedUpdatedAt: current.updatedAt.toISOString(),
        expectedCurrentResultId: null,
      },
      database,
    });

    assert.equal(resolved.status, "RESOLVED");
    const synchronizedSession =
      await transaction.employeeAttendance.findUniqueOrThrow({
        where: { id: session.id },
      });
    assert.equal(synchronizedSession.requiresApproval, true);
    assert.equal(synchronizedSession.approvalStatus, "APPROVED");
    const synchronizedException =
      await transaction.attendanceException.findUniqueOrThrow({
        where: { id: exception.id },
      });
    assert.equal(synchronizedException.status, "APPROVED");
    assert.equal(synchronizedException.reviewedBy, fixture.owner.id);
    assert.ok(synchronizedException.reviewedAt);
    const finalResult = await transaction.attendanceFinalResult.findUniqueOrThrow({
      where: { id: resolved.finalResultId! },
    });
    assert.equal(finalResult.disposition, "INCLUDED");
    assert.equal(finalResult.approvalStatusSnapshot, "APPROVED");

    return fixture.business.id;
  });
});

async function withRollback(operation: (transaction: Prisma.TransactionClient) => Promise<string>) {
  assertLocalDatabase();
  let businessId: string | null = null;
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      businessId = await operation(transaction);
      throw new Error(rollbackMessage);
    }),
    (error: unknown) => error instanceof Error && error.message === rollbackMessage,
  );
  assert.ok(businessId);
  assert.equal(await prisma.business.count({ where: { id: businessId } }), 0);
}

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: { name: `Resolution Workflow ${token}`, slug: `resolution-workflow-${token}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: `Main ${token}` },
  });
  const owner = await transaction.user.create({
    data: {
      businessId: business.id,
      branchId: branch.id,
      name: "Workflow Manager",
      email: `workflow-manager-${token}@test.local`,
      role: "BUSINESS_OWNER",
    },
  });
  const phone = `+601${randomInt(10_000_000, 99_999_999)}`;
  const employeeAccount = await transaction.employeeAccount.create({
    data: { phoneNumber: phone, phoneNormalized: phone, name: "Workflow Employee" },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: employeeAccount.id,
      businessId: business.id,
      employeeCode: `WF-${token}`,
      fullName: "Workflow Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      attendanceEnabled: true,
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
      name: "Workflow Employee",
      email: `workflow-employee-${token}@test.local`,
      role: "STAFF",
    },
  });
  await transaction.employeeBranchAssignment.create({
    data: {
      membershipId: membership.id,
      businessId: business.id,
      branchId: branch.id,
      isPrimary: true,
      canClockIn: true,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  const device = await transaction.employeeDevice.create({
    data: {
      employeeAccountId: employeeAccount.id,
      deviceIdentifierHash: randomUUID().replaceAll("-", ""),
      displayName: "Workflow test device",
    },
  });
  const employeeSession = await transaction.employeeSession.create({
    data: {
      employeeAccountId: employeeAccount.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      attendanceBranchId: branch.id,
      employeeDeviceId: device.id,
      refreshTokenHash: randomUUID().replaceAll("-", ""),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return {
    business,
    branch,
    owner,
    employeeAccount,
    membership,
    employeeUser,
    employeeAuth: {
      sessionId: employeeSession.id,
      employeeAccountId: employeeAccount.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      attendanceBranchId: branch.id,
      deviceId: device.id,
    },
  };
}

async function createSession(
  transaction: Prisma.TransactionClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
  status: "INCOMPLETE",
) {
  return transaction.employeeAttendance.create({
    data: {
      employeeAccountId: fixture.employeeAccount.id,
      membershipId: fixture.membership.id,
      businessId: fixture.business.id,
      branchId: fixture.branch.id,
      workDate: new Date("2026-08-02T00:00:00.000Z"),
      status,
      clockInAt: new Date("2026-08-02T01:00:00.000Z"),
      clockOutAt: null,
      totalBreakMinutes: 0,
      totalWorkedMinutes: 0,
      expectedBreakMinutes: 60,
      requiresApproval: true,
      approvalStatus: "PENDING",
    },
  });
}

function managerContext(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): AttendanceServiceContext {
  return {
    businessId: fixture.business.id,
    allowedBranchIds: [fixture.branch.id],
    actor: {
      userId: fixture.owner.id,
      name: fixture.owner.name,
      email: fixture.owner.email ?? "",
    },
  };
}

function transactionDatabase(transaction: Prisma.TransactionClient) {
  return {
    $transaction: async <T>(
      operation: (client: Prisma.TransactionClient) => Promise<T>,
    ) => operation(transaction),
  } as unknown as PrismaClient;
}

async function expectDatabaseFailure(
  transaction: Prisma.TransactionClient,
  operation: () => Promise<unknown>,
  expected: RegExp,
) {
  const savepoint = `attendance_resolution_workflow_${++savepointSequence}`;
  await transaction.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
  try {
    await assert.rejects(operation(), expected);
  } finally {
    await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
    await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
  }
}

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname;
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error("Attendance integration tests are restricted to the local database.");
  }
}
