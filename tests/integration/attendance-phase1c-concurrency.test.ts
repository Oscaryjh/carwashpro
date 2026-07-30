import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test, { after, before } from "node:test";
import { PrismaClient } from "@prisma/client";
import { AttendanceApiError } from "../../src/lib/attendance/api-error";
import { hashEmployeeIdentifier } from "../../src/lib/attendance/employee-auth/crypto";
import type { EmployeeAuthContext } from "../../src/lib/attendance/employee-auth/session";
import { submitAttendanceException } from "../../src/lib/attendance/exception-service";
import { performAttendancePunch } from "../../src/lib/attendance/punch-service";

process.env.EMPLOYEE_AUTH_SECRET =
  process.env.EMPLOYEE_AUTH_SECRET ??
  "attendance-phase1c-concurrency-secret-32-bytes";

const rootDatabaseUrl = process.env.DATABASE_URL ?? "";
const schemaName = `attendance_phase1c_${randomUUID().replaceAll("-", "")}`;
let isolatedDatabaseUrl = "";
let database: PrismaClient;
let administrationDatabase: PrismaClient;

before(() => {
  const rootHostname = new URL(rootDatabaseUrl).hostname.toLowerCase();
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]", "::1"].includes(rootHostname),
    "Attendance concurrency tests must use local PostgreSQL.",
  );
  const parsedUrl = new URL(rootDatabaseUrl);
  parsedUrl.searchParams.set("schema", schemaName);
  isolatedDatabaseUrl = parsedUrl.toString();

  const projectRoot = fileURLToPath(
    new URL("../..", import.meta.url),
  );
  const prismaCli = path.join(
    projectRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const migration = spawnSync(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: isolatedDatabaseUrl,
      },
      encoding: "utf8",
    },
  );
  if (migration.status !== 0) {
    throw new Error(
      `Unable to prepare isolated Attendance schema.\n${migration.stdout}\n${migration.stderr}`,
    );
  }

  database = new PrismaClient({
    datasources: {
      db: {
        url: isolatedDatabaseUrl,
      },
    },
  });
  administrationDatabase = new PrismaClient();
});

after(async () => {
  await database?.$disconnect();
  if (administrationDatabase) {
    await administrationDatabase.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
    await administrationDatabase.$disconnect();
  }
});

test("database concurrency permits only one Clock In/Out and replays one same-key request", async () => {
  const first = await createFixture(database, "different-key");
  const now = new Date();
  now.setMilliseconds(0);
  const clockInAttempts = await Promise.allSettled([
    performAttendancePunch({
      database,
      auth: first.auth,
      type: "CLOCK_IN",
      input: punchInput(
        first.branchId,
        first.deviceIdentifier,
        "concurrent:clock-in:a",
      ),
      now,
    }),
    performAttendancePunch({
      database,
      auth: first.auth,
      type: "CLOCK_IN",
      input: punchInput(
        first.branchId,
        first.deviceIdentifier,
        "concurrent:clock-in:b",
      ),
      now,
    }),
  ]);
  assertSettledCounts(clockInAttempts, 1, 1);
  assertRejectedAttendanceState(clockInAttempts);
  assert.equal(
    await database.attendancePunch.count({
      where: {
        employeeId: first.auth.membershipId,
        type: "CLOCK_IN",
      },
    }),
    1,
  );
  assert.equal(
    await database.employeeAttendance.count({
      where: {
        membershipId: first.auth.membershipId,
        status: {
          in: ["OPEN", "ON_BREAK"],
        },
      },
    }),
    1,
  );

  const clockOutAttempts = await Promise.allSettled([
    performAttendancePunch({
      database,
      auth: first.auth,
      type: "CLOCK_OUT",
      input: punchInput(
        first.branchId,
        first.deviceIdentifier,
        "concurrent:clock-out:a",
      ),
      now: new Date(now.getTime() + 60 * 60_000),
    }),
    performAttendancePunch({
      database,
      auth: first.auth,
      type: "CLOCK_OUT",
      input: punchInput(
        first.branchId,
        first.deviceIdentifier,
        "concurrent:clock-out:b",
      ),
      now: new Date(now.getTime() + 60 * 60_000),
    }),
  ]);
  assertSettledCounts(clockOutAttempts, 1, 1);
  assertRejectedAttendanceState(clockOutAttempts);
  assert.equal(
    await database.attendancePunch.count({
      where: {
        employeeId: first.auth.membershipId,
        type: "CLOCK_OUT",
      },
    }),
    1,
  );

  const second = await createFixture(database, "same-key");
  const sameInput = punchInput(
    second.branchId,
    second.deviceIdentifier,
    "concurrent:same-key",
  );
  const sameKeyAttempts = await Promise.all([
    performAttendancePunch({
      database,
      auth: second.auth,
      type: "CLOCK_IN",
      input: sameInput,
      now,
    }),
    performAttendancePunch({
      database,
      auth: second.auth,
      type: "CLOCK_IN",
      input: sameInput,
      now,
    }),
  ]);
  assert.equal(
    sameKeyAttempts[0].attendancePunchId,
    sameKeyAttempts[1].attendancePunchId,
  );
  assert.equal(
    sameKeyAttempts.filter((result) => result.replayed).length,
    1,
  );
  assert.equal(
    await database.attendancePunch.count({
      where: {
        employeeId: second.auth.membershipId,
        type: "CLOCK_IN",
      },
    }),
    1,
  );

  const exceptionInput = {
    branchId: second.branchId,
    attendanceSessionId: sameKeyAttempts[0].attendanceSessionId,
    type: "OTHER" as const,
    reason: "Concurrent duplicate exception request.",
    deviceIdentifier: second.deviceIdentifier,
  };
  const exceptionAttempts = await Promise.all([
    submitAttendanceException({
      database,
      auth: second.auth,
      input: exceptionInput,
      now,
    }),
    submitAttendanceException({
      database,
      auth: second.auth,
      input: exceptionInput,
      now,
    }),
  ]);
  assert.equal(exceptionAttempts[0].id, exceptionAttempts[1].id);
  assert.equal(
    exceptionAttempts.filter((result) => result.duplicate).length,
    1,
  );
  assert.equal(
    await database.attendanceException.count({
      where: {
        employeeId: second.auth.membershipId,
        attendanceSessionId:
          sameKeyAttempts[0].attendanceSessionId,
        type: "OTHER",
        status: "PENDING",
      },
    }),
    1,
  );

  const rateLimited = await createFixture(database, "rate-limit");
  const rateConfig = {
    windowMilliseconds: 60_000,
    punchRequests: 1,
    exceptionRequests: 1,
  };
  const firstRatePunch = punchInput(
    rateLimited.branchId,
    rateLimited.deviceIdentifier,
    "rate-limit:clock-in",
  );
  const firstRateResult = await performAttendancePunch({
    database,
    auth: rateLimited.auth,
    type: "CLOCK_IN",
    input: firstRatePunch,
    now,
    rateLimitConfig: rateConfig,
  });
  const replayAfterLimit = await performAttendancePunch({
    database,
    auth: rateLimited.auth,
    type: "CLOCK_IN",
    input: firstRatePunch,
    now,
    rateLimitConfig: rateConfig,
  });
  assert.equal(replayAfterLimit.attendancePunchId, firstRateResult.attendancePunchId);
  assert.equal(replayAfterLimit.replayed, true);
  await assert.rejects(
    performAttendancePunch({
      database,
      auth: rateLimited.auth,
      type: "BREAK_START",
      input: punchInput(
        rateLimited.branchId,
        rateLimited.deviceIdentifier,
        "rate-limit:break-start",
      ),
      now: new Date(now.getTime() + 1_000),
      rateLimitConfig: rateConfig,
    }),
    (error: unknown) =>
      error instanceof AttendanceApiError &&
      error.code === "RATE_LIMITED",
  );

  const exceptionInputForRateLimit = {
    branchId: rateLimited.branchId,
    attendanceSessionId: firstRateResult.attendanceSessionId,
    type: "OTHER" as const,
    reason: "Rate-limit the duplicate exception request.",
    deviceIdentifier: rateLimited.deviceIdentifier,
  };
  await submitAttendanceException({
    database,
    auth: rateLimited.auth,
    input: exceptionInputForRateLimit,
    now,
    rateLimitConfig: rateConfig,
  });
  await assert.rejects(
    submitAttendanceException({
      database,
      auth: rateLimited.auth,
      input: exceptionInputForRateLimit,
      now: new Date(now.getTime() + 1_000),
      rateLimitConfig: rateConfig,
    }),
    (error: unknown) =>
      error instanceof AttendanceApiError &&
      error.code === "RATE_LIMITED",
  );
  assert.equal(
    await database.auditLog.count({
      where: {
        businessId: rateLimited.auth.businessId,
        entityType: "EmployeeBusinessMembership",
        entityId: rateLimited.auth.membershipId,
        action: "ATTENDANCE_EXCEPTION_REQUESTED",
      },
    }),
    1,
  );
});

async function createFixture(
  client: PrismaClient,
  label: string,
) {
  const suffix = randomUUID().slice(0, 8);
  return client.$transaction(async (transaction) => {
    const business = await transaction.business.create({
      data: {
        name: `Concurrency ${label} ${suffix}`,
        slug: `concurrency-${label}-${suffix}`,
      },
    });
    const branch = await transaction.branch.create({
      data: {
        businessId: business.id,
        name: `Concurrency Branch ${suffix}`,
      },
    });
    await transaction.branchAttendanceSetting.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        latitude: 1.5535,
        longitude: 110.3593,
        timezone: "Asia/Kuching",
        isEnabled: true,
      },
    });
    const phone = `+603${Date.now().toString().slice(-8)}${label.length}`;
    const account = await transaction.employeeAccount.create({
      data: {
        phoneNumber: phone,
        phoneNormalized: phone,
        name: `Concurrency Employee ${suffix}`,
        status: "ACTIVE",
      },
    });
    const membership =
      await transaction.employeeBusinessMembership.create({
        data: {
          employeeAccountId: account.id,
          businessId: business.id,
          employeeCode: `CON-${suffix}`,
          fullName: `Concurrency Employee ${suffix}`,
          phoneNumber: phone,
          phoneNumberNormalized: phone,
          status: "ACTIVE",
          attendanceEnabled: true,
        },
      });
    await transaction.employeeBranchAssignment.create({
      data: {
        membershipId: membership.id,
        businessId: business.id,
        branchId: branch.id,
        isPrimary: true,
        canClockIn: true,
        effectiveFrom: new Date(Date.now() - 86_400_000),
        status: "ACTIVE",
      },
    });
    const deviceIdentifier = `concurrency-device-${randomUUID()}`;
    const device = await transaction.employeeDevice.create({
      data: {
        employeeAccountId: account.id,
        deviceIdentifierHash: hashEmployeeIdentifier(
          "device",
          deviceIdentifier,
        ),
        status: "ACTIVE",
        canView: true,
        canPunch: true,
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
        expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
      },
    });

    return {
      branchId: branch.id,
      deviceIdentifier,
      auth: {
        sessionId: employeeSession.id,
        employeeAccountId: account.id,
        membershipId: membership.id,
        businessId: business.id,
        primaryBranchId: branch.id,
        deviceId: device.id,
      } satisfies EmployeeAuthContext,
    };
  });
}

function punchInput(
  branchId: string,
  deviceIdentifier: string,
  idempotencyKey: string,
) {
  return {
    branchId,
    latitude: 1.5535,
    longitude: 110.3593,
    accuracyMeters: 10,
    deviceIdentifier,
    idempotencyKey,
  };
}

function assertSettledCounts(
  results: PromiseSettledResult<unknown>[],
  fulfilled: number,
  rejected: number,
) {
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    fulfilled,
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    rejected,
  );
}

function assertRejectedAttendanceState(
  results: PromiseSettledResult<unknown>[],
) {
  const rejected = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === "rejected",
  );
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof AttendanceApiError);
  assert.equal(rejected.reason.code, "INVALID_ATTENDANCE_STATE");
}
