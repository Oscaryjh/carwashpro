import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import {
  EmployeeOtpProviderError,
  TwilioVerifySmsProvider,
} from "../../src/lib/attendance/employee-auth/provider";

const TEST_SECRET = "staff-twilio-unit-secret-that-is-at-least-thirty-two-bytes";
const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const SERVICE_SID = `VA${"b".repeat(32)}`;

test("Twilio Verify adapter starts SMS verification without receiving an OTP from Tetamu", async () => {
  let capturedBody = "";
  const provider = new TwilioVerifySmsProvider(
    twilioConfig(),
    async (_url, init) => {
      capturedBody = String(init?.body);
      return Response.json({
        sid: `VE${"c".repeat(32)}`,
        status: "pending",
      });
    },
  );
  const result = await provider.sendVerification({
    challengeId: "challenge-a",
    phoneNumber: "+60123456789",
    purpose: "LOGIN",
    expiresAt: new Date("2026-08-13T01:00:00.000Z"),
    locale: "en-MY",
  });

  assert.equal(result.providerReference, `VE${"c".repeat(32)}`);
  assert.match(capturedBody, /To=%2B60123456789/);
  assert.match(capturedBody, /Channel=sms/);
  assert.doesNotMatch(capturedBody, /Code|000000/);
});

test("Twilio Verify adapter accepts only approved Verification Check status", async () => {
  for (const [providerStatus, expected] of [
    ["approved", "APPROVED"],
    ["pending", "REJECTED"],
    ["expired", "EXPIRED"],
    ["max_attempts_reached", "LOCKED"],
  ] as const) {
    const provider = new TwilioVerifySmsProvider(
      twilioConfig(),
      async () => Response.json({ status: providerStatus }),
    );
    const result = await provider.checkVerification({
      challengeId: "challenge-a",
      phoneNumber: "+60123456789",
      providerReference: `VE${"d".repeat(32)}`,
      code: "123456",
    });
    assert.equal(result.status, expected);
  }
});

test("Twilio Verify adapter normalizes provider failures without exposing response payloads", async () => {
  const rateLimited = new TwilioVerifySmsProvider(
    twilioConfig(),
    async () => Response.json({ code: 20429, message: "sensitive" }, { status: 429 }),
  );
  await assert.rejects(
    rateLimited.sendVerification(sampleStart()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_RATE_LIMITED" &&
      !error.message.includes("sensitive"),
  );

  const unavailable = new TwilioVerifySmsProvider(
    twilioConfig(),
    async () => {
      throw new Error("network secret payload");
    },
  );
  await assert.rejects(
    unavailable.sendVerification(sampleStart()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      !error.message.includes("secret payload"),
  );
});

test("Twilio Verify expired/deleted checks are rejected safely", async () => {
  const provider = new TwilioVerifySmsProvider(
    twilioConfig(),
    async () => Response.json({ code: 60431 }, { status: 404 }),
  );
  assert.deepEqual(
    await provider.checkVerification({
      challengeId: "challenge-a",
      phoneNumber: "+60123456789",
      providerReference: `VE${"d".repeat(32)}`,
      code: "123456",
    }),
    { status: "EXPIRED" },
  );
});

test("Twilio provider configuration is fail-closed and Production mock/000000 is impossible", () => {
  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        OTP_PROVIDER: "mock",
        OTP_CHANNEL: "local",
        EMPLOYEE_OTP_MOCK_CODE: "000000",
      }),
    /mock mode is not available in production/i,
  );
  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "test",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        OTP_PROVIDER: "twilio_verify",
        OTP_CHANNEL: "sms",
      }),
    /TWILIO_ACCOUNT_SID/i,
  );
  const config = twilioConfig();
  assert.equal(config.otp.provider, "twilio_verify");
  assert.equal(config.otp.mockCode, null);
});

test("Twilio migration is additive and new provider challenges cannot store an OTP hash", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260813120000_staff_app_twilio_verify_sms/migration.sql",
    "utf8",
  );
  assert.match(schema, /otpHash\s+String\?/);
  assert.match(migration, /"provider" = 'twilio_verify'[\s\S]*?"otp_hash" IS NULL/);
  assert.match(migration, /ALTER COLUMN "otp_hash" DROP NOT NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

function twilioConfig() {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    OTP_PROVIDER: "twilio_verify",
    OTP_CHANNEL: "sms",
    TWILIO_ACCOUNT_SID: ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: "testing-auth-token-never-a-real-secret",
    TWILIO_VERIFY_SERVICE_SID: SERVICE_SID,
  });
}

function sampleStart() {
  return {
    challengeId: "challenge-a",
    phoneNumber: "+60123456789",
    purpose: "LOGIN" as const,
    expiresAt: new Date("2026-08-13T01:00:00.000Z"),
    locale: "en-MY",
  };
}
