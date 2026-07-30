import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rollbackMessage = "ATTENDANCE_TEST_ROLLBACK";
let savepointSequence = 0;

after(async () => {
  await prisma.$disconnect();
});

test("database guards reject cross-business and cross-branch Attendance writes", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    await insertAssignment(transaction, {
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      isPrimary: true,
    });

    await expectDatabaseFailure(
      transaction,
      () =>
        insertAssignment(transaction, {
          membershipId: fixture.membershipId,
          businessId: fixture.businessB.id,
          branchId: fixture.branchB.id,
        }),
      /Employee assignment business scope mismatch/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        insertAssignment(transaction, {
          membershipId: fixture.membershipId,
          businessId: fixture.businessA.id,
          branchId: fixture.branchB.id,
        }),
      /Employee assignment branch scope mismatch/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        insertPunch(transaction, {
          membershipId: fixture.membershipId,
          businessId: fixture.businessB.id,
          branchId: fixture.branchB.id,
        }),
      /Attendance punch employee scope mismatch/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        insertPunch(transaction, {
          membershipId: fixture.membershipId,
          businessId: fixture.businessA.id,
          branchId: fixture.branchB.id,
        }),
      /Attendance punch branch scope mismatch/i,
    );

    return fixture.businessA.id;
  });
});

test("Attendance Punch rows reject UPDATE and DELETE", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    const punchId = randomUUID();
    await insertPunch(transaction, {
      id: punchId,
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
    });

    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'UPDATE "attendance_punches" SET "ip_address" = $1 WHERE "id" = $2::uuid',
          "127.0.0.1",
          punchId,
        ),
      /Attendance punches are immutable/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'DELETE FROM "attendance_punches" WHERE "id" = $1::uuid',
          punchId,
        ),
      /Attendance punches are immutable/i,
    );

    const rows = await transaction.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT count(*)::integer AS "count" FROM "attendance_punches" WHERE "id" = $1::uuid',
      punchId,
    );
    assert.equal(rows[0]?.count, 1);

    return fixture.businessA.id;
  });
});

test("one employee membership can have only one active Attendance session", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    await insertAttendanceSession(transaction, {
      employeeAccountId: fixture.employeeAccountId,
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      status: "OPEN",
    });

    await expectDatabaseFailure(
      transaction,
      () =>
        insertAttendanceSession(transaction, {
          employeeAccountId: fixture.employeeAccountId,
          membershipId: fixture.membershipId,
          businessId: fixture.businessA.id,
          branchId: fixture.branchA.id,
          status: "ON_BREAK",
        }),
      /23505|membership_id.*already exists/i,
    );

    const rows = await transaction.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT count(*)::integer AS "count"
       FROM "employee_attendance"
       WHERE "membership_id" = $1::uuid
         AND "status" IN ('OPEN', 'ON_BREAK')`,
      fixture.membershipId,
    );
    assert.equal(rows[0]?.count, 1);

    return fixture.businessA.id;
  });
});

test("hardening rejects invalid punch links, cross-scope actors, parent moves, and TRUNCATE", async () => {
  await withRollback(async (transaction) => {
    const fixture = await createFixture(transaction);
    await insertAssignment(transaction, {
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      isPrimary: true,
    });

    const sessionId = randomUUID();
    await insertAttendanceSession(transaction, {
      id: sessionId,
      employeeAccountId: fixture.employeeAccountId,
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      status: "OPEN",
    });

    const wrongTypePunchId = randomUUID();
    await insertPunch(transaction, {
      id: wrongTypePunchId,
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      attendanceSessionId: sessionId,
      type: "CLOCK_OUT",
    });
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'UPDATE "employee_attendance" SET "clock_in_punch_id" = $1::uuid WHERE "id" = $2::uuid',
          wrongTypePunchId,
          sessionId,
        ),
      /clock-in punch ownership or type mismatch/i,
    );

    const clockInPunchId = randomUUID();
    await insertPunch(transaction, {
      id: clockInPunchId,
      membershipId: fixture.membershipId,
      businessId: fixture.businessA.id,
      branchId: fixture.branchA.id,
      attendanceSessionId: sessionId,
      type: "CLOCK_IN",
    });
    await transaction.$executeRawUnsafe(
      'UPDATE "employee_attendance" SET "clock_in_punch_id" = $1::uuid WHERE "id" = $2::uuid',
      clockInPunchId,
      sessionId,
    );

    const otherBusinessActor = await transaction.user.create({
      data: {
        businessId: fixture.businessB.id,
        branchId: fixture.branchB.id,
        email: `attendance-reviewer-${randomUUID()}@test.local`,
        name: "Other Business Reviewer",
        role: "BUSINESS_OWNER",
      },
    });

    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          `INSERT INTO "attendance_exceptions" (
             "id", "employee_id", "business_id", "branch_id", "type",
             "reason", "status", "reviewed_by", "created_at"
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'OTHER',
             'Cross-scope reviewer', 'APPROVED', $5::uuid, CURRENT_TIMESTAMP
           )`,
          randomUUID(),
          fixture.membershipId,
          fixture.businessA.id,
          fixture.branchA.id,
          otherBusinessActor.id,
        ),
      /reviewer scope mismatch/i,
    );

    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          `INSERT INTO "attendance_adjustments" (
             "id", "business_id", "branch_id", "attendance_session_id",
             "employee_id", "reason", "adjusted_by", "created_at"
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5::uuid, 'Cross-scope actor', $6::uuid, CURRENT_TIMESTAMP
           )`,
          randomUUID(),
          fixture.businessA.id,
          fixture.branchA.id,
          sessionId,
          fixture.membershipId,
          otherBusinessActor.id,
        ),
      /adjustment actor scope mismatch/i,
    );

    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'UPDATE "branches" SET "business_id" = $1::uuid WHERE "id" = $2::uuid',
          fixture.businessB.id,
          fixture.branchA.id,
        ),
      /Branch business cannot change after attendance data exists/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'UPDATE "employee_business_memberships" SET "business_id" = $1::uuid WHERE "id" = $2::uuid',
          fixture.businessB.id,
          fixture.membershipId,
        ),
      /membership tenant keys cannot change/i,
    );
    await expectDatabaseFailure(
      transaction,
      () =>
        transaction.$executeRawUnsafe(
          'TRUNCATE TABLE "attendance_punches" CASCADE',
        ),
      /Attendance punches are immutable|cannot TRUNCATE .* pending trigger events/i,
    );

    return fixture.businessA.id;
  });
});

test("attendance-enabled employee requires one active primary assignment at commit", async () => {
  assertLocalDatabase();
  let attemptedBusinessId: string | null = null;

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      const fixture = await createFixture(transaction);
      attemptedBusinessId = fixture.businessA.id;
    }),
    /must have exactly one active primary assignment/i,
  );

  assert.ok(attemptedBusinessId);
  assert.equal(
    await prisma.business.count({
      where: {
        id: attemptedBusinessId,
      },
    }),
    0,
    "deferred primary-assignment failure must roll back the fixture",
  );
});

async function withRollback(
  operation: (transaction: Prisma.TransactionClient) => Promise<string>,
) {
  assertLocalDatabase();
  let rollbackBusinessId: string | null = null;
  let reachedRollback = false;

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      rollbackBusinessId = await operation(transaction);
      reachedRollback = true;
      throw new Error(rollbackMessage);
    }),
    (error: unknown) =>
      error instanceof Error && error.message === rollbackMessage,
  );

  assert.equal(reachedRollback, true, "test transaction must reach rollback sentinel");
  assert.ok(rollbackBusinessId);
  assert.equal(
    await prisma.business.count({ where: { id: rollbackBusinessId } }),
    0,
    "fixture business must not survive the interactive transaction rollback",
  );
}

async function expectDatabaseFailure(
  transaction: Prisma.TransactionClient,
  operation: () => Promise<unknown>,
  expected: RegExp,
) {
  const savepoint = `attendance_guard_${++savepointSequence}`;
  await transaction.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);

  try {
    await assert.rejects(operation(), expected);
  } finally {
    await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
    await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
  }
}

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const phoneNumber = `+601${randomInt(10_000_000, 99_999_999)}`;
  const businessA = await transaction.business.create({
    data: {
      name: `Attendance Guard A ${token}`,
      slug: `attendance-guard-a-${token}`,
    },
  });
  const businessB = await transaction.business.create({
    data: {
      name: `Attendance Guard B ${token}`,
      slug: `attendance-guard-b-${token}`,
    },
  });
  const branchA = await transaction.branch.create({
    data: {
      businessId: businessA.id,
      name: `Attendance Branch A ${token}`,
    },
  });
  const branchB = await transaction.branch.create({
    data: {
      businessId: businessB.id,
      name: `Attendance Branch B ${token}`,
    },
  });
  const employeeAccountId = randomUUID();
  const membershipId = randomUUID();

  await transaction.$executeRawUnsafe(
    `INSERT INTO "employee_accounts" (
       "id", "phone_number", "phone_normalized", "name", "status",
       "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    employeeAccountId,
    phoneNumber,
    `Attendance Employee ${token}`,
  );
  await transaction.$executeRawUnsafe(
    `INSERT INTO "employee_business_memberships" (
       "id", "employee_account_id", "business_id", "employee_code",
       "full_name", "phone_number", "phone_number_normalized",
       "employment_type", "status", "attendance_enabled", "joined_at",
       "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $6,
       'FULL_TIME', 'ACTIVE', true, CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    membershipId,
    employeeAccountId,
    businessA.id,
    `ATT-${token}`,
    `Attendance Employee ${token}`,
    phoneNumber,
  );

  return {
    businessA,
    businessB,
    branchA,
    branchB,
    employeeAccountId,
    membershipId,
  };
}

async function insertAssignment(
  transaction: Prisma.TransactionClient,
  input: {
    membershipId: string;
    businessId: string;
    branchId: string;
    isPrimary?: boolean;
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "employee_branch_assignments" (
       "id", "membership_id", "business_id", "branch_id", "is_primary",
       "can_clock_in", "effective_from", "status", "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
       true, CURRENT_TIMESTAMP, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    randomUUID(),
    input.membershipId,
    input.businessId,
    input.branchId,
    input.isPrimary ?? false,
  );
}

async function insertPunch(
  transaction: Prisma.TransactionClient,
  input: {
    id?: string;
    attendanceSessionId?: string;
    type?: "CLOCK_IN" | "CLOCK_OUT";
    membershipId: string;
    businessId: string;
    branchId: string;
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "attendance_punches" (
       "id", "business_id", "branch_id", "employee_id",
       "attendance_session_id", "type", "server_timestamp",
       "inside_geofence", "geofence_status", "source", "created_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, $6::"AttendancePunchType", CURRENT_TIMESTAMP,
       true, 'INSIDE', 'SYSTEM', CURRENT_TIMESTAMP
     )`,
    input.id ?? randomUUID(),
    input.businessId,
    input.branchId,
    input.membershipId,
    input.attendanceSessionId ?? null,
    input.type ?? "CLOCK_IN",
  );
}

async function insertAttendanceSession(
  transaction: Prisma.TransactionClient,
  input: {
    id?: string;
    employeeAccountId: string;
    membershipId: string;
    businessId: string;
    branchId: string;
    status: "OPEN" | "ON_BREAK";
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "employee_attendance" (
       "id", "employee_account_id", "membership_id", "business_id",
       "branch_id", "work_date", "status", "clock_in_at",
       "total_break_minutes", "total_worked_minutes", "requires_approval",
       "approval_status", "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, CURRENT_DATE, $6::"EmployeeAttendanceStatus", CURRENT_TIMESTAMP,
       0, 0, false, 'NOT_REQUIRED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    input.id ?? randomUUID(),
    input.employeeAccountId,
    input.membershipId,
    input.businessId,
    input.branchId,
    input.status,
  );
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
