import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadEmployeeCorrectionArchive } from "../../src/lib/attendance/employee-correction-archive";

const prisma = new PrismaClient();
const rollback = "EMPLOYEE_CORRECTION_ARCHIVE_TEST_ROLLBACK";

after(async () => prisma.$disconnect());

test("unified archive reads all canonical sources once and enforces employee scope", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const linkedException = await transaction.attendanceException.create({
      data: {
        attendanceSessionId: fixture.attendance.id,
        employeeId: fixture.membership.id,
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        type: "FORGOT_CLOCK_OUT",
        reason: "Linked exception represented by the resolution case.",
        requestedClockOutAt: new Date("2026-08-24T10:00:00.000Z"),
        createdAt: new Date("2026-08-24T10:01:00.000Z"),
      },
    });
    const resolutionCase = await transaction.attendanceResolutionCase.create({
      data: {
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        attendanceSessionId: fixture.attendance.id,
        employeeId: fixture.membership.id,
        status: "OPEN",
        openedReason: "INCOMPLETE_SESSION",
        openedAt: new Date("2026-08-24T10:02:00.000Z"),
      },
    });
    const standalone = await transaction.attendanceException.create({
      data: {
        employeeId: fixture.membership.id,
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        type: "FORGOT_CLOCK_IN",
        reason: "Standalone correction.",
        requestedClockInAt: new Date("2026-08-25T01:00:00.000Z"),
        createdAt: new Date("2026-08-25T01:01:00.000Z"),
      },
    });
    const p2Exception = await transaction.attendanceP2Exception.create({
      data: {
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        membershipId: fixture.membership.id,
        workDate: new Date("2026-08-26T00:00:00.000Z"),
        type: "MISSING_CLOCK_OUT",
        status: "PENDING_MANAGER",
        stableKey: `archive-${randomUUID()}`,
        reasonCode: "MISSING_CLOCK_OUT",
        sourceDigest: "a".repeat(64),
      },
    });
    const p2Request = await transaction.attendanceCorrectionRequest.create({
      data: {
        businessId: fixture.business.id,
        exceptionId: p2Exception.id,
        membershipId: fixture.membership.id,
        employeeSessionId: fixture.employeeSession.id,
        requestKey: `archive-request-${randomUUID()}`,
        requestedClockOutAt: new Date("2026-08-26T10:00:00.000Z"),
        reason: "P2 correction.",
        createdAt: new Date("2026-08-26T10:01:00.000Z"),
      },
    });
    await transaction.attendanceException.create({
      data: {
        employeeId: fixture.otherMembership.id,
        businessId: fixture.business.id,
        branchId: fixture.branch.id,
        type: "FORGOT_CLOCK_OUT",
        reason: "Must not leak across employee scope.",
        createdAt: new Date("2026-08-27T10:01:00.000Z"),
      },
    });

    const first = await loadEmployeeCorrectionArchive({
      auth: fixture.auth,
      input: { limit: 2 },
      database: transaction as unknown as PrismaClient,
    });
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);

    const second = await loadEmployeeCorrectionArchive({
      auth: fixture.auth,
      input: { limit: 2, cursor: first.nextCursor },
      database: transaction as unknown as PrismaClient,
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);

    const combined = [...first.items, ...second.items];
    assert.deepEqual(
      new Set(combined.map((item) => item.sourceKey)),
      new Set([
        `resolution:${resolutionCase.id}`,
        `exception:${standalone.id}`,
        `p2-request:${p2Request.id}`,
      ]),
    );
    assert.equal(new Set(combined.map((item) => item.sourceKey)).size, 3);
    assert.equal(
      combined.some((item) => item.sourceKey === `exception:${linkedException.id}`),
      false,
    );
    assert.ok(combined.every((item) => item.businessId === fixture.business.id));
    assert.ok(
      combined.every(
        (item) => item.employeeMembershipId === fixture.membership.id,
      ),
    );
    const resolution = combined.find(
      (item) => item.sourceType === "RESOLUTION_CASE",
    );
    assert.equal(resolution?.employeeStatus, "ACTION_REQUIRED");
    assert.equal(resolution?.canEmployeeAct, true);
    assert.equal(resolution?.nextAction, "SUBMIT");
    return fixture.business.id;
  });
});

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const business = await transaction.business.create({
    data: { name: `Correction Archive ${token}`, slug: `archive-${token}` },
  });
  const branch = await transaction.branch.create({
    data: { businessId: business.id, name: "Archive Branch" },
  });
  const account = await transaction.employeeAccount.create({
    data: {
      phoneNumber: "+60123456789",
      phoneNormalized: "+60123456789",
      name: "Archive Employee",
    },
  });
  const membership = await transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId: business.id,
      employeeCode: `ARCH-${token}`,
      fullName: "Archive Employee",
      phoneNumber: account.phoneNumber,
      phoneNumberNormalized: account.phoneNormalized,
      attendanceEnabled: true,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const otherAccount = await transaction.employeeAccount.create({
    data: {
      phoneNumber: "+60123456788",
      phoneNormalized: "+60123456788",
      name: "Other Employee",
    },
  });
  const otherMembership = await transaction.employeeBusinessMembership.create({
    data: {
      employeeAccountId: otherAccount.id,
      businessId: business.id,
      employeeCode: `OTHER-${token}`,
      fullName: "Other Employee",
      phoneNumber: otherAccount.phoneNumber,
      phoneNumberNormalized: otherAccount.phoneNormalized,
      attendanceEnabled: true,
      joinedAt: new Date("2026-01-01T00:00:00.000Z"),
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
    },
  });
  const attendance = await transaction.employeeAttendance.create({
    data: {
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: business.id,
      branchId: branch.id,
      workDate: new Date("2026-08-24T00:00:00.000Z"),
      status: "INCOMPLETE",
      clockInAt: new Date("2026-08-24T01:00:00.000Z"),
      approvalStatus: "PENDING",
    },
  });
  const device = await transaction.employeeDevice.create({
    data: {
      employeeAccountId: account.id,
      displayName: "Archive test device",
      deviceIdentifierHash: randomUUID(),
      status: "ACTIVE",
      canView: true,
      canPunch: true,
      firstVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
      lastActiveAt: new Date("2026-08-01T00:00:00.000Z"),
    },
  });
  const employeeSession = await transaction.employeeSession.create({
    data: {
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      employeeDeviceId: device.id,
      refreshTokenHash: randomUUID(),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    },
  });
  return {
    business,
    branch,
    membership,
    otherMembership,
    attendance,
    employeeSession,
    auth: {
      sessionId: employeeSession.id,
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      deviceId: device.id,
    },
  };
}

async function withRollback(
  operation: (transaction: Prisma.TransactionClient) => Promise<string>,
) {
  assertLocalDatabase();
  let id: string | null = null;
  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      id = await operation(transaction);
      throw new Error(rollback);
    }),
    (error: unknown) => error instanceof Error && error.message === rollback,
  );
  assert.ok(id);
  assert.equal(await prisma.business.count({ where: { id } }), 0);
}

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error("Correction archive integration tests require the local database.");
  }
}
