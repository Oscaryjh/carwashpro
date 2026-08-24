import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { middleware } from "../../src/middleware";
import { POST as requestOtpRoute } from "../../src/app/api/employee-auth/request-otp/route";
import {
  EMPLOYEE_SESSION_COOKIE,
  getEmployeeAuthConfig,
} from "../../src/lib/attendance/employee-auth/config";
import { readEmployeeSessionToken } from "../../src/lib/attendance/employee-auth/cookie";
import {
  createEmployeeOtp,
  createEmployeeSessionToken,
  hashEmployeeIdentifier,
  hashEmployeeOtp,
  hashEmployeeSessionToken,
  verifyEmployeeOtpHash,
} from "../../src/lib/attendance/employee-auth/crypto";
import { EmployeeAuthError } from "../../src/lib/attendance/employee-auth/errors";
import { bindVerifiedEmployeeDevice } from "../../src/lib/attendance/employee-auth/device-service";
import {
  assertEmployeeAuthSameOrigin,
  readEmployeeAuthJson,
} from "../../src/lib/attendance/employee-auth/http";
import {
  buildEmployeeOtpMessage,
  clearMockEmployeeOtp,
  createEmployeeOtpReferenceId,
  MockEmployeeOtpProvider,
  readMockEmployeeOtp,
} from "../../src/lib/attendance/employee-auth/provider";
import {
  checkEmployeeOtpRateLimit,
  checkEmployeeOtpVerifyRateLimit,
} from "../../src/lib/attendance/employee-auth/rate-limit";
import { buildEmployeeOtpChallengeInvalidationWhere } from "../../src/lib/attendance/employee-auth/otp-service";

const TEST_SECRET = "phase-1c-test-secret-that-is-longer-than-thirty-two-bytes";

test("employee auth config is centralized and production mock fails closed", () => {
  const config = testConfig({
    EMPLOYEE_OTP_PROVIDER_HOURLY_LIMIT: "321",
    EMPLOYEE_OTP_LOCALE: "ms-MY",
    OTP_SEND_MODE: "provider",
  });

  assert.equal(config.otp.sendMode, "mock");
  assert.equal(config.otp.providerRequestsPerHour, 321);
  assert.equal(config.otp.locale, "ms-MY");
  assert.equal(config.session.cookieName, "tetamu_employee_session");

  const fixedMockCodeConfig = testConfig({
    EMPLOYEE_OTP_MOCK_CODE: "000000",
  });
  assert.equal(fixedMockCodeConfig.otp.mockCode, "000000");

  const localDevelopmentConfig = getEmployeeAuthConfig({
    NODE_ENV: "development",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
  });
  assert.equal(localDevelopmentConfig.otp.sendMode, "mock");
  assert.equal(localDevelopmentConfig.otp.mockCode, "000000");
  assert.equal(localDevelopmentConfig.otp.developmentFastPath, true);
  assert.equal(localDevelopmentConfig.otp.expiresInSeconds, 24 * 60 * 60);
  assert.equal(localDevelopmentConfig.otp.resendCooldownSeconds, 0);
  assert.equal(localDevelopmentConfig.session.allowConcurrentDevices, true);
  assert.equal(fixedMockCodeConfig.otp.developmentFastPath, false);
  assert.equal(fixedMockCodeConfig.session.allowConcurrentDevices, false);

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_SEND_MODE: "mock",
      }),
    (error: unknown) =>
      error instanceof EmployeeAuthError &&
      error.code === "CONFIGURATION_ERROR",
  );

  const railwayTestingConfig = getEmployeeAuthConfig({
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "testing",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    EMPLOYEE_OTP_TESTING_ENABLED: "true",
    OTP_PROVIDER: "mock",
    OTP_CHANNEL: "local",
    EMPLOYEE_OTP_MOCK_CODE: "000000",
  });
  assert.equal(railwayTestingConfig.otp.testingDeployment, true);
  assert.equal(railwayTestingConfig.otp.mockCode, "000000");
  assert.equal(new MockEmployeeOtpProvider(railwayTestingConfig).name, "mock");

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_TESTING_ENABLED: "true",
        EMPLOYEE_OTP_SEND_MODE: "mock",
      }),
    /restricted to the Railway testing environment/i,
  );

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "test",
        EMPLOYEE_AUTH_SECRET: "too-short",
        EMPLOYEE_OTP_SEND_MODE: "mock",
      }),
    /EMPLOYEE_AUTH_SECRET/,
  );

  assert.throws(
    () => testConfig({ EMPLOYEE_OTP_MOCK_CODE: "12345" }),
    /exactly 6 digits/,
  );

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "test",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_SEND_MODE: "provider",
        EMPLOYEE_OTP_MOCK_CODE: "000000",
      }),
    /only in local\/test or the explicit Railway testing deployment/,
  );

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_SEND_MODE: "provider",
        EMPLOYEE_OTP_MOCK_CODE: "000000",
      }),
    /only in local\/test or the explicit Railway testing deployment/,
  );
});

test("development device binding keeps existing devices and sessions active", async () => {
  const config = getEmployeeAuthConfig({
    NODE_ENV: "development",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
  });
  let searchedForReplacementDevices = false;
  const deviceWrites: string[] = [];

  const transaction = {
    employeeDevice: {
      findUnique: async () => null,
      findMany: async () => {
        searchedForReplacementDevices = true;
        throw new Error(
          "Development mode must not replace another active device.",
        );
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        deviceWrites.push("demote-existing-punch-device");
        assert.deepEqual(args.where, {
          employeeAccountId: "development-account",
          status: "ACTIVE",
          canPunch: true,
        });
        assert.deepEqual(args.data, { canPunch: false });
        return { count: 1 };
      },
      create: async () => {
        assert.deepEqual(deviceWrites, ["demote-existing-punch-device"]);
        deviceWrites.push("create-current-punch-device");
        return {
          id: "development-device-2",
          canView: true,
          canPunch: true,
        };
      },
    },
  } as never;

  const result = await bindVerifiedEmployeeDevice(
    {
      employeeAccountId: "development-account",
      deviceIdentifierHash: "development-device-hash",
      now: new Date("2026-08-22T00:00:00.000Z"),
      purpose: "REGISTER_DEVICE",
    },
    transaction,
    config,
  );

  assert.equal(searchedForReplacementDevices, false);
  assert.deepEqual(result.replacedDeviceIds, []);
  assert.deepEqual(result.revokedSessionScopes, []);
  assert.equal(result.deviceId, "development-device-2");
  assert.deepEqual(deviceWrites, [
    "demote-existing-punch-device",
    "create-current-punch-device",
  ]);
});

test("development OTP requests invalidate only the current device challenge", () => {
  const base = {
    phoneNumberNormalized: "+601112212259",
    deviceFingerprintHash: "device-b-hash",
  };

  assert.deepEqual(
    buildEmployeeOtpChallengeInvalidationWhere({
      ...base,
      developmentFastPath: true,
    }),
    {
      phoneNumberNormalized: "+601112212259",
      purpose: { in: ["LOGIN", "REGISTER_DEVICE"] },
      invalidatedAt: null,
      deviceFingerprintHash: "device-b-hash",
    },
  );
  assert.deepEqual(
    buildEmployeeOtpChallengeInvalidationWhere({
      ...base,
      developmentFastPath: false,
    }),
    {
      phoneNumberNormalized: "+601112212259",
      purpose: { in: ["LOGIN", "REGISTER_DEVICE"] },
      invalidatedAt: null,
    },
  );
});

test("development mock OTP is ready immediately without cooldown or rate-limit waiting", async () => {
  const config = getEmployeeAuthConfig({
    NODE_ENV: "development",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
  });
  const unusedDatabase = new Proxy(
    {},
    {
      get() {
        throw new Error(
          "Development fast path must not query rate-limit counters.",
        );
      },
    },
  );

  const requestLimit = await checkEmployeeOtpRateLimit(
    {
      phoneNumberNormalized: "+601122334455",
      phoneIdentifierHash: "phone-hash",
      ipAddressHash: "ip-hash",
      deviceFingerprintHash: "device-hash",
      purpose: "LOGIN",
      now: new Date("2026-08-21T00:00:00.000Z"),
    },
    config,
    unusedDatabase as never,
  );
  const verifyLimit = await checkEmployeeOtpVerifyRateLimit(
    {
      phoneIdentifierHash: "phone-hash",
      ipAddressHash: "ip-hash",
      now: new Date("2026-08-21T00:00:00.000Z"),
    },
    config,
    unusedDatabase as never,
  );

  assert.equal(config.otp.resendCooldownSeconds, 0);
  assert.equal(requestLimit.requestAllowed, true);
  assert.equal(requestLimit.cooldownChallenge, null);
  assert.equal(verifyLimit.allowed, true);
});

test("employee auth crypto uses domain-separated hashes and one-time secrets", () => {
  const config = testConfig();
  const otp = createEmployeeOtp();
  const sessionTokenA = createEmployeeSessionToken();
  const sessionTokenB = createEmployeeSessionToken();
  const otpHash = hashEmployeeOtp("challenge-a", otp, config.authSecret);

  assert.match(otp, /^\d{6}$/);
  assert.notEqual(sessionTokenA, sessionTokenB);
  assert.notEqual(
    sessionTokenA,
    hashEmployeeSessionToken(sessionTokenA, config.authSecret),
  );
  assert.equal(
    verifyEmployeeOtpHash("challenge-a", otp, otpHash, config.authSecret),
    true,
  );
  assert.equal(
    verifyEmployeeOtpHash("challenge-b", otp, otpHash, config.authSecret),
    false,
  );
  assert.notEqual(
    hashEmployeeIdentifier("device", "same-value", config.authSecret),
    hashEmployeeIdentifier(
      "device-fingerprint",
      "same-value",
      config.authSecret,
    ),
  );
});

test("mock OTP is memory-only, access-key protected, and carries locale", async () => {
  const config = testConfig();
  const provider = new MockEmployeeOtpProvider(config);
  const expiresAt = new Date(Date.now() + 60_000);

  await provider.sendSms({
    challengeId: "challenge-mock",
    recipient: "+60123456789",
    message: buildEmployeeOtpMessage("123456", config),
    referenceId: createEmployeeOtpReferenceId("challenge-mock"),
    purpose: "LOGIN",
    expiresAt,
    locale: "en-MY",
  });

  assert.throws(
    () => readMockEmployeeOtp("challenge-mock", "wrong-key", config),
    (error: unknown) =>
      error instanceof EmployeeAuthError && error.code === "UNAUTHENTICATED",
  );
  assert.equal(
    readMockEmployeeOtp(
      "challenge-mock",
      config.otp.mockAccessKey ?? "",
      config,
    ),
    "123456",
  );

  const fixedConfig = testConfig({ EMPLOYEE_OTP_MOCK_CODE: "000000" });
  const fixedProvider = new MockEmployeeOtpProvider(fixedConfig);
  await fixedProvider.sendSms({
    challengeId: "challenge-fixed",
    recipient: "+601112212259",
    message: buildEmployeeOtpMessage("000000", fixedConfig),
    referenceId: createEmployeeOtpReferenceId("challenge-fixed"),
    purpose: "LOGIN",
    expiresAt,
    locale: "en-MY",
  });
  assert.equal(
    readMockEmployeeOtp(
      "challenge-fixed",
      fixedConfig.otp.mockAccessKey ?? "",
      fixedConfig,
    ),
    "000000",
  );
  clearMockEmployeeOtp("challenge-fixed", fixedConfig);
  assert.equal(
    readMockEmployeeOtp(
      "challenge-fixed",
      fixedConfig.otp.mockAccessKey ?? "",
      fixedConfig,
    ),
    null,
  );

  assert.throws(
    () =>
      new MockEmployeeOtpProvider({
        ...config,
        environment: "production",
      }),
    (error: unknown) =>
      error instanceof EmployeeAuthError &&
      error.code === "CONFIGURATION_ERROR",
  );
});

test("employee auth HTTP helper enforces same-origin, body limit, and Zod output type", async () => {
  const sameOrigin = jsonRequest(
    "http://localhost/api/employee-auth/example",
    { timestamp: "2026-07-30T00:00:00.000Z" },
    { origin: "http://localhost", "sec-fetch-site": "same-origin" },
  );
  assert.doesNotThrow(() => assertEmployeeAuthSameOrigin(sameOrigin));
  const parsed = await readEmployeeAuthJson(
    sameOrigin,
    z.object({
      timestamp: z.coerce.date(),
    }),
    1_024,
  );
  assert.equal(parsed.timestamp instanceof Date, true);

  const lanOriginBehindNextDev = jsonRequest(
    "http://localhost:3000/api/employee-auth/example",
    {},
    {
      host: "192.168.1.21:3000",
      origin: "http://192.168.1.21:3000",
      "sec-fetch-site": "same-origin",
    },
  );
  assert.doesNotThrow(() =>
    assertEmployeeAuthSameOrigin(lanOriginBehindNextDev),
  );

  const mismatchedLanOrigin = jsonRequest(
    "http://localhost:3000/api/employee-auth/example",
    {},
    {
      host: "192.168.1.21:3000",
      origin: "http://attacker.example",
      "sec-fetch-site": "same-origin",
    },
  );
  assert.throws(() => assertEmployeeAuthSameOrigin(mismatchedLanOrigin));

  const crossSite = jsonRequest(
    "http://localhost/api/employee-auth/example",
    {},
    { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  );
  assert.throws(
    () => assertEmployeeAuthSameOrigin(crossSite),
    (error: unknown) =>
      error instanceof EmployeeAuthError && error.code === "INVALID_REQUEST",
  );

  const oversized = new Request("http://localhost/api/employee-auth/example", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "2048",
    },
    body: "{}",
  });
  await assert.rejects(
    readEmployeeAuthJson(oversized, z.object({}), 1_024),
    (error: unknown) =>
      error instanceof EmployeeAuthError && error.status === 413,
  );
});

test("employee cookie is isolated from the admin cookie", () => {
  assert.notEqual(EMPLOYEE_SESSION_COOKIE, "car_wash_session");
  const request = new Request("http://localhost/api/employee-auth/me", {
    headers: {
      cookie: [
        "car_wash_session=admin-token",
        `${EMPLOYEE_SESSION_COOKIE}=employee-token`,
      ].join("; "),
    },
  });

  assert.equal(readEmployeeSessionToken(request), "employee-token");
  assert.equal(
    readEmployeeSessionToken(
      new Request("http://localhost/api/employee-auth/me", {
        headers: { cookie: "car_wash_session=admin-token" },
      }),
    ),
    null,
  );
});

test("employee cookie cannot authenticate the admin middleware", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET =
    "employee-cookie-isolation-test-secret-long-enough";

  try {
    const response = await middleware(
      new NextRequest("http://localhost:3000/team", {
        headers: {
          cookie: `${EMPLOYEE_SESSION_COOKIE}=employee-session-token`,
        },
      }),
    );

    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get("location") ?? "", "http://localhost")
        .pathname,
      "/login",
    );
  } finally {
    process.env.SESSION_SECRET = previousSecret;
  }
});

test("employee auth route returns structured errors without touching the database", async () => {
  const response = await requestOtpRoute(
    jsonRequest(
      "http://localhost/api/employee-auth/request-otp",
      {
        phoneNumber: "+60123456789",
        deviceIdentifier: "device-identifier-long-enough",
      },
      {
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
    ),
  );
  const body = (await response.json()) as {
    ok: boolean;
    error: { code: string; message: string };
  };

  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "INVALID_REQUEST");
  assert.equal(typeof body.error.message, "string");
});

function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    EMPLOYEE_OTP_SEND_MODE: "mock",
    EMPLOYEE_OTP_MOCK_ACCESS_KEY: "mock-access-key-for-tests",
    ...overrides,
  });
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
