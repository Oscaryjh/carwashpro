import { createHash, randomBytes } from "node:crypto";
import { productionRuntimeFixture } from "./production-runtime-fixture";

export function stagingRuntimeFixture(scope = "web") {
  const fixture = productionRuntimeFixture(scope);
  const { env } = fixture;
  env.APP_DEPLOYMENT_PROFILE = "rc-staging";
  env.OPS_ALERT_WEBHOOK_BEARER_TOKEN = randomBytes(48).toString("base64url");
  env.RAILWAY_ENVIRONMENT_NAME = "Production-RC-Staging-20260920";
  env.RAILWAY_ENVIRONMENT_ID = env.PRODUCTION_EXPECTED_ENVIRONMENT_ID = "synthetic-staging";
  const databaseUrl = new URL(env.DATABASE_URL); databaseUrl.password = randomBytes(32).toString("hex"); env.DATABASE_URL = databaseUrl.toString();
  const protectedIdentity = (name: string) => ({
    environmentId: `protected-${name}`, serviceIds: [`protected-${name}-web`, `protected-${name}-db`],
    databaseNames: [`protected_${name}`], databaseFingerprints: [createHash("sha256").update(name).digest("hex")],
    secretFingerprints: [createHash("sha256").update(`protected-${name}-secret`).digest("hex")],
  });
  env.RC_STAGING_IDENTITY = JSON.stringify({
    projectId: env.RAILWAY_PROJECT_ID, environmentId: env.RAILWAY_ENVIRONMENT_ID,
    services: Object.fromEntries(["web", "staff", "analytics", "notification", "whatsapp", "monitor"].map((name) => [name, `synthetic-${name}`])),
    databaseServiceId: env.RAILWAY_DATABASE_SERVICE_ID, databaseName: env.PRODUCTION_DATABASE_NAME,
    databaseFingerprint: env.PRODUCTION_EXPECTED_DATABASE_FINGERPRINT,
    protected: { testing: protectedIdentity("testing"), preview: protectedIdentity("preview"), production: protectedIdentity("production") },
  });
  env.OTP_PROVIDER = "rc_staging_intercept";
  env.OTP_CHANNEL = "intercept";
  delete env.SMS123_API_KEY;
  env.RC_STAGING_OTP_HMAC_SEED = randomBytes(48).toString("base64url");
  env.RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST = "+60119992001";
  env.PRODUCTION_ELIGIBLE = "false";
  return { ...fixture, env: env as Record<string, string> & { NODE_ENV: "production" } };
}
