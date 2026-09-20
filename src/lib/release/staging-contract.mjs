// Deployment policy only: staging still runs APP_ENVIRONMENT=production.
// This manifest must be populated from reviewed infrastructure identities, never
// copied from a protected environment or inferred from a display name.
const scopes = ["web", "staff", "analytics", "notification", "whatsapp", "monitor"];
const reject = (code) => { throw new Error(`PRODUCTION_RC_STAGING_${code}`); };
const text = (value) => typeof value === "string" && value.trim().length > 0;
const hex = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const list = (value, check = text) => Array.isArray(value) && value.length > 0 && value.every(check);

export function readStagingPolicy(env, scope, databaseFingerprint) {
  if (env.APP_DEPLOYMENT_PROFILE !== "rc-staging" || env.APP_ENVIRONMENT !== "production" || env.NODE_ENV !== "production" ||
      env.RAILWAY_ENVIRONMENT_NAME !== "Production-RC-Staging-20260920") reject("PROFILE_MISMATCH");
  let policy;
  try { policy = JSON.parse(env.RC_STAGING_IDENTITY); } catch { reject("IDENTITY_REQUIRED"); }
  if (!policy || !text(policy.projectId) || !text(policy.environmentId) || !text(policy.databaseServiceId) ||
      !text(policy.databaseName) || !hex(policy.databaseFingerprint) || !policy.services ||
      Array.isArray(policy.services) || Object.keys(policy.services).length !== scopes.length ||
      !scopes.every((name) => text(policy.services[name])) || !scopes.includes(scope) ||
      new Set([...scopes.map((name) => policy.services[name]), policy.databaseServiceId]).size !== 7) reject("IDENTITY_INVALID");
  for (const [actual, expected] of [
    [env.RAILWAY_PROJECT_ID, policy.projectId], [env.RAILWAY_ENVIRONMENT_ID, policy.environmentId],
    [env.RAILWAY_SERVICE_ID, policy.services[scope]], [env.RAILWAY_DATABASE_SERVICE_ID, policy.databaseServiceId],
    [env.PRODUCTION_DATABASE_NAME, policy.databaseName], [databaseFingerprint, policy.databaseFingerprint],
  ]) if (actual !== expected) reject("IDENTITY_MISMATCH");

  const secretFingerprints = [];
  for (const category of ["testing", "preview", "production"]) {
    const denied = policy.protected?.[category];
    if (!denied || !text(denied.environmentId) || !list(denied.serviceIds) || !list(denied.databaseNames) ||
        !list(denied.databaseFingerprints, hex) || !list(denied.secretFingerprints, hex)) reject("PROTECTED_INVENTORY_REQUIRED");
    if (denied.environmentId === policy.environmentId ||
        [...Object.values(policy.services), policy.databaseServiceId].some((id) => denied.serviceIds.includes(id)) ||
        denied.databaseNames.includes(policy.databaseName) || denied.databaseFingerprints.includes(databaseFingerprint)) reject("PROTECTED_IDENTITY_DENIED");
    secretFingerprints.push(...denied.secretFingerprints);
  }
  if (env.OTP_PROVIDER !== "rc_staging_intercept" || env.OTP_CHANNEL !== "intercept" || env.EMPLOYEE_OTP_SEND_MODE !== "provider") reject("OTP_INTERCEPT_REQUIRED");
  if (!text(env.RC_STAGING_OTP_HMAC_SEED) || Buffer.byteLength(env.RC_STAGING_OTP_HMAC_SEED, "utf8") < 32) reject("OTP_SEED_REQUIRED");
  const phones = (env.RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST ?? "").split(",").map((entry) => entry.trim());
  if (phones.length > 100 || !phones.every((entry) => /^\+[1-9]\d{7,14}$/.test(entry)) || new Set(phones).size !== phones.length) reject("SYNTHETIC_ALLOWLIST_INVALID");
  for (const name of ["AI_GLOBAL_ENABLED", "PRODUCTION_ELIGIBLE"]) if (env[name] !== "false") reject("LIVE_FEATURE_FORBIDDEN");
  for (const name of ["WHATSAPP_SEND_MODE", "EMAIL_SEND_MODE"]) if (env[name] !== "disabled") reject("LIVE_COMMUNICATION_FORBIDDEN");
  for (const name of ["SMS123_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_VERIFY_SERVICE_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_AUTH_TOKEN",
    "EMPLOYEE_OTP_MOCK_CODE", "EMPLOYEE_OTP_MOCK_ACCESS_KEY", "UAT_PREVIEW_OTP_HMAC_SEED", "OPENAI_API_KEY",
    "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_API_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_CONNECTOR_URL", "WHATSAPP_CONNECTOR_SECRET", "WHATSAPP_CONNECTOR_API_SECRET", "WHATSAPP_WEBHOOK_SECRET", "RESEND_API_KEY", "SENDGRID_API_KEY", "SMTP_PASSWORD"])
    if (env[name]?.trim()) reject("LIVE_OR_MOCK_CREDENTIAL_FORBIDDEN");
  return { secretFingerprints, syntheticPhoneAllowlist: phones };
}
