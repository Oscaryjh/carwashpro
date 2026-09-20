import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { validateProductionRuntime } from "../../src/lib/release/production-contract.mjs";
import { parseRuntimeEnvironment } from "../../src/lib/release/environment-contract.mjs";
import { evaluateReleaseHealth } from "../../src/lib/ops/health-probe";
import { stagingRuntimeFixture } from "../helpers/staging-runtime-fixture";
import { productionRuntimeFixture } from "../helpers/production-runtime-fixture";

for (const scope of ["web", "staff", "analytics", "notification", "whatsapp", "monitor"]) {
  test(`staging ${scope} retains production grade attestation and health identity`, () => {
    const f = stagingRuntimeFixture(scope);
    const identity = validateProductionRuntime(f.env, scope, f.attestation);
    assert.equal(parseRuntimeEnvironment(f.env), "production");
    assert.equal(evaluateReleaseHealth({ ok: true, database: "ready", release: { ...identity, environment: "production" } }, identity), true);
    assert.equal(evaluateReleaseHealth({ ok: false, database: "unavailable", release: { ...identity, environment: "production" } }, identity), false);
    f.env.APP_RELEASE_SHA = "f".repeat(40);
    assert.throws(() => validateProductionRuntime(f.env, scope, f.attestation), /PRODUCTION_/);
  });
}

test("staging never weakens production safeguards or accepts another platform identity", () => {
  for (const [key, value] of [
    ["APP_DEPLOYMENT_PROFILE", "other"], ["APP_ENVIRONMENT", "testing"],
    ["RAILWAY_ENVIRONMENT_NAME", "production"], ["RAILWAY_ENVIRONMENT_NAME", "Production-RC-Staging-other"],
    ["RC_STAGING_IDENTITY", "{}"], ["RAILWAY_ENVIRONMENT_ID", "wrong"], ["RAILWAY_PROJECT_ID", "wrong"],
    ["RAILWAY_SERVICE_ID", "synthetic-staff"], ["RAILWAY_DATABASE_SERVICE_ID", "wrong"],
    ["RAILWAY_REPLICA_REGION", "us-west2"], ["PRODUCTION_DATABASE_REGION", "us-west2"],
    ["PRODUCTION_EXPECTED_DATABASE_FINGERPRINT", "f".repeat(64)], ["TETAMU_MFA_ENABLED", "false"],
    ["SESSION_SECRET", "short"], ["MFA_ENCRYPTION_KEYS", "{}"], ["PAYROLL_PAYMENT_ENCRYPTION_KEYS", "{}"],
    ["OTP_PROVIDER", "sms123"], ["SMS123_API_KEY", "forbidden"], ["EMPLOYEE_OTP_MOCK_CODE", "000000"],
    ["RC_STAGING_SYNTHETIC_PHONE_ALLOWLIST", ""], ["RC_STAGING_OTP_HMAC_SEED", ""],
    ["WHATSAPP_SEND_MODE", "live"], ["EMAIL_SEND_MODE", "live"], ["AI_GLOBAL_ENABLED", "true"],
    ["PRODUCTION_ELIGIBLE", "true"], ["PAYMENT_EXPORT_ENABLED", "true"], ["PCB_PRODUCTION_ENABLED", "true"],
  ]) {
    const f = stagingRuntimeFixture(); f.env[key] = value;
    assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /PRODUCTION_/, key);
  }
  const worker = stagingRuntimeFixture("notification"); worker.env.WORKER_REPLICA_COUNT = "2";
  assert.throws(() => validateProductionRuntime(worker.env, "notification", worker.attestation), /PRODUCTION_/);
});

test("protected identities and independent secrets override matching staging allow bindings", () => {
  for (const category of ["testing", "preview", "production"]) {
    for (const field of ["environmentId", "serviceIds", "databaseNames", "databaseFingerprints", "secretFingerprints"]) {
      const f = stagingRuntimeFixture(); const policy = JSON.parse(f.env.RC_STAGING_IDENTITY);
      policy.protected[category][field] = field === "environmentId" ? f.env.RAILWAY_ENVIRONMENT_ID : [
        field === "serviceIds" ? f.env.RAILWAY_SERVICE_ID : field === "databaseNames" ? f.env.PRODUCTION_DATABASE_NAME :
        field === "databaseFingerprints" ? f.env.PRODUCTION_EXPECTED_DATABASE_FINGERPRINT : createHash("sha256").update(f.env.SESSION_SECRET).digest("hex"),
      ];
      f.env.RC_STAGING_IDENTITY = JSON.stringify(policy);
      assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /PRODUCTION_/);
    }
  }
});

test("production retains live-provider contract and refuses staging keys or profiles", () => {
  const f = productionRuntimeFixture();
  assert.doesNotThrow(() => validateProductionRuntime(f.env, "web", f.attestation));
  f.env.RC_STAGING_OTP_HMAC_SEED = "s".repeat(48);
  assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /PRODUCTION_/);
});

test("staging platform name or deployment marker cannot downgrade the shared parser", () => {
  for (const value of ["testing", "uat-preview", "development", ""]) {
    const f = stagingRuntimeFixture(); f.env.APP_ENVIRONMENT = value;
    assert.throws(() => parseRuntimeEnvironment(f.env), /STAGING.*PRODUCTION/);
    delete f.env.APP_DEPLOYMENT_PROFILE;
    assert.throws(() => parseRuntimeEnvironment(f.env), /STAGING.*PRODUCTION/);
  }
});

test("staging manifest cannot disguise duplicate service bindings with extra keys", () => {
  const f = stagingRuntimeFixture(); const policy = JSON.parse(f.env.RC_STAGING_IDENTITY);
  policy.services.staff = policy.services.web; policy.services.extra = "synthetic-extra";
  f.env.RC_STAGING_IDENTITY = JSON.stringify(policy);
  assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /IDENTITY_INVALID/);
});

test("staging database password cannot reuse a protected secret or an application secret", () => {
  for (const reusedAppSecret of [true, false]) {
    const f = stagingRuntimeFixture(); const policy = JSON.parse(f.env.RC_STAGING_IDENTITY);
    const url = new URL(f.env.DATABASE_URL);
    if (reusedAppSecret) { url.password = f.env.SESSION_SECRET; f.env.DATABASE_URL = url.toString(); }
    else { policy.protected.production.secretFingerprints = [createHash("sha256").update(decodeURIComponent(url.password)).digest("hex")]; f.env.RC_STAGING_IDENTITY = JSON.stringify(policy); }
    assert.throws(() => validateProductionRuntime(f.env, "web", f.attestation), /SECRET.*REUSE/);
  }
});
