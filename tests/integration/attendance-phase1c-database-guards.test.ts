import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const rollbackMessage = "ATTENDANCE_PHASE1C_TEST_ROLLBACK";
let savepointSequence = 0;

after(async () => {
  await prisma.$disconnect();
});

test("Phase 1C database guards enforce OTP, Device, Session, and idempotency invariants", async () => {
  assertLocalDatabase();
  let rollbackBusinessId: string | null = null;

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL TIME ZONE 'Asia/Kuala_Lumpur'`,
      );
      const databaseClock = await transaction.$queryRawUnsafe<
        Array<{ timezone: string; databaseUtcNow: Date }>
      >(
        `SELECT current_setting('TIMEZONE') AS "timezone",
                (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "databaseUtcNow"`,
      );
      assert.equal(databaseClock[0]?.timezone, "Asia/Kuala_Lumpur");
      assert.ok(
        Math.abs((databaseClock[0]?.databaseUtcNow.getTime() ?? 0) - Date.now()) <
          60_000,
        "Database UTC wall clock must remain aligned with the Node UTC clock.",
      );

      const fixture = await createFixture(transaction);
      rollbackBusinessId = fixture.businessA.id;

      const firstChallengeId = randomUUID();
      const verifiedChallengeId = randomUUID();
      await insertOtpChallenge(transaction, {
        id: firstChallengeId,
        employeeAccountId: fixture.employeeAccountAId,
        phone: fixture.phoneA,
      });
      await insertOtpChallenge(transaction, {
        id: verifiedChallengeId,
        employeeAccountId: fixture.employeeAccountAId,
        phone: fixture.phoneA,
      });

      const invalidatedFirst = await transaction.$queryRawUnsafe<
        Array<{ invalidated: boolean }>
      >(
        `SELECT "invalidated_at" IS NOT NULL AS "invalidated"
           FROM "employee_otp_challenges"
          WHERE "id" = $1::uuid`,
        firstChallengeId,
      );
      assert.equal(invalidatedFirst[0]?.invalidated, true);

      await transaction.$executeRawUnsafe(
        `UPDATE "employee_otp_challenges"
            SET "verified_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        verifiedChallengeId,
      );
      await transaction.$executeRawUnsafe(
        `UPDATE "employee_otp_challenges"
            SET "invalidated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        verifiedChallengeId,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `UPDATE "employee_otp_challenges"
                SET "verified_at" = "verified_at" + interval '1 second'
              WHERE "id" = $1::uuid`,
            verifiedChallengeId,
          ),
        /already used|invalidated/i,
      );

      const unconsumedVerifiedChallengeId = randomUUID();
      await insertOtpChallenge(transaction, {
        id: unconsumedVerifiedChallengeId,
        employeeAccountId: fixture.employeeAccountAId,
        phone: fixture.phoneA,
      });
      await transaction.$executeRawUnsafe(
        `UPDATE "employee_otp_challenges"
            SET "verified_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        unconsumedVerifiedChallengeId,
      );
      await insertOtpChallenge(transaction, {
        id: randomUUID(),
        employeeAccountId: fixture.employeeAccountAId,
        phone: fixture.phoneA,
        purpose: "REGISTER_DEVICE",
      });
      const invalidatedVerified = await transaction.$queryRawUnsafe<
        Array<{ invalidated: boolean }>
      >(
        `SELECT "invalidated_at" IS NOT NULL AS "invalidated"
           FROM "employee_otp_challenges"
          WHERE "id" = $1::uuid`,
        unconsumedVerifiedChallengeId,
      );
      assert.equal(invalidatedVerified[0]?.invalidated, true);

      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `UPDATE "employee_accounts"
                SET "phone_number" = $1,
                    "phone_normalized" = $1
              WHERE "id" = $2::uuid`,
            "+60199999999",
            fixture.employeeAccountAId,
          ),
        /phone cannot change after authentication data exists/i,
      );

      const deviceAId = randomUUID();
      await insertDevice(transaction, {
        id: deviceAId,
        employeeAccountId: fixture.employeeAccountAId,
      });
      await expectDatabaseFailure(
        transaction,
        () =>
          insertDevice(transaction, {
            id: randomUUID(),
            employeeAccountId: fixture.employeeAccountAId,
          }),
        /23505|one_active_punch_device/i,
      );

      const deviceBId = randomUUID();
      await insertDevice(transaction, {
        id: deviceBId,
        employeeAccountId: fixture.employeeAccountBId,
      });
      const employeeSessionId = randomUUID();
      await insertEmployeeSession(transaction, {
        id: employeeSessionId,
        employeeAccountId: fixture.employeeAccountAId,
        membershipId: fixture.membershipAId,
        businessId: fixture.businessA.id,
        primaryBranchId: fixture.branchA.id,
        employeeDeviceId: deviceAId,
      });
      await expectDatabaseFailure(
        transaction,
        () =>
          insertEmployeeSession(transaction, {
            id: randomUUID(),
            employeeAccountId: fixture.employeeAccountAId,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessA.id,
            primaryBranchId: fixture.branchA.id,
            employeeDeviceId: deviceBId,
          }),
        /device scope mismatch/i,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          insertEmployeeSession(transaction, {
            id: randomUUID(),
            employeeAccountId: fixture.employeeAccountAId,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessB.id,
            primaryBranchId: fixture.branchB.id,
            employeeDeviceId: deviceAId,
          }),
        /membership scope mismatch/i,
      );

      await transaction.$executeRawUnsafe(
        `UPDATE "employee_devices"
            SET "status" = 'REPLACED',
                "can_view" = false,
                "can_punch" = false,
                "revoked_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
                "revoke_reason" = 'NEW_DEVICE',
                "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        deviceAId,
      );
      assert.equal(
        await employeeSessionIsRevoked(transaction, employeeSessionId),
        true,
      );
      await transaction.$executeRawUnsafe(
        `UPDATE "employee_devices"
            SET "status" = 'ACTIVE',
                "can_view" = true,
                "can_punch" = true,
                "revoked_at" = NULL,
                "revoke_reason" = NULL,
                "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        deviceAId,
      );

      const activeEmployeeSessionId = randomUUID();
      await insertEmployeeSession(transaction, {
        id: activeEmployeeSessionId,
        employeeAccountId: fixture.employeeAccountAId,
        membershipId: fixture.membershipAId,
        businessId: fixture.businessA.id,
        primaryBranchId: fixture.branchA.id,
        employeeDeviceId: deviceAId,
      });

      const attendanceSessionId = randomUUID();
      await insertAttendanceSession(transaction, {
        id: attendanceSessionId,
        employeeAccountId: fixture.employeeAccountAId,
        membershipId: fixture.membershipAId,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
        status: "OPEN",
      });
      await expectDatabaseFailure(
        transaction,
        () =>
          insertAttendanceSession(transaction, {
            id: randomUUID(),
            employeeAccountId: fixture.employeeAccountAId,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessA.id,
            branchId: fixture.branchA.id,
            status: "ON_BREAK",
          }),
        /23505|one_live_session/i,
      );

      const punchId = randomUUID();
      await insertPunch(transaction, {
        id: punchId,
        attendanceSessionId,
        membershipId: fixture.membershipAId,
        businessId: fixture.businessA.id,
        branchId: fixture.branchA.id,
      });
      await transaction.$executeRawUnsafe(
        `UPDATE "employee_attendance"
            SET "clock_in_punch_id" = $1::uuid
          WHERE "id" = $2::uuid`,
        punchId,
        attendanceSessionId,
      );
      await expectDatabaseFailure(
        transaction,
        async () => {
          await insertPunch(transaction, {
            id: randomUUID(),
            attendanceSessionId: null,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessA.id,
            branchId: fixture.branchA.id,
          });
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS "attendance_terminal_punch_link_guard" IMMEDIATE`,
          );
        },
        /Terminal Attendance Punch requires an Attendance Session/i,
      );
      await expectDatabaseFailure(
        transaction,
        async () => {
          await insertPunch(transaction, {
            id: randomUUID(),
            attendanceSessionId,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessA.id,
            branchId: fixture.branchA.id,
            type: "CLOCK_OUT",
          });
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS "attendance_terminal_punch_link_guard" IMMEDIATE`,
          );
        },
        /Terminal Attendance Punch is not linked by its Attendance Session/i,
      );
      await expectDatabaseFailure(
        transaction,
        async () => {
          await transaction.$executeRawUnsafe(
            `UPDATE "employee_attendance"
                SET "clock_in_punch_id" = NULL
              WHERE "id" = $1::uuid`,
            attendanceSessionId,
          );
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS "attendance_session_terminal_link_guard" IMMEDIATE`,
          );
        },
        /must retain its linked clock-in Punch/i,
      );
      await expectDatabaseFailure(
        transaction,
        async () => {
          const replacementPunchId = randomUUID();
          await insertPunch(transaction, {
            id: replacementPunchId,
            attendanceSessionId,
            membershipId: fixture.membershipAId,
            businessId: fixture.businessA.id,
            branchId: fixture.branchA.id,
          });
          await transaction.$executeRawUnsafe(
            `UPDATE "employee_attendance"
                SET "clock_in_punch_id" = $1::uuid
              WHERE "id" = $2::uuid`,
            replacementPunchId,
            attendanceSessionId,
          );
          await transaction.$executeRawUnsafe(
            `SET CONSTRAINTS "attendance_session_terminal_link_guard" IMMEDIATE`,
          );
        },
        /must retain its linked clock-in Punch/i,
      );


      const idempotencyId = randomUUID();
      const idempotencyKey = `clock-in-${randomUUID()}`;
      await transaction.$executeRawUnsafe(
        `INSERT INTO "attendance_request_idempotency" (
           "id", "membership_id", "employee_session_id", "business_id",
           "branch_id", "idempotency_key", "request_payload_hash",
           "punch_type", "status", "created_at"
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::uuid,
           $5::uuid, $6, $7, 'CLOCK_IN', 'PROCESSING', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         )`,
        idempotencyId,
        fixture.membershipAId,
        activeEmployeeSessionId,
        fixture.businessA.id,
        fixture.branchA.id,
        idempotencyKey,
        hash(`payload-${idempotencyKey}`),
      );
      await transaction.$executeRawUnsafe(
        `UPDATE "attendance_request_idempotency"
            SET "status" = 'COMPLETED',
                "attendance_session_id" = $1::uuid,
                "attendance_punch_id" = $2::uuid,
                "completed_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $3::uuid`,
        attendanceSessionId,
        punchId,
        idempotencyId,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `INSERT INTO "attendance_request_idempotency" (
               "id", "membership_id", "employee_session_id", "business_id",
               "branch_id", "idempotency_key", "request_payload_hash",
               "punch_type", "status", "created_at"
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4::uuid,
               $5::uuid, $6, $7, 'CLOCK_IN', 'PROCESSING', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
             )`,
            randomUUID(),
            fixture.membershipAId,
            activeEmployeeSessionId,
            fixture.businessA.id,
            fixture.branchA.id,
            idempotencyKey,
            hash(`payload-${idempotencyKey}`),
          ),
        /23505|attendance_idempotency_membership_key/i,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `UPDATE "attendance_request_idempotency"
                SET "request_payload_hash" = $1
              WHERE "id" = $2::uuid`,
            hash("different-payload"),
            idempotencyId,
          ),
        /request identity is immutable/i,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `UPDATE "attendance_punches"
                SET "ip_address" = '127.0.0.1'
              WHERE "id" = $1::uuid`,
            punchId,
          ),
        /Attendance punches are immutable/i,
      );

      await transaction.$executeRawUnsafe(
        `UPDATE "employee_devices"
            SET "status" = 'REVOKED',
                "can_view" = false,
                "can_punch" = false,
                "revoked_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
                "revoke_reason" = 'ADMIN_REVOKED',
                "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          WHERE "id" = $1::uuid`,
        deviceAId,
      );
      assert.equal(
        await employeeSessionIsRevoked(transaction, activeEmployeeSessionId),
        true,
      );
      await expectDatabaseFailure(
        transaction,
        () =>
          transaction.$executeRawUnsafe(
            `UPDATE "employee_devices"
                SET "status" = 'ACTIVE',
                    "can_view" = true,
                    "can_punch" = true,
                    "revoked_at" = NULL,
                    "revoke_reason" = NULL,
                    "updated_at" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
              WHERE "id" = $1::uuid`,
            deviceAId,
          ),
        /Revoked Employee device cannot be reactivated/i,
      );

      throw new Error(rollbackMessage);
    }),
    (error: unknown) =>
      error instanceof Error && error.message === rollbackMessage,
  );

  assert.ok(rollbackBusinessId);
  assert.equal(
    await prisma.business.count({ where: { id: rollbackBusinessId } }),
    0,
  );
});

async function createFixture(transaction: Prisma.TransactionClient) {
  const token = randomUUID();
  const phoneA = `+601${randomInt(10_000_000, 99_999_999)}`;
  const phoneB = `+601${randomInt(10_000_000, 99_999_999)}`;
  const businessA = await transaction.business.create({
    data: {
      name: `Phase 1C Guard A ${token}`,
      slug: `phase1c-guard-a-${token}`,
    },
  });
  const businessB = await transaction.business.create({
    data: {
      name: `Phase 1C Guard B ${token}`,
      slug: `phase1c-guard-b-${token}`,
    },
  });
  const branchA = await transaction.branch.create({
    data: {
      businessId: businessA.id,
      name: `Phase 1C Branch A ${token}`,
    },
  });
  const branchB = await transaction.branch.create({
    data: {
      businessId: businessB.id,
      name: `Phase 1C Branch B ${token}`,
    },
  });
  const employeeAccountAId = randomUUID();
  const employeeAccountBId = randomUUID();
  const membershipAId = randomUUID();

  await transaction.$executeRawUnsafe(
    `INSERT INTO "employee_accounts" (
       "id", "phone_number", "phone_normalized", "name", "status",
       "created_at", "updated_at"
     ) VALUES
       ($1::uuid, $2, $2, 'Phase 1C Employee A', 'ACTIVE',
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')),
       ($3::uuid, $4, $4, 'Phase 1C Employee B', 'ACTIVE',
        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`,
    employeeAccountAId,
    phoneA,
    employeeAccountBId,
    phoneB,
  );
  await transaction.$executeRawUnsafe(
    `INSERT INTO "employee_business_memberships" (
       "id", "employee_account_id", "business_id", "employee_code",
       "full_name", "phone_number", "phone_number_normalized",
       "employment_type", "status", "attendance_enabled", "joined_at",
       "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4, 'Phase 1C Employee A', $5, $5,
       'FULL_TIME', 'ACTIVE', true, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    membershipAId,
    employeeAccountAId,
    businessA.id,
    `P1C-${token}`,
    phoneA,
  );
  await transaction.$executeRawUnsafe(
    `INSERT INTO "employee_branch_assignments" (
       "id", "membership_id", "business_id", "branch_id", "is_primary",
       "can_clock_in", "effective_from", "status", "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, true,
       true, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - interval '1 second', 'ACTIVE',
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    randomUUID(),
    membershipAId,
    businessA.id,
    branchA.id,
  );

  return {
    businessA,
    businessB,
    branchA,
    branchB,
    employeeAccountAId,
    employeeAccountBId,
    membershipAId,
    phoneA,
  };
}

async function insertOtpChallenge(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
    employeeAccountId: string;
    phone: string;
    purpose?: "LOGIN" | "REGISTER_DEVICE";
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "employee_otp_challenges" (
       "id", "employee_account_id", "phone_number_normalized", "purpose",
       "otp_hash", "expires_at", "attempts", "max_attempts",
       "resend_available_at", "created_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3, $4::"EmployeeOtpPurpose",
       $5, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '5 minutes', 0, 5,
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '60 seconds', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.employeeAccountId,
    input.phone,
    input.purpose ?? "LOGIN",
    hash(`otp-${input.id}`),
  );
}

async function insertDevice(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
    employeeAccountId: string;
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "employee_devices" (
       "id", "employee_account_id", "device_identifier_hash",
       "first_verified_at", "last_active_at", "status",
       "can_view", "can_punch", "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3,
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), 'ACTIVE',
       true, true, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.employeeAccountId,
    hash(`device-${input.id}`),
  );
}

async function insertEmployeeSession(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
    employeeAccountId: string;
    membershipId: string;
    businessId: string;
    primaryBranchId: string;
    employeeDeviceId: string;
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "employee_sessions" (
       "id", "employee_account_id", "membership_id", "business_id",
       "primary_branch_id", "employee_device_id", "refresh_token_hash",
       "expires_at", "last_active_at", "created_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, $6::uuid, $7,
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + interval '30 minutes',
       (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.employeeAccountId,
    input.membershipId,
    input.businessId,
    input.primaryBranchId,
    input.employeeDeviceId,
    hash(`refresh-${input.id}`),
  );
}

async function insertAttendanceSession(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
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
       $5::uuid, CURRENT_DATE, $6::"EmployeeAttendanceStatus", (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
       0, 0, false, 'NOT_REQUIRED', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'), (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.employeeAccountId,
    input.membershipId,
    input.businessId,
    input.branchId,
    input.status,
  );
}

async function insertPunch(
  transaction: Prisma.TransactionClient,
  input: {
    id: string;
    attendanceSessionId: string | null;
    membershipId: string;
    businessId: string;
    branchId: string;
    type?: "CLOCK_IN" | "CLOCK_OUT";
  },
) {
  return transaction.$executeRawUnsafe(
    `INSERT INTO "attendance_punches" (
       "id", "business_id", "branch_id", "employee_id",
       "attendance_session_id", "type", "server_timestamp",
       "inside_geofence", "geofence_status", "source", "created_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       $5::uuid, $6::"AttendancePunchType", (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
       true, 'INSIDE', 'SYSTEM', (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
     )`,
    input.id,
    input.businessId,
    input.branchId,
    input.membershipId,
    input.attendanceSessionId,
    input.type ?? "CLOCK_IN",
  );
}

async function employeeSessionIsRevoked(
  transaction: Prisma.TransactionClient,
  id: string,
) {
  const rows = await transaction.$queryRawUnsafe<Array<{ revoked: boolean }>>(
    `SELECT "revoked_at" IS NOT NULL AS "revoked"
       FROM "employee_sessions"
      WHERE "id" = $1::uuid`,
    id,
  );
  return rows[0]?.revoked ?? false;
}

async function expectDatabaseFailure(
  transaction: Prisma.TransactionClient,
  operation: () => Promise<unknown>,
  expected: RegExp,
) {
  const savepoint = `attendance_phase1c_guard_${++savepointSequence}`;
  await transaction.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);

  try {
    await assert.rejects(operation(), expected);
  } finally {
    await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
    await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
  }
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
