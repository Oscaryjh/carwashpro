import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const previewBase: Record<string, string> = {
  APP_ENVIRONMENT: "uat-preview",
  NODE_ENV: "production",
  APP_RELEASE_SHA: "a".repeat(40),
  APP_RELEASE_SOURCE_DIGEST: "b".repeat(64),
  DATABASE_URL:
    "postgresql://preview_user:preview_password@preview-db.internal:5432/tetamu_uat_preview",
  SESSION_SECRET: "s".repeat(32),
  MFA_ACTIVE_KEY_VERSION: "v1",
  MFA_ENCRYPTION_KEYS: `v1:${"m".repeat(32)}`,
  PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "v1",
  PAYROLL_PAYMENT_ENCRYPTION_KEYS: `v1:${"p".repeat(32)}`,
  PAYROLL_PAYMENT_FINGERPRINT_KEY: "f".repeat(32),
  RAILWAY_DEPLOYMENT_ID: "preview-deployment",
  RAILWAY_PROJECT_ID: "preview-project",
  RAILWAY_ENVIRONMENT_ID: "preview-environment",
  RAILWAY_SERVICE_ID: "preview-web",
  RAILWAY_DATABASE_SERVICE_ID: "preview-database",
  UAT_PREVIEW_EXPECTED_PROJECT_ID: "preview-project",
  UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID: "preview-environment",
  UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID: "preview-web",
  UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID: "preview-database",
  UAT_PREVIEW_DATABASE_NAME: "tetamu_uat_preview",
  UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET: "g".repeat(32),
  UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT: "c".repeat(64),
  UAT_PREVIEW_GUARD_SECRET: "h".repeat(32),
  UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED: "true",
  UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS: "testing-environment,production-environment",
  UAT_PREVIEW_FORBIDDEN_SERVICE_IDS:
    "testing-web,production-web,testing-database,production-database",
  UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES: "tetamu_testing,tetamu_production",
  UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS:
    `${"d".repeat(64)},${"e".repeat(64)}`,
  UAT_PREVIEW_LOCAL_SIMULATION: "false",
  UAT_PREVIEW_ACCESS_ENABLED: "true",
  UAT_PREVIEW_ACCESS_USERNAME: "uat-reviewer",
  UAT_PREVIEW_ACCESS_PASSWORD: "x".repeat(32),
  UAT_PREVIEW_OTP_INTERCEPT_ENABLED: "true",
  UAT_PREVIEW_OTP_HMAC_SEED: "o".repeat(32),
  UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST: "+60119992001,+60119992002",
  EMPLOYEE_AUTH_SECRET: "e".repeat(32),
  EMPLOYEE_OTP_SEND_MODE: "provider",
  OTP_PROVIDER: "uat_preview_intercept",
  OTP_CHANNEL: "intercept",
  EMPLOYEE_OTP_MOCK_CODE: "",
  EMPLOYEE_OTP_MOCK_ACCESS_KEY: "",
  SMS123_API_KEY: "",
  TWILIO_ACCOUNT_SID: "",
  TWILIO_VERIFY_SERVICE_SID: "",
  TWILIO_API_KEY_SID: "",
  TWILIO_API_KEY_SECRET: "",
  TWILIO_AUTH_TOKEN: "",
  AI_GLOBAL_ENABLED: "false",
  AI_PROVIDER: "mock",
  OPENAI_API_KEY: "",
  WHATSAPP_SEND_MODE: "disabled",
  WHATSAPP_CONNECTOR_URL: "",
  WHATSAPP_CONNECTOR_SECRET: "",
  WHATSAPP_ACCESS_TOKEN: "",
  WHATSAPP_WEBHOOK_SECRET: "",
  EMAIL_SEND_MODE: "disabled",
  RESEND_API_KEY: "",
  SMTP_PASSWORD: "",
  PAYMENT_EXECUTION_ENABLED: "false",
  BANK_PAYMENT_EXECUTION_ENABLED: "false",
  GOVERNMENT_SUBMISSION_ENABLED: "false",
  PCB_PRODUCTION_ENABLED: "false",
  OFFICIAL_EXPORT_ELIGIBLE: "false",
  PRODUCTION_ELIGIBLE: "false",
  WEBHOOK_DELIVERY_ENABLED: "false",
  PRODUCTION_STORAGE_ENABLED: "false",
  CRON_ENABLED: "false",
  NOTIFICATION_WORKER_ENABLED: "false",
  ANALYTICS_WORKER_ENABLED: "false",
  WHATSAPP_WORKER_ENABLED: "false",
};

test("complete production-grade Preview web contract passes", () => {
  const result = validate("web", previewBase);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /uat-preview/);
});

test("Preview requires every immutable, identity, access, OTP, and fixture field", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["NODE_ENV", "development", "NODE_ENV"],
    ["APP_RELEASE_SHA", "abcdef1", "APP_RELEASE_SHA"],
    ["APP_RELEASE_SOURCE_DIGEST", "short", "APP_RELEASE_SOURCE_DIGEST"],
    ["SESSION_SECRET", "short", "SESSION_SECRET"],
    ["MFA_ACTIVE_KEY_VERSION", "", "MFA_ACTIVE_KEY_VERSION"],
    ["MFA_ENCRYPTION_KEYS", "", "MFA_ENCRYPTION_KEYS"],
    ["PAYROLL_PAYMENT_ACTIVE_KEY_VERSION", "", "PAYROLL_PAYMENT_ACTIVE_KEY_VERSION"],
    ["PAYROLL_PAYMENT_ENCRYPTION_KEYS", "", "PAYROLL_PAYMENT_ENCRYPTION_KEYS"],
    ["PAYROLL_PAYMENT_FINGERPRINT_KEY", "short", "PAYROLL_PAYMENT_FINGERPRINT_KEY"],
    ["UAT_PREVIEW_EXPECTED_PROJECT_ID", "wrong", "PROJECT_ID"],
    ["UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID", "wrong", "ENVIRONMENT_ID"],
    ["UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID", "wrong", "WEB_SERVICE_ID"],
    ["UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID", "wrong", "DATABASE_SERVICE_ID"],
    ["UAT_PREVIEW_DATABASE_NAME", "wrong", "DATABASE_NAME"],
    ["UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET", "short", "FINGERPRINT_SECRET"],
    ["UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT", "short", "DATABASE_FINGERPRINT"],
    ["UAT_PREVIEW_GUARD_SECRET", "short", "GUARD_SECRET"],
    ["UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED", "false", "SYNTHETIC_FIXTURE"],
    ["UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS", "", "DENYLIST"],
    ["UAT_PREVIEW_FORBIDDEN_SERVICE_IDS", "", "DENYLIST"],
    ["UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES", "", "DENYLIST"],
    ["UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS", "", "DENYLIST"],
    ["UAT_PREVIEW_ACCESS_ENABLED", "false", "ACCESS"],
    ["UAT_PREVIEW_ACCESS_USERNAME", "", "ACCESS"],
    ["UAT_PREVIEW_ACCESS_PASSWORD", "short", "ACCESS"],
    ["UAT_PREVIEW_OTP_INTERCEPT_ENABLED", "false", "OTP"],
    ["UAT_PREVIEW_OTP_HMAC_SEED", "short", "OTP"],
    ["UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST", "", "PHONE_ALLOWLIST"],
    ["EMPLOYEE_AUTH_SECRET", "short", "EMPLOYEE_AUTH_SECRET"],
    ["OTP_PROVIDER", "sms123", "OTP_PROVIDER"],
    ["OTP_CHANNEL", "sms", "OTP_CHANNEL"],
  ];
  for (const [name, value, message] of cases) {
    const result = validate("web", { ...previewBase, [name]: value });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(message, "i"), name);
  }
});

test("Preview rejects all real providers, outbound paths, workers, and restricted actions", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["SMS123_API_KEY", "real-sms-key-that-must-not-run", "provider"],
    ["TWILIO_AUTH_TOKEN", "real-twilio-token-that-must-not-run", "provider"],
    ["WHATSAPP_SEND_MODE", "live", "WHATSAPP"],
    ["WHATSAPP_CONNECTOR_SECRET", "real-whatsapp-secret", "WHATSAPP"],
    ["EMAIL_SEND_MODE", "live", "EMAIL"],
    ["RESEND_API_KEY", "real-email-provider-key", "EMAIL"],
    ["PAYMENT_EXECUTION_ENABLED", "true", "PAYMENT"],
    ["BANK_PAYMENT_EXECUTION_ENABLED", "true", "BANK"],
    ["GOVERNMENT_SUBMISSION_ENABLED", "true", "GOVERNMENT"],
    ["PCB_PRODUCTION_ENABLED", "true", "PCB"],
    ["OFFICIAL_EXPORT_ELIGIBLE", "true", "OFFICIAL_EXPORT"],
    ["PRODUCTION_ELIGIBLE", "true", "PRODUCTION_ELIGIBLE"],
    ["WEBHOOK_DELIVERY_ENABLED", "true", "WEBHOOK"],
    ["PRODUCTION_STORAGE_ENABLED", "true", "STORAGE"],
    ["CRON_ENABLED", "true", "CRON"],
    ["NOTIFICATION_WORKER_ENABLED", "true", "WORKER"],
    ["ANALYTICS_WORKER_ENABLED", "true", "WORKER"],
    ["WHATSAPP_WORKER_ENABLED", "true", "WORKER"],
  ];
  for (const [name, value, message] of cases) {
    const result = validate("web", { ...previewBase, [name]: value });
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, new RegExp(message, "i"), name);
  }
});

test("Preview allows web only and rejects every worker startup scope", () => {
  for (const scope of ["notification", "analytics", "whatsapp"]) {
    const result = validate(scope, previewBase);
    assert.notEqual(result.status, 0, scope);
    assert.match(result.stderr, /web scope only/i, scope);
  }
});

test("Preview localhost simulation is explicit and impossible in a Railway deployment", () => {
  const databaseUrl =
    "postgresql://preview:preview@127.0.0.1:5432/tetamu_uat_preview";
  const local = validate("web", {
    ...previewBase,
    DATABASE_URL: databaseUrl,
    RAILWAY_DEPLOYMENT_ID: "",
    UAT_PREVIEW_LOCAL_SIMULATION: "true",
  });
  assert.equal(local.status, 0, local.stderr);

  const deployed = validate("web", {
    ...previewBase,
    DATABASE_URL: databaseUrl,
    UAT_PREVIEW_LOCAL_SIMULATION: "true",
  });
  assert.notEqual(deployed.status, 0);
  assert.match(deployed.stderr, /LOCAL_SIMULATION/i);
});

test("unknown runtime is rejected and validator output never exposes secrets", () => {
  const unknown = validate("web", {
    ...previewBase,
    APP_ENVIRONMENT: "preview-ish",
  });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /runtime environment/i);

  const mismatch = validate("web", {
    ...previewBase,
    UAT_PREVIEW_EXPECTED_PROJECT_ID: "secret-wrong-project",
  });
  const output = `${mismatch.stdout}\n${mismatch.stderr}`;
  for (const sensitive of [
    previewBase.DATABASE_URL,
    previewBase.UAT_PREVIEW_ACCESS_PASSWORD,
    previewBase.UAT_PREVIEW_OTP_HMAC_SEED,
    previewBase.UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET,
  ]) {
    assert.equal(output.includes(sensitive), false);
  }
});

function validate(scope: string, env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["scripts/validate-release-environment.mjs", scope],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
}
