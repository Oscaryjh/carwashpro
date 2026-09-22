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
  RAILWAY_ENVIRONMENT_ID: "bef43b86-32dc-486e-a1ef-bb9f9699e4f5",
  RAILWAY_ENVIRONMENT_NAME: "production",
  POS_PILOT_FROZEN_DOMAINS: "true",
  POS_PILOT_RELEASE_MODE: "core-pilot",
  POS_PILOT_WRITE_FREEZE_MODE: "full",
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
    POS_PILOT_FROZEN_DOMAINS: "true",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "full",
    WHATSAPP_SEND_MODE: "mock",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Production release validation fails closed for missing or ambiguous write-freeze mode", () => {
  for (const value of ["", "FULL", "true", "disabled"]) {
    const result = validate("web", {
      ...productionBase,
      POS_PILOT_WRITE_FREEZE_MODE: value,
    });
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /POS_PILOT_WRITE_FREEZE_MODE/i, value);
  }
});

test("Production operator-smoke startup requires the complete dedicated capability scope", () => {
  const operatorSmoke = {
    ...productionBase,
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: "s".repeat(64),
    POS_PILOT_SMOKE_OPERATOR_USER_ID: "11111111-1111-4111-8111-111111111111",
    POS_PILOT_SMOKE_BUSINESS_ID: "22222222-2222-4222-8222-222222222222",
    POS_PILOT_SMOKE_BRANCH_ID: "33333333-3333-4333-8333-333333333333",
  };
  assert.equal(validate("web", operatorSmoke).status, 0);
  for (const key of [
    "POS_PILOT_SMOKE_SECRET",
    "POS_PILOT_SMOKE_OPERATOR_USER_ID",
    "POS_PILOT_SMOKE_BUSINESS_ID",
    "POS_PILOT_SMOKE_BRANCH_ID",
  ]) {
    const result = validate("web", { ...operatorSmoke, [key]: "" });
    assert.notEqual(result.status, 0, key);
    assert.match(result.stderr, new RegExp(key), key);
  }
});

test("Production environment fails closed when source identity is incomplete", () => {
  const result = validate("notification", {
    ...productionBase,
    APP_RELEASE_SOURCE_DIGEST: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /APP_RELEASE_SOURCE_DIGEST/i);
});

test("Railway Production cannot be downgraded by APP_ENVIRONMENT", () => {
  const result = validate("web", {
    ...productionBase,
    APP_ENVIRONMENT: "development",
    POS_PILOT_RELEASE_MODE: "",
    POS_PILOT_FROZEN_DOMAINS: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /conflicting runtime environment identities/i);
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
  const result = validate("web", {
    ...productionBase,
    PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "",
    PAYROLL_PAYMENT_ENCRYPTION_KEYS: "",
    PAYROLL_PAYMENT_FINGERPRINT_KEY: "",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Production web contract enforces the same live WhatsApp identity as direct send", () => {
  const wrongMode = validate("web", { ...productionBase, WHATSAPP_SEND_MODE: "disabled" });
  assert.notEqual(wrongMode.status, 0);
  assert.match(wrongMode.stderr, /WHATSAPP_SEND_MODE/i);

  const wrongIdentity = validate("web", {
    ...productionBase,
    RAILWAY_ENVIRONMENT_ID: "00000000-0000-4000-8000-000000000000",
  });
  assert.notEqual(wrongIdentity.status, 0);
  assert.match(wrongIdentity.stderr, /source-pinned Railway Production identity/i);
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
