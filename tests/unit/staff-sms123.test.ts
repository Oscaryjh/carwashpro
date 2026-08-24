import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeAttendancePhone } from "../../src/lib/attendance/phone";
import { getEmployeeAuthConfig } from "../../src/lib/attendance/employee-auth/config";
import {
  buildEmployeeOtpMessage,
  createEmployeeOtpReferenceId,
  EmployeeOtpProviderError,
  Sms123Provider,
  toSms123Recipient,
} from "../../src/lib/attendance/employee-auth/provider";

const TEST_SECRET = "staff-sms123-unit-secret-that-is-at-least-thirty-two-bytes";
const TEST_API_KEY = "sms123-test-api-key-never-real";

test("SMS123 adapter sends the required Malaysian request without changing OTP authority", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  const provider = new Sms123Provider(sms123Config(), async (input, init) => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "";
    return Response.json({
      status: "ok",
      msgCode: "E00001",
      statusMsg: "Completed successfully.",
      referenceID: "otp_challenge-a_1",
      balance: "10.00",
      data: "accepted",
    });
  });

  const result = await provider.sendSms(sampleSend());
  assert.equal(result.status, "SENT");
  assert.equal(result.providerMessageCode, "E00001");
  assert.equal(result.providerReferenceId, "otp_challenge-a_1");
  assert.equal(capturedMethod, "GET");
  const requestUrl = new URL(capturedUrl);
  assert.equal(requestUrl.origin, "https://www.sms123.net");
  assert.equal(requestUrl.pathname, "/api/send.php");
  assert.equal(requestUrl.searchParams.get("apiKey"), TEST_API_KEY);
  assert.equal(requestUrl.searchParams.get("recipients"), "601112212259");
  assert.equal(requestUrl.searchParams.get("messageContent"), sampleSend().message);
  assert.equal(requestUrl.searchParams.get("referenceID"), "otp_challenge-a_1");
});

test("SMS123 adapter requires both HTTP success and provider success code", async () => {
  const provider = new Sms123Provider(
    sms123Config(),
    async () => Response.json({
      status: "error",
      msgCode: "E00012",
      statusMsg: "sensitive provider detail",
    }),
  );
  await assert.rejects(
    provider.sendSms(sampleSend()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_REJECTED" &&
      error.providerMessageCode === "E00012" &&
      !error.message.includes("sensitive provider detail"),
  );
});

test("SMS123 network and invalid JSON failures are normalized", async () => {
  const unavailable = new Sms123Provider(sms123Config(), async () => {
    throw new Error("network secret payload");
  });
  await assert.rejects(
    unavailable.sendSms(sampleSend()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_UNAVAILABLE" &&
      !error.message.includes("secret payload"),
  );

  const invalidJson = new Sms123Provider(
    sms123Config(),
    async () => new Response("not-json"),
  );
  await assert.rejects(
    invalidJson.sendSms(sampleSend()),
    (error: unknown) =>
      error instanceof EmployeeOtpProviderError &&
      error.code === "PROVIDER_INVALID_RESPONSE",
  );
});

test("SMS123 phone normalization, message and reference IDs are deterministic and safe", () => {
  for (const input of [
    "01112212259",
    "011-1221 2259",
    "+601112212259",
    "601112212259",
  ]) {
    assert.equal(normalizeAttendancePhone(input), "+601112212259");
  }
  assert.equal(toSms123Recipient("+601112212259"), "601112212259");
  assert.equal(toSms123Recipient("6011-1221 2259"), "601112212259");
  assert.throws(() => toSms123Recipient("+441234567890"));
  assert.match(buildEmployeeOtpMessage("483921", sms123Config()), /^RM0 Tetamu:/);
  assert.match(buildEmployeeOtpMessage("483921", sms123Config()), /Valid for 5 minutes/);
  assert.equal(createEmployeeOtpReferenceId("challenge-a"), "otp_challenge-a_1");
  assert.notEqual(
    createEmployeeOtpReferenceId("challenge-a"),
    createEmployeeOtpReferenceId("challenge-b"),
  );
  assert.doesNotMatch(createEmployeeOtpReferenceId("challenge-a"), /483921/);
});

test("SMS123 configuration fails closed and Production can never accept 000000", () => {
  assert.throws(
    () => getEmployeeAuthConfig({
      NODE_ENV: "production",
      EMPLOYEE_AUTH_SECRET: TEST_SECRET,
      SMS_PROVIDER: "mock",
      OTP_CHANNEL: "local",
      EMPLOYEE_OTP_MOCK_CODE: "000000",
    }),
    /mock mode is not available in production/i,
  );
  assert.throws(
    () => getEmployeeAuthConfig({
      NODE_ENV: "production",
      EMPLOYEE_AUTH_SECRET: TEST_SECRET,
      SMS_PROVIDER: "sms123",
      OTP_CHANNEL: "sms",
      EMPLOYEE_OTP_MOCK_CODE: "000000",
      SMS123_API_KEY: TEST_API_KEY,
    }),
    /MOCK_CODE is available only/i,
  );
  assert.throws(
    () => getEmployeeAuthConfig({
      NODE_ENV: "test",
      EMPLOYEE_AUTH_SECRET: TEST_SECRET,
      SMS_PROVIDER: "sms123",
      OTP_CHANNEL: "sms",
    }),
    /SMS123_API_KEY/i,
  );
  const config = sms123Config();
  assert.equal(config.otp.provider, "sms123");
  assert.equal(config.otp.mockCode, null);
  assert.equal(config.otp.expiresInSeconds, 300);
  assert.equal(config.otp.maxAttempts, 5);
  assert.equal(config.otp.resendCooldownSeconds, 60);
});

test("SMS123 migration stores HMAC metadata without deleting legacy Twilio rows", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260824130000_staff_app_sms123_otp/migration.sql",
    "utf8",
  );
  const otpService = readFileSync(
    "src/lib/attendance/employee-auth/otp-service.ts",
    "utf8",
  );
  const client = readFileSync("src/components/staff-pwa/staff-auth.tsx", "utf8");
  assert.match(schema, /providerMessageCode\s+String\?/);
  assert.match(migration, /"provider" = 'sms123'[\s\S]*?"otp_hash" IS NOT NULL/);
  assert.match(migration, /"provider" = 'twilio_verify'[\s\S]*?"otp_hash" IS NULL/);
  assert.match(otpService, /otpHash = hashEmployeeOtp/);
  assert.match(otpService, /verifyEmployeeOtpHash/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(client, /SMS123_API_KEY|NEXT_PUBLIC_SMS123/i);
});

function sms123Config() {
  return getEmployeeAuthConfig({
    NODE_ENV: "test",
    EMPLOYEE_AUTH_SECRET: TEST_SECRET,
    SMS_PROVIDER: "sms123",
    OTP_CHANNEL: "sms",
    SMS123_API_KEY: TEST_API_KEY,
    SMS123_API_BASE_URL: "https://www.sms123.net/api",
    SMS123_MESSAGE_PREFIX: "RM0",
    OTP_LENGTH: "6",
    OTP_TTL_SECONDS: "300",
    OTP_RESEND_COOLDOWN_SECONDS: "60",
    OTP_MAX_VERIFY_ATTEMPTS: "5",
  });
}

function sampleSend() {
  const config = sms123Config();
  return {
    recipient: "+601112212259",
    message: buildEmployeeOtpMessage("483921", config),
    referenceId: "otp_challenge-a_1",
    challengeId: "challenge-a",
    purpose: "LOGIN" as const,
    expiresAt: new Date("2026-08-24T01:05:00.000Z"),
    locale: "en-MY",
  };
}
