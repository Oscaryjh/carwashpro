import { createHash } from "node:crypto";
import { readStagingPolicy } from "./staging-contract.mjs";

const hex = (value, length) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const reject = (code) => { throw new Error(`PRODUCTION_${code}`); };
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function databaseIdentityFingerprint(env) {
  let url; try { url = new URL(env.DATABASE_URL); } catch { reject("DATABASE_URL_INVALID"); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || !url.hostname || !url.username) reject("DATABASE_URL_INVALID");
  return hash(JSON.stringify({ host: url.hostname.toLowerCase(), port: url.port || "5432", database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), service: env.RAILWAY_DATABASE_SERVICE_ID }));
}

export function validateProductionRuntime(env, scope, attestation) {
  const value = (key) => env[key]?.trim() ?? "";
  const required = (key, minimum = 1) => { if (value(key).length < minimum) reject(`${key}_REQUIRED`); return value(key); };
  const exact = (key, expected) => { if (value(key) !== expected) reject(`${key}_INVALID`); };
  if (!attestation || !hex(attestation.commitSha, 40) || !hex(attestation.tree, 40) || !hex(attestation.sourceDigest, 64) || !hex(attestation.lockfileHash, 64)) reject("BUILD_ATTESTATION_REQUIRED");
  for (const [key, expected] of [["APP_RELEASE_SHA", attestation.commitSha], ["RAILWAY_GIT_COMMIT_SHA", attestation.commitSha], ["APP_RELEASE_TREE", attestation.tree], ["APP_RELEASE_SOURCE_DIGEST", attestation.sourceDigest]]) exact(key, expected);
  exact("NODE_ENV", "production"); exact("APP_ENVIRONMENT", "production");
  const profile = value("APP_DEPLOYMENT_PROFILE") || "production";
  if (!["production", "rc-staging"].includes(profile)) reject("DEPLOYMENT_PROFILE_INVALID");
  const staging = profile === "rc-staging" ? readStagingPolicy(env, scope, databaseIdentityFingerprint(env)) : null;
  if (!staging) {
    exact("RAILWAY_ENVIRONMENT_NAME", "production");
    for (const key of Object.keys(env)) if (key.startsWith("RC_STAGING_") && value(key)) reject("STAGING_CONFIGURATION_FORBIDDEN");
  }
  exact("RAILWAY_REPLICA_REGION", "asia-southeast1"); exact("PRODUCTION_DATABASE_REGION", "asia-southeast1");
  for (const [actual, approved] of [["RAILWAY_PROJECT_ID", "PRODUCTION_EXPECTED_PROJECT_ID"], ["RAILWAY_ENVIRONMENT_ID", "PRODUCTION_EXPECTED_ENVIRONMENT_ID"], ["RAILWAY_SERVICE_ID", "PRODUCTION_EXPECTED_SERVICE_ID"], ["RAILWAY_DATABASE_SERVICE_ID", "PRODUCTION_EXPECTED_DATABASE_SERVICE_ID"]]) exact(actual, required(approved));
  required("RAILWAY_DEPLOYMENT_ID");
  let db; try { db = new URL(value("DATABASE_URL")); } catch { reject("DATABASE_URL_INVALID"); }
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(db.hostname)) reject("REMOTE_DATABASE_REQUIRED");
  if (decodeURIComponent(db.pathname.slice(1)) !== required("PRODUCTION_DATABASE_NAME")) reject("DATABASE_NAME_MISMATCH");
  if (databaseIdentityFingerprint(env) !== required("PRODUCTION_EXPECTED_DATABASE_FINGERPRINT")) reject("DATABASE_FINGERPRINT_MISMATCH");

  const forbidden = required("PRODUCTION_NONPROD_SECRET_FINGERPRINTS").split(",").map((entry) => entry.trim());
  forbidden.push(...(staging?.secretFingerprints ?? []));
  if (forbidden.some((entry) => !hex(entry, 64))) reject("SECRET_DENYLIST_INVALID");
  const secrets = [];
  if (staging) {
    const databasePassword = decodeURIComponent(db.password);
    if (Buffer.byteLength(databasePassword, "utf8") < 32) reject("RC_STAGING_DATABASE_SECRET_REQUIRED");
    secrets.push(required("RC_STAGING_OTP_HMAC_SEED", 32), databasePassword);
  }
  for (const key of ["SESSION_SECRET", "EMPLOYEE_AUTH_SECRET", "PAYROLL_PAYMENT_FINGERPRINT_KEY"]) secrets.push(required(key, 32));
  for (const prefix of ["MFA", "PAYROLL_PAYMENT"]) {
    let keys; try { keys = JSON.parse(required(`${prefix}_ENCRYPTION_KEYS`)); } catch { reject(`${prefix}_KEYRING_INVALID`); }
    if (!keys || Array.isArray(keys) || typeof keys !== "object" || !Object.hasOwn(keys, required(`${prefix}_ACTIVE_KEY_VERSION`))) reject(`${prefix}_KEYRING_INVALID`);
    for (const [version, encoded] of Object.entries(keys)) {
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(version) || typeof encoded !== "string") reject(`${prefix}_KEYRING_INVALID`);
      const key = /^[a-f0-9]{64}$/i.test(encoded) ? Buffer.from(encoded, "hex") : /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ? Buffer.from(encoded, "base64") : Buffer.alloc(0);
      if (key.length !== 32) reject(`${prefix}_KEYRING_INVALID`);
      // Check encoded and decoded representations to prevent encoding-only reuse.
      if (forbidden.includes(hash(key)) || forbidden.includes(hash(encoded))) reject("SECRET_REUSE");
      secrets.push(key);
    }
  }
  if (secrets.some((secret) => forbidden.includes(hash(secret)))) reject("SECRET_REUSE");
  if (new Set(secrets.map(hash)).size !== secrets.length) reject("SECRET_DOMAIN_REUSE");
  exact("TETAMU_MFA_ENABLED", "true");
  if (!/^[0-5]$/.test(value("AUTH_TRUST_PROXY_HOPS"))) reject("AUTH_TRUST_PROXY_HOPS_REQUIRED");
  required("AUTH_PROXY_CONTRACT_REFERENCE");
  if (!staging) {
    if (!["sms123", "twilio_verify"].includes(value("OTP_PROVIDER"))) reject("OTP_PROVIDER_INVALID");
    exact("OTP_CHANNEL", "sms");
    if (!["provider", "sms123", "twilio_verify"].includes(value("EMPLOYEE_OTP_SEND_MODE"))) reject("OTP_SEND_MODE_INVALID");
  }
  for (const key of ["EMPLOYEE_OTP_MOCK_CODE", "EMPLOYEE_OTP_MOCK_ACCESS_KEY", "UAT_PREVIEW_OTP_HMAC_SEED"]) if (value(key)) reject("MOCK_OTP_FORBIDDEN");
  if (value("OTP_PROVIDER") === "sms123") required("SMS123_API_KEY", 16);
  for (const key of ["PAYMENT_EXECUTION_ENABLED", "BANK_PAYMENT_EXECUTION_ENABLED", "PAYMENT_EXPORT_ENABLED", "GOVERNMENT_SUBMISSION_ENABLED", "PCB_PRODUCTION_ENABLED", "OFFICIAL_EXPORT_ELIGIBLE"]) exact(key, "false");
  for (const key of ["OPS_ALERT_WEBHOOK_URL", "OPS_DESKTOP_HEALTH_URL", "OPS_STAFF_PROBE_URL"]) {
    let url; try { url = new URL(required(key)); } catch { reject(`${key}_INVALID`); }
    if (url.protocol !== "https:" || url.username || url.password) reject(`${key}_INVALID`);
  }
  required("OPS_ALERT_OWNER"); exact("APP_SERVICE_SCOPE", scope);
  if (scope !== "web" && scope !== "staff") { required("WORKER_SINGLETON_ID"); exact("WORKER_REPLICA_COUNT", "1"); }
  return { commitSha: attestation.commitSha, tree: attestation.tree, sourceDigest: attestation.sourceDigest };
}
