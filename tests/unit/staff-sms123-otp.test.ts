import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import { hashEmployeeOtp } from "../../src/lib/attendance/employee-auth/crypto";
import {
  describeEmployeeOtpProviderFailure,
  EmployeeOtpProviderError,
  Sms123OtpProvider,
} from "../../src/lib/attendance/employee-auth/provider";

const TEST_SECRET = "staff-sms123-unit-secret-that-is-at-least-thirty-two-bytes";
const API_KEY = "testing-sms123-api-key-not-a-real-secret";

test("SMS123 adapter sends the approved Tetamu SMS using the verified GET integration", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const provider = new Sms123OtpProvider(
    sms123Config(),
    async (url, init) => {
      capturedUrl = String(url);
      capturedMethod = init?.method ?? "";
      return Response.json({
        status: "ok",
        msgCode: "E00001",
        referenceID: ["sms-reference-1"],
        data: [
          { recipients: "601151300932", referenceID: "sms-reference-1" },
        ],
      });
    },
  );

  const result = await provider.sendVerification({
    challengeId: "challenge-sms123-a",
    phoneNumber: "+601151300932",
    purpose: "LOGIN",
    expiresAt: new Date("2026-08-24T01:05:00.000Z"),
    locale: "en-MY",
    code: "784571",
  });

  const requestUrl = new URL(capturedUrl);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://www.sms123.net/api/send.php");
  assert.equal(capturedMethod, "GET");
  assert.equal(requestUrl.searchParams.get("apiKey"), API_KEY);
  assert.equal(requestUrl.searchParams.get("recipients"), "601151300932");
  assert.equal(requestUrl.searchParams.get("referenceID"), "challenge-sms123-a");
  assert.equal(
    requestUrl.searchParams.get("messageContent"),
    "RM0 Tetamu: Your OTP is 784571. Valid for 5 minutes. Do not share this code.",
  );
  assert.equal(result.providerReference, "sms123:sms-reference-1");
});

test("SMS123 verification checks the keyed hash without another provider request", async () => {
  let providerRequests = 0;
  const provider = new Sms123OtpProvider(sms123Config(), async () => {
    providerRequests += 1;
    throw new Error("check must not call SMS123");
  });
  const challengeId = "challenge-sms123-b";
  const otpHash = hashEmployeeOtp(challengeId, "123456", TEST_SECRET);

  assert.deepEqual(
    await provider.checkVerification({
      challengeId,
      phoneNumber: "+601151300932",
      providerReference: "sms123:sms-reference-2",
      code: "123456",
      otpHash,
    }),
    { status: "APPROVED" },
  );
  assert.deepEqual(
    await provider.checkVerification({
      challengeId,
      phoneNumber: "+601151300932",
      providerReference: "sms123:sms-reference-2",
      code: "654321",
      otpHash,
    }),
    { status: "REJECTED" },
  );
  assert.equal(providerRequests, 0);
});

test("SMS123 adapter maps gateway failures without exposing the response message", async () => {
  const provider = new Sms123OtpProvider(
    sms123Config(),
    async () =>
      Response.json({
        status: "error",
        msgCode: "E00359",
        statusMsg: "sensitive provider detail",
      }),
  );

  await assert.rejects(
    provider.sendVerification(sampleStart()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_REJECTED" &&
      error.providerCode === "E00359" &&
      !error.message.includes("sensitive provider detail"),
  );
});

test("SMS123 failures expose only a safe support reason and provider code", () => {
  assert.deepEqual(
    describeEmployeeOtpProviderFailure(
      new EmployeeOtpProviderError(
        "PROVIDER_REJECTED",
        "gateway response must stay private",
        { httpStatus: 200, providerCode: "BE00036" },
      ),
    ),
    {
      failureCode: "PROVIDER_REJECTED",
      httpStatus: 200,
      providerCode: "BE00036",
      reason: "The SMS template or company name is not whitelisted.",
    },
  );
});

test("SMS123 configuration and database constraint fail closed", () => {
  assert.throws(
    () =>
      getEmployeeAuthConfig({
        NODE_ENV: "production",
        EMPLOYEE_AUTH_SECRET: TEST_SECRET,
        OTP_PROVIDER: "sms123",
        OTP_CHANNEL: "sms",
      }),
    /SMS123_API_KEY/i,
  );
  const config = sms123Config();
  assert.equal(config.otp.provider, "sms123");
  assert.equal(config.otp.channel, "sms");
  assert.equal(config.otp.sms123.apiKey, API_KEY);

  const migration = readFileSync(
    "prisma/migrations/20260824190000_staff_app_sms123_otp/migration.sql",
    "utf8",
  );
  assert.match(
    migration,
    /"provider" = 'sms123'[\s\S]*?"delivery_channel" = 'sms'[\s\S]*?"otp_hash" IS NOT NULL/,
  );
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});

test("forward OTP hardening extends the Testing schema without resurrecting legacy migrations", () => {
  const migration = readFileSync(
    "prisma/migrations/20260902120000_staff_otp_forward_hardening/migration.sql",
    "utf8",
  );

  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "provider_message_code" TEXT/,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "employee_otp_challenges_provider_message_code_check"/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "enforce_employee_otp_challenge_lifecycle"/,
  );
  assert.match(
    migration,
    /Employee OTP provider message code is immutable/,
  );
  assert.doesNotMatch(
    migration,
    /employee_otp_challenges_provider_check|invalidate_previous_employee_otp_challenges/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+"employee_otp_challenges"/i);

  for (const legacyId of [
    "20260822010000_staff_app_appearance",
    "20260822023000_development_concurrent_otp_challenges",
    "20260824130000_staff_app_sms123_otp",
  ]) {
    assert.equal(
      existsSync(`prisma/migrations/${legacyId}/migration.sql`),
      false,
      `${legacyId} must not re-enter the canonical first-release history`,
    );
  }
});

function sms123Config() {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    OTP_PROVIDER: "sms123",
    OTP_CHANNEL: "sms",
    SMS123_API_KEY: API_KEY,
  });
}

function sampleStart() {
  return {
    challengeId: "challenge-sms123-a",
    phoneNumber: "+601151300932",
    purpose: "LOGIN" as const,
    expiresAt: new Date("2026-08-24T01:05:00.000Z"),
    locale: "en-MY",
    code: "784571",
  };
}
