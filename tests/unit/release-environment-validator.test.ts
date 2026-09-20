import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { productionRuntimeFixture } from "../helpers/production-runtime-fixture";

function validate(scope: string, env: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "rc-validator-"));
  try {
    const { attestation } = productionRuntimeFixture(scope);
    mkdirSync(join(directory, ".release"));
    writeFileSync(join(directory, "package-lock.json"), "{}");
    writeFileSync(join(directory, ".release/source-attestation.json"), JSON.stringify({ ...attestation, lockfileHash: createHash("sha256").update("{}").digest("hex") }));
    return spawnSync(process.execPath, [resolve("scripts/validate-release-environment.mjs"), scope], {
      cwd: directory, encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...env, APP_SERVICE_SCOPE: scope, RAILWAY_SERVICE_ID: `synthetic-${scope}`, PRODUCTION_EXPECTED_SERVICE_ID: `synthetic-${scope}` },
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const productionBase = {
  ...productionRuntimeFixture().env,
  APP_ENVIRONMENT: "production",
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
  assert.match(otp.stderr, /OTP_PROVIDER|Employee OTP mock/i);

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

test("disabled WhatsApp does not authorize starting a live-only worker", () => {
  for (const scope of ["notification", "whatsapp"]) {
    const result = validate(scope, { ...productionBase, WHATSAPP_SEND_MODE: "disabled" });
    assert.notEqual(result.status, 0, "disabled transport cannot start this worker");
    assert.match(result.stderr, /WHATSAPP_SEND_MODE/);
  }
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
