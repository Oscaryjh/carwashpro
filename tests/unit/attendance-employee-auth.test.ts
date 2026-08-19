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
import {
  assertEmployeeAuthSameOrigin,
  readEmployeeAuthJson,
} from "../../src/lib/attendance/employee-auth/http";
import {
  clearMockEmployeeOtp,
  MockEmployeeOtpProvider,
  readMockEmployeeOtp,
} from "../../src/lib/attendance/employee-auth/provider";

const TEST_SECRET =
  "phase-1c-test-secret-that-is-longer-than-thirty-two-bytes";

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

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        RAILWAY_ENVIRONMENT_NAME: "testing",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_TESTING_ENABLED: "true",
        OTP_PROVIDER: "mock",
        EMPLOYEE_OTP_MOCK_CODE: "000000",
      }),
    /mock mode is not available in production/i,
  );

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
    /only in non-production mock mode/,
  );

  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        EMPLOYEE_OTP_SEND_MODE: "provider",
        EMPLOYEE_OTP_MOCK_CODE: "000000",
      }),
    /only in non-production mock mode/,
  );
});

test("employee auth crypto uses domain-separated hashes and one-time secrets", () => {
  const config = testConfig();
  const otp = createEmployeeOtp();
  const sessionTokenA = createEmployeeSessionToken();
  const sessionTokenB = createEmployeeSessionToken();
  const otpHash = hashEmployeeOtp("challenge-a", otp, config.authSecret);

  assert.match(otp, /^\d{6}$/);
  assert.notEqual(sessionTokenA, sessionTokenB);
  assert.notEqual(sessionTokenA, hashEmployeeSessionToken(sessionTokenA, config.authSecret));
  assert.equal(
    verifyEmployeeOtpHash(
      "challenge-a",
      otp,
      otpHash,
      config.authSecret,
    ),
    true,
  );
  assert.equal(
    verifyEmployeeOtpHash(
      "challenge-b",
      otp,
      otpHash,
      config.authSecret,
    ),
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

  await provider.sendOtp({
    challengeId: "challenge-mock",
    phoneNumber: "+60123456789",
    otp: "123456",
    purpose: "LOGIN",
    expiresAt,
    locale: "en-MY",
  });

  assert.throws(
    () => readMockEmployeeOtp("challenge-mock", "wrong-key", config),
    (error: unknown) =>
      error instanceof EmployeeAuthError &&
      error.code === "UNAUTHENTICATED",
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
  await fixedProvider.sendVerification({
    challengeId: "challenge-fixed",
    phoneNumber: "+601112212259",
    purpose: "LOGIN",
    expiresAt,
    locale: "en-MY",
  });
  clearMockEmployeeOtp("challenge-fixed", fixedConfig);
  assert.deepEqual(
    await new MockEmployeeOtpProvider(fixedConfig).checkVerification({
      challengeId: "challenge-fixed",
      phoneNumber: "+601112212259",
      providerReference: "mock:challenge-fixed",
      code: "000000",
    }),
    { status: "APPROVED" },
    "fixed Local mock codes must survive isolated Next.js route module instances",
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
      error instanceof EmployeeAuthError &&
      error.code === "INVALID_REQUEST",
  );

  const oversized = new Request(
    "http://localhost/api/employee-auth/example",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "2048",
      },
      body: "{}",
    },
  );
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
      new URL(response.headers.get("location") ?? "", "http://localhost").pathname,
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

function testConfig(
  overrides: Partial<NodeJS.ProcessEnv> = {},
) {
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
