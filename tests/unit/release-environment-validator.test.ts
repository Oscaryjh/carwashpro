import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

function validate(scope: string, env: Record<string, string>) {
  return spawnSync(process.execPath, ["scripts/validate-release-environment.mjs", scope], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const productionBase = {
  APP_ENVIRONMENT: "production",
  APP_RELEASE_SHA: "abcdef1234567890",
  APP_RELEASE_SOURCE_DIGEST: "a".repeat(64),
  DATABASE_URL: "postgresql://user:pass@production-db.internal:5432/tetamu",
  SESSION_SECRET: "s".repeat(32),
  MFA_ACTIVE_KEY_VERSION: "v1",
  MFA_ENCRYPTION_KEYS: "v1:" + "m".repeat(32),
  PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "v1",
  PAYROLL_PAYMENT_ENCRYPTION_KEYS: "v1:" + "p".repeat(32),
  PAYROLL_PAYMENT_FINGERPRINT_KEY: "f".repeat(32),
  EMPLOYEE_OTP_SEND_MODE: "provider",
  OTP_PROVIDER: "twilio_verify",
  OTP_CHANNEL: "sms",
  EMPLOYEE_OTP_MOCK_CODE: "",
  TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
  TWILIO_VERIFY_SERVICE_SID: `VA${"b".repeat(32)}`,
  TWILIO_AUTH_TOKEN: "t".repeat(32),
  AI_GLOBAL_ENABLED: "false",
  AI_PROVIDER: "mock",
  OPENAI_API_KEY: "",
  WHATSAPP_SEND_MODE: "live",
};

test("Testing environment permits controlled mocks", () => {
  const result = validate("notification", {
    APP_ENVIRONMENT: "testing",
    NODE_ENV: "production",
    WHATSAPP_SEND_MODE: "mock",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Production environment fails closed when source identity is incomplete", () => {
  const result = validate("notification", {
    ...productionBase,
    APP_RELEASE_SOURCE_DIGEST: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_RELEASE_SOURCE_DIGEST/i);
});

test("Production environment rejects employee OTP, AI and WhatsApp mocks", () => {
  const otp = validate("web", { ...productionBase, OTP_PROVIDER: "mock", OTP_CHANNEL: "local" });
  assert.notEqual(otp.status, 0);
  assert.match(otp.stderr, /Employee OTP mock/i);

  const ai = validate("web", { ...productionBase, AI_GLOBAL_ENABLED: "true" });
  assert.notEqual(ai.status, 0);
  assert.match(ai.stderr, /AI_PROVIDER/i);

  const whatsapp = validate("notification", { ...productionBase, WHATSAPP_SEND_MODE: "mock" });
  assert.notEqual(whatsapp.status, 0);
  assert.match(whatsapp.stderr, /WHATSAPP_SEND_MODE/i);
});

test("Production web contract can pass with mocks disabled and optional AI off", () => {
  const result = validate("web", productionBase);
  assert.equal(result.status, 0, result.stderr);
});

test("Production web contract accepts SMS123 with a server-only API key", () => {
  const result = validate("web", {
    ...productionBase,
    EMPLOYEE_OTP_SEND_MODE: "sms123",
    OTP_PROVIDER: "sms123",
    SMS123_API_KEY: "k".repeat(32),
    TWILIO_ACCOUNT_SID: "",
    TWILIO_VERIFY_SERVICE_SID: "",
    TWILIO_AUTH_TOKEN: "",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Production SMS123 configuration fails closed without its API key", () => {
  const result = validate("web", {
    ...productionBase,
    EMPLOYEE_OTP_SEND_MODE: "sms123",
    OTP_PROVIDER: "sms123",
    SMS123_API_KEY: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SMS123_API_KEY/i);
});
