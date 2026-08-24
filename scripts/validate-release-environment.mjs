const scope = process.argv[2] ?? "web";
const explicit = process.env.APP_ENVIRONMENT?.trim().toLowerCase();
const railway = process.env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase();
const environment = explicit || railway || process.env.NODE_ENV?.trim().toLowerCase() || "development";

if (!new Set(["web", "notification", "analytics", "whatsapp"]).has(scope)) {
  fail(`Unknown release validation scope: ${scope}`);
}

if (environment === "production") {
  requireValue("APP_RELEASE_SHA", 7);
  requireHexDigest("APP_RELEASE_SOURCE_DIGEST");
  requireDatabaseUrl();
  requireValue("SESSION_SECRET", 32);
  requireValue("MFA_ACTIVE_KEY_VERSION", 1);
  requireValue("MFA_ENCRYPTION_KEYS", 10);
  requireValue("PAYROLL_PAYMENT_ACTIVE_KEY_VERSION", 1);
  requireValue("PAYROLL_PAYMENT_ENCRYPTION_KEYS", 10);
  requireValue("PAYROLL_PAYMENT_FINGERPRINT_KEY", 32);

  const otpProvider = process.env.SMS_PROVIDER ?? process.env.OTP_PROVIDER ?? process.env.EMPLOYEE_OTP_SEND_MODE;
  if (otpProvider === "mock" || process.env.EMPLOYEE_OTP_MOCK_CODE) {
    fail("Production Employee OTP mock mode/code is forbidden.");
  }
  if (otpProvider !== "sms123" || process.env.OTP_CHANNEL !== "sms") {
    fail('Production Staff OTP requires SMS_PROVIDER="sms123" and OTP_CHANNEL="sms".');
  }
  if (process.env.SMS123_ENABLED?.trim().toLowerCase() === "false") {
    fail("Production SMS123 cannot be disabled.");
  }
  requireValue("SMS123_API_KEY", 8);
  requireHttpsUrl("SMS123_API_BASE_URL");

  const aiEnabled = process.env.AI_GLOBAL_ENABLED !== "false";
  if (aiEnabled && process.env.AI_PROVIDER !== "openai") {
    fail('Production AI must use AI_PROVIDER="openai" or AI_GLOBAL_ENABLED=false.');
  }
  if (aiEnabled) requireValue("OPENAI_API_KEY", 20);

  if ((scope === "notification" || scope === "whatsapp") && process.env.WHATSAPP_SEND_MODE !== "live") {
    fail('Production WhatsApp workers require WHATSAPP_SEND_MODE="live".');
  }
}

console.log(`[release-env] ${scope} environment contract valid for ${environment}.`);

function requireValue(name, minimumLength) {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimumLength) fail(`${name} is required for Production.`);
}

function requireHexDigest(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value)) fail(`${name} must be a 64-character SHA-256 digest in Production.`);
}

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim() ?? "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) fail("DATABASE_URL must use PostgreSQL.");
  if (new Set(["localhost", "127.0.0.1", "::1"]).has(parsed.hostname)) fail("Production DATABASE_URL cannot target Localhost.");
}

function requireHttpsUrl(name) {
  const value = process.env[name]?.trim() ?? "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error("HTTPS required");
  } catch {
    fail(`${name} must be a valid HTTPS URL in Production.`);
  }
}

function fail(message) {
  console.error(`[release-env] ${message}`);
  process.exit(1);
}
