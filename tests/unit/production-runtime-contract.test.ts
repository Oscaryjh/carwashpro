import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { validateProductionRuntime } from "../../src/lib/release/production-contract.mjs";
import { parseRuntimeEnvironment } from "../../src/lib/release/environment-contract.mjs";
import { isMfaFeatureEnabled } from "../../src/lib/auth/mfa-feature";
import { productionRuntimeFixture } from "../helpers/production-runtime-fixture";

test("production source, Singapore identity, mandatory MFA and SMS123 contract accepts matching attestation", () => {
  const f = productionRuntimeFixture();
  assert.doesNotThrow(() => validateProductionRuntime(f.env, "web", f.attestation));
});

test("production runtime fails closed for missing or conflicting source, identity and protection settings", () => {
  const mutations = [
    ["APP_RELEASE_SHA", "abcdef1"], ["RAILWAY_GIT_COMMIT_SHA", "e".repeat(40)], ["APP_RELEASE_TREE", ""],
    ["APP_RELEASE_SOURCE_DIGEST", "e".repeat(64)], ["PRODUCTION_DATABASE_REGION", "us-west2"],
    ["RAILWAY_REPLICA_REGION", "us-west2"], ["RAILWAY_DATABASE_SERVICE_ID", "other"],
    ["PRODUCTION_EXPECTED_DATABASE_FINGERPRINT", "e".repeat(64)], ["PRODUCTION_DATABASE_NAME", "other"],
    ["SESSION_SECRET", "short"], ["EMPLOYEE_AUTH_SECRET", ""], ["TETAMU_MFA_ENABLED", "false"],
    ["MFA_ENCRYPTION_KEYS", "invalid"], ["PAYROLL_PAYMENT_ENCRYPTION_KEYS", "{}"],
    ["OTP_PROVIDER", "mock"], ["EMPLOYEE_OTP_MOCK_CODE", "000000"], ["AUTH_TRUST_PROXY_HOPS", ""],
    ["AUTH_PROXY_CONTRACT_REFERENCE", ""], ["OPS_ALERT_WEBHOOK_URL", ""], ["OPS_ALERT_OWNER", ""],
    ["APP_SERVICE_SCOPE", "analytics"], ["PRODUCTION_NONPROD_SECRET_FINGERPRINTS", ""],
    ["PAYMENT_EXECUTION_ENABLED", "true"], ["BANK_PAYMENT_EXECUTION_ENABLED", "true"],
    ["PAYMENT_EXPORT_ENABLED", "true"], ["PCB_PRODUCTION_ENABLED", "true"],
    ["GOVERNMENT_SUBMISSION_ENABLED", "true"], ["OFFICIAL_EXPORT_ELIGIBLE", "true"],
  ];
  for (const [name, value] of mutations) {
    const f = productionRuntimeFixture(); f.env[name] = value;
    assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /PRODUCTION_/, name);
  }
  const f = productionRuntimeFixture();
  assert.throws(() => validateProductionRuntime(f.env, "web", null));
  f.env.PRODUCTION_NONPROD_SECRET_FINGERPRINTS = createHash("sha256").update(f.env.SESSION_SECRET).digest("hex");
  assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /SECRET_REUSE/);
});

test("workers require matching source and singleton identity; production cannot downgrade to Testing", () => {
  const f = productionRuntimeFixture("analytics");
  assert.doesNotThrow(() => validateProductionRuntime(f.env, "analytics", f.attestation));
  f.env.WORKER_SINGLETON_ID = "";
  assert.throws(() => validateProductionRuntime(f.env, "analytics", f.attestation));
  assert.throws(() => parseRuntimeEnvironment({ APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "production" }), /CONFLICT/);
  assert.throws(() => parseRuntimeEnvironment({ APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "uat-preview" }), /CONFLICT/);
});

test("production never disables MFA through a feature switch", () => {
  assert.equal(isMfaFeatureEnabled({ APP_ENVIRONMENT: "production", TETAMU_MFA_ENABLED: "false" }), true);
  assert.equal(isMfaFeatureEnabled({ RAILWAY_ENVIRONMENT_NAME: "production" }), true);
});

test("Production key domains cannot reuse identical key bytes with different encodings", () => {
  const f = productionRuntimeFixture();
  const mfa = JSON.parse(f.env.MFA_ENCRYPTION_KEYS);
  const key = Buffer.from(Object.values(mfa)[0] as string, "base64");
  f.env.PAYROLL_PAYMENT_ENCRYPTION_KEYS = JSON.stringify({ [f.env.PAYROLL_PAYMENT_ACTIVE_KEY_VERSION]: key.toString("hex") });
  assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /SECRET_DOMAIN_REUSE/);
});
