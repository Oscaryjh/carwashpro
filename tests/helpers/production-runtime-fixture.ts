import { createHash, randomBytes } from "node:crypto";

export function productionRuntimeFixture(scope = "web") {
  const secret = () => randomBytes(48).toString("base64url");
  const attestation: { version?: number; mode?: string; commitSha: string; tree: string; sourceDigest: string; lockfileHash: string; buildContextDigest?: string } = { commitSha: "a".repeat(40), tree: "b".repeat(40), sourceDigest: "c".repeat(64), lockfileHash: "d".repeat(64) };
  const env: Record<string, string> = {
    NODE_ENV: "production", APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    APP_RELEASE_SHA: attestation.commitSha, RAILWAY_GIT_COMMIT_SHA: attestation.commitSha,
    APP_RELEASE_TREE: attestation.tree, APP_RELEASE_SOURCE_DIGEST: attestation.sourceDigest,
    RAILWAY_PROJECT_ID: "synthetic-project", RAILWAY_ENVIRONMENT_ID: "synthetic-production",
    RAILWAY_SERVICE_ID: `synthetic-${scope}`, RAILWAY_DEPLOYMENT_ID: "synthetic-deployment",
    RAILWAY_DATABASE_SERVICE_ID: "synthetic-sg-db", RAILWAY_REPLICA_REGION: "asia-southeast1",
    PRODUCTION_EXPECTED_PROJECT_ID: "synthetic-project", PRODUCTION_EXPECTED_ENVIRONMENT_ID: "synthetic-production",
    PRODUCTION_EXPECTED_SERVICE_ID: `synthetic-${scope}`, PRODUCTION_EXPECTED_DATABASE_SERVICE_ID: "synthetic-sg-db",
    PRODUCTION_DATABASE_REGION: "asia-southeast1", PRODUCTION_DATABASE_NAME: "synthetic_rc",
    DATABASE_URL: "postgresql://synthetic:unused@synthetic-db.invalid:5432/synthetic_rc?sslmode=require",
    SESSION_SECRET: secret(), EMPLOYEE_AUTH_SECRET: secret(), TETAMU_MFA_ENABLED: "true",
    MFA_ACTIVE_KEY_VERSION: "v1", MFA_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
    PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "v1", PAYROLL_PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
    PAYROLL_PAYMENT_FINGERPRINT_KEY: secret(), AUTH_TRUST_PROXY_HOPS: "1", AUTH_PROXY_CONTRACT_REFERENCE: "synthetic-reviewed-proxy-chain",
    OTP_PROVIDER: "sms123", OTP_CHANNEL: "sms", EMPLOYEE_OTP_SEND_MODE: "provider", SMS123_API_KEY: secret(),
    AI_GLOBAL_ENABLED: "false", WHATSAPP_SEND_MODE: "disabled", EMAIL_SEND_MODE: "disabled",
    OPS_ALERT_WEBHOOK_URL: "https://synthetic-alert.invalid/receiver", OPS_ALERT_OWNER: "synthetic-oncall",
    OPS_DESKTOP_HEALTH_URL: "https://synthetic-web.invalid/api/health", OPS_STAFF_PROBE_URL: "https://synthetic-staff.invalid/api/health",
    APP_SERVICE_SCOPE: scope, WORKER_SINGLETON_ID: `synthetic-${scope}`, WORKER_REPLICA_COUNT: "1",
    PRODUCTION_NONPROD_SECRET_FINGERPRINTS: createHash("sha256").update("unrelated-synthetic-nonprod-secret").digest("hex"),
    PAYMENT_EXECUTION_ENABLED: "false", BANK_PAYMENT_EXECUTION_ENABLED: "false", PAYMENT_EXPORT_ENABLED: "false",
    GOVERNMENT_SUBMISSION_ENABLED: "false", PCB_PRODUCTION_ENABLED: "false", OFFICIAL_EXPORT_ELIGIBLE: "false",
  };
  env.PRODUCTION_EXPECTED_DATABASE_FINGERPRINT = createHash("sha256").update(JSON.stringify({ host: "synthetic-db.invalid", port: "5432", database: "synthetic_rc", user: "synthetic", service: "synthetic-sg-db" })).digest("hex");
  return { env, attestation };
}
