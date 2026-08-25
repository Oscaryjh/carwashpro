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

  const otpProvider = process.env.OTP_PROVIDER ?? process.env.EMPLOYEE_OTP_SEND_MODE;
  if (otpProvider === "mock" || process.env.EMPLOYEE_OTP_MOCK_CODE) {
    fail("Production Employee OTP mock mode/code is forbidden.");
  }
  if (!new Set(["twilio_verify", "sms123"]).has(otpProvider) || process.env.OTP_CHANNEL !== "sms") {
    fail('Production Staff OTP requires OTP_PROVIDER="twilio_verify" or "sms123", with OTP_CHANNEL="sms".');
  }
  if (otpProvider === "twilio_verify") {
    requirePattern("TWILIO_ACCOUNT_SID", /^AC[0-9a-f]{32}$/i);
    requirePattern("TWILIO_VERIFY_SERVICE_SID", /^VA[0-9a-f]{32}$/i);
    const hasTwilioApiKey =
      /^SK[0-9a-f]{32}$/i.test(process.env.TWILIO_API_KEY_SID?.trim() ?? "") &&
      (process.env.TWILIO_API_KEY_SECRET?.trim().length ?? 0) >= 20;
    const hasTwilioAuthToken = (process.env.TWILIO_AUTH_TOKEN?.trim().length ?? 0) >= 20;
    if (!hasTwilioApiKey && !hasTwilioAuthToken) {
      fail("Production Twilio Verify credentials are required.");
    }
  }
  if (otpProvider === "sms123") {
    requireValue("SMS123_API_KEY", 16);
  }

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

function requirePattern(name, pattern) {
  const value = process.env[name]?.trim() ?? "";
  if (!pattern.test(value)) fail(`${name} is invalid or missing in Production.`);
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

function fail(message) {
  console.error(`[release-env] ${message}`);
  process.exit(1);
}
