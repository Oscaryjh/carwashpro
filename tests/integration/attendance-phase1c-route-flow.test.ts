import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test, { after, before } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  hashEmployeeIdentifier,
  hashEmployeeSessionToken,
} from "../../src/lib/attendance/employee-auth/crypto";

const rootDatabaseUrl = process.env.DATABASE_URL ?? "";
const schemaName = `attendance_phase1c_api_${randomUUID().replaceAll("-", "")}`;
const employeeSecret =
  "attendance-phase1c-route-flow-secret-at-least-32-bytes";
let isolatedDatabaseUrl = "";
let database: PrismaClient;
let administrationDatabase: PrismaClient;
let appDatabase: PrismaClient | null = null;

before(() => {
  const parsedRoot = new URL(rootDatabaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsedRoot.hostname),
    "Attendance route integration tests require local PostgreSQL.",
  );
  const isolatedUrl = new URL(rootDatabaseUrl);
  isolatedUrl.searchParams.set("schema", schemaName);
  isolatedDatabaseUrl = isolatedUrl.toString();

  const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
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
      `Unable to prepare isolated Attendance API schema.\n${migration.stdout}\n${migration.stderr}`,
    );
  }

  process.env.DATABASE_URL = isolatedDatabaseUrl;
  process.env.EMPLOYEE_AUTH_SECRET = employeeSecret;
  database = new PrismaClient({
    datasources: { db: { url: isolatedDatabaseUrl } },
  });
  administrationDatabase = new PrismaClient({
    datasources: { db: { url: rootDatabaseUrl } },
  });
});

after(async () => {
  await appDatabase?.$disconnect();
  await database?.$disconnect();
  if (administrationDatabase) {
    await administrationDatabase.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`,
    );
    await administrationDatabase.$disconnect();
  }
  process.env.DATABASE_URL = rootDatabaseUrl;
});

test("Employee cookie drives the complete Attendance route flow with tenant isolation and 429 limits", async () => {
  const fixture = await createFixture();
  const [
    { POST: clockIn },
    { POST: breakStart },
    { POST: breakEnd },
    { POST: clockOut },
    { POST: submitException },
    { GET: today },
    { GET: history },
    prismaModule,
  ] = await Promise.all([
    import("../../src/app/api/employee-attendance/clock-in/route"),
    import("../../src/app/api/employee-attendance/break-start/route"),
    import("../../src/app/api/employee-attendance/break-end/route"),
    import("../../src/app/api/employee-attendance/clock-out/route"),
    import("../../src/app/api/employee-attendance/exception/route"),
    import("../../src/app/api/employee-attendance/today/route"),
    import("../../src/app/api/employee-attendance/history/route"),
    import("../../src/lib/prisma"),
  ]);
  appDatabase = prismaModule.prisma;
  const cookie = `tetamu_employee_session=${fixture.sessionToken}`;

  const unauthorizedBranchResponse = await clockIn(
    punchRequest(
      "/api/employee-attendance/clock-in",
      cookie,
      punchBody(
        fixture.unauthorizedBranchId,
        fixture.deviceIdentifier,
        "api-flow:unauthorized-branch",
      ),
    ),
  );
  assert.equal(unauthorizedBranchResponse.status, 403);
  assert.equal(
    (await unauthorizedBranchResponse.json()).error.code,
    "BRANCH_NOT_AUTHORIZED",
  );

  const crossBusinessResponse = await clockIn(
    punchRequest(
      "/api/employee-attendance/clock-in",
      cookie,
      punchBody(
        fixture.otherBusinessBranchId,
        fixture.deviceIdentifier,
        "api-flow:cross-business",
      ),
    ),
  );
  assert.equal(crossBusinessResponse.status, 403);
  assert.equal(
    (await crossBusinessResponse.json()).error.code,
    "BRANCH_NOT_AUTHORIZED",
  );

  const clockInBody = punchBody(
    fixture.branchId,
    fixture.deviceIdentifier,
    "api-flow:clock-in",
  );
  const clockInResponse = await clockIn(
    punchRequest(
      "/api/employee-attendance/clock-in",
      cookie,
      clockInBody,
    ),
  );
  assert.equal(clockInResponse.status, 200);
  const clockInResult = (await clockInResponse.json()).data;
  assert.equal(clockInResult.punchType, "CLOCK_IN");
  assert.equal(clockInResult.resultingStatus, "OPEN");

  const todayResponse = await today(
    new Request("http://localhost/api/employee-attendance/today", {
      headers: { cookie },
    }),
  );
  assert.equal(todayResponse.status, 200);
  const todayResult = (await todayResponse.json()).data;
  assert.equal(todayResult.status, "OPEN");
  assert.deepEqual(todayResult.allowedActions, [
    "BREAK_START",
    "CLOCK_OUT",
  ]);
  assert.equal(
    JSON.stringify(todayResult).includes(fixture.employeeAccountId),
    false,
  );
  assert.equal(
    JSON.stringify(todayResult).includes(fixture.membershipId),
    false,
  );

  const breakStartResponse = await breakStart(
    punchRequest(
      "/api/employee-attendance/break-start",
      cookie,
      punchBody(
        fixture.branchId,
        fixture.deviceIdentifier,
        "api-flow:break-start",
      ),
    ),
  );
  assert.equal(breakStartResponse.status, 200);
  assert.equal(
    (await breakStartResponse.json()).data.resultingStatus,
    "ON_BREAK",
  );

  const breakEndResponse = await breakEnd(
    punchRequest(
      "/api/employee-attendance/break-end",
      cookie,
      punchBody(
        fixture.branchId,
        fixture.deviceIdentifier,
        "api-flow:break-end",
      ),
    ),
  );
  assert.equal(breakEndResponse.status, 200);
  assert.equal(
    (await breakEndResponse.json()).data.resultingStatus,
    "OPEN",
  );

  const clockOutBody = punchBody(
    fixture.branchId,
    fixture.deviceIdentifier,
    "api-flow:clock-out",
  );
  const clockOutResponse = await clockOut(
    punchRequest(
      "/api/employee-attendance/clock-out",
      cookie,
      clockOutBody,
    ),
  );
  assert.equal(clockOutResponse.status, 200);
  const clockOutResult = (await clockOutResponse.json()).data;
  assert.equal(clockOutResult.resultingStatus, "COMPLETED");
  assert.equal(typeof clockOutResult.totalWorkedMinutes, "number");

  const historyResponse = await history(
    new Request(
      "http://localhost/api/employee-attendance/history?page=1&pageSize=10",
      { headers: { cookie } },
    ),
  );
  assert.equal(historyResponse.status, 200);
  const historyResult = (await historyResponse.json()).data;
  assert.equal(historyResult.items.length, 1);
  assert.equal(
    historyResult.items[0].id,
    `${clockOutResult.workDate}-${fixture.branchId}`,
  );
  assert.equal(historyResult.items[0].sessions.length, 1);
  assert.equal(
    historyResult.items[0].sessions[0].id,
    clockInResult.attendanceSessionId,
  );
  assert.equal(historyResult.items[0].status, "COMPLETED");
  assert.equal(historyResult.pagination.total, 1);

  const previousPunchLimit =
    process.env.ATTENDANCE_PUNCH_REQUESTS_PER_WINDOW;
  const previousExceptionLimit =
    process.env.ATTENDANCE_EXCEPTION_REQUESTS_PER_WINDOW;
  process.env.ATTENDANCE_PUNCH_REQUESTS_PER_WINDOW = "1";
  process.env.ATTENDANCE_EXCEPTION_REQUESTS_PER_WINDOW = "1";

  try {
    const replayResponse = await clockOut(
      punchRequest(
        "/api/employee-attendance/clock-out",
        cookie,
        clockOutBody,
      ),
    );
    assert.equal(replayResponse.status, 200);
    assert.equal((await replayResponse.json()).data.replayed, true);

    const rateLimitedPunch = await clockIn(
      punchRequest(
        "/api/employee-attendance/clock-in",
        cookie,
        punchBody(
          fixture.branchId,
          fixture.deviceIdentifier,
          "api-flow:rate-limited",
        ),
      ),
    );
    assert.equal(rateLimitedPunch.status, 429);
    assert.equal(
      (await rateLimitedPunch.json()).error.code,
      "RATE_LIMITED",
    );

    const exceptionBody = {
      branchId: fixture.branchId,
      attendanceSessionId: clockInResult.attendanceSessionId,
      type: "OTHER",
      reason: "Route-level rate limit verification.",
      deviceIdentifier: fixture.deviceIdentifier,
    };
    const firstException = await submitException(
      punchRequest(
        "/api/employee-attendance/exception",
        cookie,
        exceptionBody,
      ),
    );
    assert.equal(firstException.status, 200);
    assert.equal((await firstException.json()).data.status, "PENDING");

    const rateLimitedException = await submitException(
      punchRequest(
        "/api/employee-attendance/exception",
        cookie,
        exceptionBody,
      ),
    );
    assert.equal(rateLimitedException.status, 429);
    assert.equal(
      (await rateLimitedException.json()).error.code,
      "RATE_LIMITED",
    );
  } finally {
    restoreEnvironment(
      "ATTENDANCE_PUNCH_REQUESTS_PER_WINDOW",
      previousPunchLimit,
    );
    restoreEnvironment(
      "ATTENDANCE_EXCEPTION_REQUESTS_PER_WINDOW",
      previousExceptionLimit,
    );
  }
});

async function createFixture() {
  const token = randomUUID();
  const now = new Date();
  now.setMilliseconds(0);
  const sessionToken = `route-flow-token-${randomUUID()}`;
  const deviceIdentifier = `route-flow-device-${randomUUID()}`;
  const business = await database.business.create({
    data: {
      name: `Route Flow Business ${token}`,
      slug: `route-flow-${token}`,
    },
  });
  const otherBusiness = await database.business.create({
    data: {
      name: `Route Flow Other ${token}`,
      slug: `route-flow-other-${token}`,
    },
  });
  await database.businessModuleEntitlement.create({
    data: {
      businessId: business.id,
      moduleKey: "HR",
      status: "ENABLED",
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      source: "SYSTEM",
    },
  });
  const branch = await database.branch.create({
    data: { businessId: business.id, name: "Assigned Branch" },
  });
  const unauthorizedBranch = await database.branch.create({
    data: { businessId: business.id, name: "Unauthorized Branch" },
  });
  const otherBusinessBranch = await database.branch.create({
    data: {
      businessId: otherBusiness.id,
      name: "Other Business Branch",
    },
  });
  await database.branchAttendanceSetting.createMany({
    data: [
      attendanceSetting(business.id, branch.id),
      attendanceSetting(business.id, unauthorizedBranch.id),
      attendanceSetting(otherBusiness.id, otherBusinessBranch.id),
    ],
  });
  const phone = `+601${Date.now().toString().slice(-8)}`;
  const account = await database.employeeAccount.create({
    data: {
      phoneNumber: phone,
      phoneNormalized: phone,
      name: "Route Flow Employee",
      status: "ACTIVE",
    },
  });
  const membership = await database.employeeBusinessMembership.create({
    data: {
      employeeAccountId: account.id,
      businessId: business.id,
      employeeCode: `RF-${token.slice(0, 8)}`,
      fullName: "Route Flow Employee",
      phoneNumber: phone,
      phoneNumberNormalized: phone,
      status: "ACTIVE",
      attendanceEnabled: false,
    },
  });
  await database.employeeBranchAssignment.create({
    data: {
      membershipId: membership.id,
      businessId: business.id,
      branchId: branch.id,
      isPrimary: true,
      canClockIn: true,
      effectiveFrom: new Date(now.getTime() - 86_400_000),
      status: "ACTIVE",
    },
  });
  await database.employeeBusinessMembership.update({
    where: { id: membership.id },
    data: { attendanceEnabled: true },
  });
  const device = await database.employeeDevice.create({
    data: {
      employeeAccountId: account.id,
      deviceIdentifierHash: hashEmployeeIdentifier(
        "device",
        deviceIdentifier,
        employeeSecret,
      ),
      status: "ACTIVE",
      canView: true,
      canPunch: true,
      firstVerifiedAt: now,
      lastActiveAt: now,
      createdAt: now,
    },
  });
  await database.employeeSession.create({
    data: {
      employeeAccountId: account.id,
      membershipId: membership.id,
      businessId: business.id,
      primaryBranchId: branch.id,
      employeeDeviceId: device.id,
      refreshTokenHash: hashEmployeeSessionToken(
        sessionToken,
        employeeSecret,
      ),
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      lastActiveAt: now,
      createdAt: now,
    },
  });

  return {
    sessionToken,
    deviceIdentifier,
    businessId: business.id,
    branchId: branch.id,
    unauthorizedBranchId: unauthorizedBranch.id,
    otherBusinessBranchId: otherBusinessBranch.id,
    employeeAccountId: account.id,
    membershipId: membership.id,
  };
}

function attendanceSetting(businessId: string, branchId: string) {
  return {
    businessId,
    branchId,
    latitude: 1.5535,
    longitude: 110.3593,
    geofenceRadiusMeters: 100,
    minimumAccuracyMeters: 80,
    requireGeofence: true,
    allowOutsideGeofenceRequest: true,
    requirePhoto: false,
    timezone: "Asia/Kuching",
    isEnabled: true,
  };
}

function punchBody(
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

function punchRequest(
  pathname: string,
  cookie: string,
  body: unknown,
) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
