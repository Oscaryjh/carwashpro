import {
  isProductionGradeEnvironment,
  parseRuntimeEnvironment,
} from "../src/lib/release/environment-contract.mjs";

const scope = process.argv[2] ?? "web";
const VALID_SCOPES = new Set(["web", "notification", "analytics", "whatsapp"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

if (!VALID_SCOPES.has(scope)) {
  fail(`Unknown release validation scope: ${scope}`);
}

let environment;
try {
  environment = parseRuntimeEnvironment(process.env);
} catch {
  fail("Runtime environment is invalid or missing for this deployment.");
}

if (isProductionGradeEnvironment(environment)) {
  requireHexDigest("APP_RELEASE_SOURCE_DIGEST", environment);
  requireValue("SESSION_SECRET", 32, environment);
  requireValue("MFA_ACTIVE_KEY_VERSION", 1, environment);
  requireValue("MFA_ENCRYPTION_KEYS", 10, environment);
  requireValue("PAYROLL_PAYMENT_ACTIVE_KEY_VERSION", 1, environment);
  requireValue("PAYROLL_PAYMENT_ENCRYPTION_KEYS", 10, environment);
  requireValue("PAYROLL_PAYMENT_FINGERPRINT_KEY", 32, environment);
}

if (environment === "production") {
  requireValue("APP_RELEASE_SHA", 7, environment);
  requireRemoteDatabaseUrl("Production");
  validateProductionProviders();
}

if (environment === "uat-preview") {
  validateUatPreview();
}

console.log(`[release-env] ${scope} environment contract valid for ${environment}.`);

function validateProductionProviders() {
  const otpProvider = process.env.OTP_PROVIDER ?? process.env.EMPLOYEE_OTP_SEND_MODE;
  if (otpProvider === "mock" || process.env.EMPLOYEE_OTP_MOCK_CODE) {
    fail("Production Employee OTP mock mode/code is forbidden.");
  }
  if (!new Set(["twilio_verify", "sms123"]).has(otpProvider) || process.env.OTP_CHANNEL !== "sms") {
    fail('Production Staff OTP requires OTP_PROVIDER="twilio_verify" or "sms123", with OTP_CHANNEL="sms".');
  }
  if (otpProvider === "twilio_verify") {
    requirePattern("TWILIO_ACCOUNT_SID", /^AC[0-9a-f]{32}$/i, "production");
    requirePattern("TWILIO_VERIFY_SERVICE_SID", /^VA[0-9a-f]{32}$/i, "production");
    const hasTwilioApiKey =
      /^SK[0-9a-f]{32}$/i.test(value("TWILIO_API_KEY_SID")) &&
      value("TWILIO_API_KEY_SECRET").length >= 20;
    const hasTwilioAuthToken = value("TWILIO_AUTH_TOKEN").length >= 20;
    if (!hasTwilioApiKey && !hasTwilioAuthToken) {
      fail("Production Twilio Verify credentials are required.");
    }
  }
  if (otpProvider === "sms123") {
    requireValue("SMS123_API_KEY", 16, "production");
  }

  const aiEnabled = process.env.AI_GLOBAL_ENABLED !== "false";
  if (aiEnabled && process.env.AI_PROVIDER !== "openai") {
    fail('Production AI must use AI_PROVIDER="openai" or AI_GLOBAL_ENABLED=false.');
  }
  if (aiEnabled) requireValue("OPENAI_API_KEY", 20, "production");

  if ((scope === "notification" || scope === "whatsapp") && process.env.WHATSAPP_SEND_MODE !== "live") {
    fail('Production WhatsApp workers require WHATSAPP_SEND_MODE="live".');
  }
}

function validateUatPreview() {
  if (scope !== "web") fail("UAT Preview supports web scope only.");
  requireExact("NODE_ENV", "production", "NODE_ENV must be production for UAT Preview.");
  requirePattern("APP_RELEASE_SHA", /^[a-f0-9]{40}$/i, "UAT Preview");

  const database = requirePreviewDatabaseUrl();
  const localSimulation = value("UAT_PREVIEW_LOCAL_SIMULATION") === "true";
  if (LOOPBACK_HOSTS.has(database.hostname)) {
    if (!localSimulation || value("RAILWAY_DEPLOYMENT_ID")) {
      fail("UAT_PREVIEW_LOCAL_SIMULATION is required only for a non-deployed loopback database.");
    }
  } else {
    if (localSimulation) {
      fail("UAT_PREVIEW_LOCAL_SIMULATION must be false for a remote database.");
    }
    requireValue("RAILWAY_DEPLOYMENT_ID", 1, "UAT Preview");
  }

  const forbiddenEnvironmentIds = requireCsv("UAT_PREVIEW_FORBIDDEN_ENVIRONMENT_IDS");
  const forbiddenServiceIds = requireCsv("UAT_PREVIEW_FORBIDDEN_SERVICE_IDS");
  const forbiddenDatabaseNames = requireCsv("UAT_PREVIEW_FORBIDDEN_DATABASE_NAMES");
  const forbiddenFingerprints = requireCsv("UAT_PREVIEW_FORBIDDEN_DATABASE_FINGERPRINTS");
  if ([...forbiddenFingerprints].some((entry) => !/^[a-f0-9]{64}$/i.test(entry))) {
    fail("UAT Preview DATABASE_FINGERPRINT DENYLIST must contain only SHA-256 digests.");
  }

  const environmentId = value("RAILWAY_ENVIRONMENT_ID");
  const webServiceId = value("RAILWAY_SERVICE_ID");
  const databaseServiceId = value("RAILWAY_DATABASE_SERVICE_ID");
  const expectedFingerprint = value("UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT").toLowerCase();

  // Protected Testing/Production identities take precedence over Preview allowlists.
  if (forbiddenEnvironmentIds.has(environmentId)) {
    fail("UAT Preview ENVIRONMENT_ID is present in the protected DENYLIST.");
  }
  if (forbiddenServiceIds.has(webServiceId) || forbiddenServiceIds.has(databaseServiceId)) {
    fail("UAT Preview SERVICE_ID is present in the protected DENYLIST.");
  }
  if (forbiddenDatabaseNames.has(database.databaseName)) {
    fail("UAT Preview DATABASE_NAME is present in the protected DENYLIST.");
  }
  if (forbiddenFingerprints.has(expectedFingerprint)) {
    fail("UAT Preview DATABASE_FINGERPRINT is present in the protected DENYLIST.");
  }

  requireIdentity("RAILWAY_PROJECT_ID", "UAT_PREVIEW_EXPECTED_PROJECT_ID", "PROJECT_ID");
  requireIdentity("RAILWAY_ENVIRONMENT_ID", "UAT_PREVIEW_EXPECTED_ENVIRONMENT_ID", "ENVIRONMENT_ID");
  requireIdentity("RAILWAY_SERVICE_ID", "UAT_PREVIEW_EXPECTED_WEB_SERVICE_ID", "WEB_SERVICE_ID");
  requireIdentity(
    "RAILWAY_DATABASE_SERVICE_ID",
    "UAT_PREVIEW_EXPECTED_DATABASE_SERVICE_ID",
    "DATABASE_SERVICE_ID",
  );
  if (!database.databaseName || database.databaseName !== value("UAT_PREVIEW_DATABASE_NAME")) {
    fail("UAT Preview DATABASE_NAME identity mismatch.");
  }
  requireValue("UAT_PREVIEW_DATABASE_FINGERPRINT_SECRET", 32, "UAT Preview FINGERPRINT_SECRET");
  requirePattern(
    "UAT_PREVIEW_EXPECTED_DATABASE_FINGERPRINT",
    /^[a-f0-9]{64}$/i,
    "UAT Preview DATABASE_FINGERPRINT",
  );
  requireValue("UAT_PREVIEW_GUARD_SECRET", 32, "UAT Preview GUARD_SECRET");
  requireExact(
    "UAT_PREVIEW_SYNTHETIC_FIXTURE_ENABLED",
    "true",
    "UAT Preview SYNTHETIC_FIXTURE must be explicitly enabled.",
  );

  requireExact("UAT_PREVIEW_ACCESS_ENABLED", "true", "UAT Preview ACCESS gate must be enabled.");
  if (value("UAT_PREVIEW_ACCESS_USERNAME").length < 3) {
    fail("UAT Preview ACCESS username is required.");
  }
  if (byteLength(value("UAT_PREVIEW_ACCESS_PASSWORD")) < 32) {
    fail("UAT Preview ACCESS password must be at least 32 bytes.");
  }

  requireExact(
    "UAT_PREVIEW_OTP_INTERCEPT_ENABLED",
    "true",
    "UAT Preview OTP interceptor must be enabled.",
  );
  requireValue("UAT_PREVIEW_OTP_HMAC_SEED", 32, "UAT Preview OTP");
  if (requireCsv("UAT_PREVIEW_SYNTHETIC_PHONE_ALLOWLIST").size === 0) {
    fail("UAT Preview PHONE_ALLOWLIST is required.");
  }
  requireValue("EMPLOYEE_AUTH_SECRET", 32, "UAT Preview");
  requireExact("EMPLOYEE_OTP_SEND_MODE", "provider", "UAT Preview OTP send mode must use provider routing.");
  requireExact("OTP_PROVIDER", "uat_preview_intercept", "UAT Preview OTP_PROVIDER must be isolated.");
  requireExact("OTP_CHANNEL", "intercept", "UAT Preview OTP_CHANNEL must be intercept.");

  requireBlank(
    [
      "EMPLOYEE_OTP_MOCK_CODE",
      "EMPLOYEE_OTP_MOCK_ACCESS_KEY",
      "SMS123_API_KEY",
      "TWILIO_ACCOUNT_SID",
      "TWILIO_VERIFY_SERVICE_SID",
      "TWILIO_API_KEY_SID",
      "TWILIO_API_KEY_SECRET",
      "TWILIO_AUTH_TOKEN",
    ],
    "Real SMS, Twilio, and development OTP provider configuration is forbidden in UAT Preview.",
  );

  requireExact("AI_GLOBAL_ENABLED", "false", "UAT Preview AI_GLOBAL_ENABLED must be false.");
  requireBlank(["OPENAI_API_KEY"], "UAT Preview AI provider credentials are forbidden.");
  requireExact("WHATSAPP_SEND_MODE", "disabled", "UAT Preview WHATSAPP sending must be disabled.");
  requireBlank(
    ["WHATSAPP_CONNECTOR_URL", "WHATSAPP_CONNECTOR_SECRET", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WEBHOOK_SECRET"],
    "UAT Preview WHATSAPP provider credentials are forbidden.",
  );
  requireExact("EMAIL_SEND_MODE", "disabled", "UAT Preview EMAIL sending must be disabled.");
  requireBlank(["RESEND_API_KEY", "SMTP_PASSWORD"], "UAT Preview EMAIL provider credentials are forbidden.");

  for (const name of [
    "PAYMENT_EXECUTION_ENABLED",
    "BANK_PAYMENT_EXECUTION_ENABLED",
    "GOVERNMENT_SUBMISSION_ENABLED",
    "PCB_PRODUCTION_ENABLED",
    "OFFICIAL_EXPORT_ELIGIBLE",
    "PRODUCTION_ELIGIBLE",
    "WEBHOOK_DELIVERY_ENABLED",
    "PRODUCTION_STORAGE_ENABLED",
    "CRON_ENABLED",
    "NOTIFICATION_WORKER_ENABLED",
    "ANALYTICS_WORKER_ENABLED",
    "WHATSAPP_WORKER_ENABLED",
  ]) {
    requireExact(name, "false", `${name} must be false in UAT Preview.`);
  }
}

function requireValue(name, minimumLength, environmentName) {
  if (value(name).length < minimumLength) fail(`${name} is required for ${environmentName}.`);
}

function requireHexDigest(name, environmentName) {
  if (!/^[a-f0-9]{64}$/i.test(value(name))) {
    fail(`${name} must be a 64-character SHA-256 digest in ${environmentName}.`);
  }
}

function requirePattern(name, pattern, environmentName) {
  if (!pattern.test(value(name))) fail(`${name} is invalid or missing in ${environmentName}.`);
}

function requireExact(name, expected, message) {
  if (value(name) !== expected) fail(message);
}

function requireBlank(names, message) {
  if (names.some((name) => Boolean(value(name)))) fail(message);
}

function requireCsv(name) {
  const entries = new Set(
    value(name)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  if (entries.size === 0) fail(`UAT Preview DENYLIST or allowlist variable ${name} is required.`);
  return entries;
}

function requireIdentity(actualName, expectedName, label) {
  const actual = value(actualName);
  const expected = value(expectedName);
  if (!actual || !expected || actual !== expected) fail(`UAT Preview ${label} identity mismatch.`);
}

function requireRemoteDatabaseUrl(environmentName) {
  const parsed = parseDatabaseUrl();
  if (LOOPBACK_HOSTS.has(parsed.hostname)) fail(`${environmentName} DATABASE_URL cannot target Localhost.`);
  return parsed;
}

function requirePreviewDatabaseUrl() {
  const parsed = parseDatabaseUrl();
  let databaseName;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    fail("UAT Preview DATABASE_URL database name is invalid.");
  }
  if (!databaseName || !parsed.username || !parsed.hostname) {
    fail("UAT Preview DATABASE_URL must include database, user, and host identity.");
  }
  return { hostname: parsed.hostname.toLowerCase(), databaseName };
}

function parseDatabaseUrl() {
  let parsed;
  try {
    parsed = new URL(value("DATABASE_URL"));
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    fail("DATABASE_URL must use PostgreSQL.");
  }
  return parsed;
}

function value(name) {
  return process.env[name]?.trim() ?? "";
}

function byteLength(input) {
  return new TextEncoder().encode(input).byteLength;
}

function fail(message) {
  console.error(`[release-env] ${message}`);
  process.exit(1);
}
