import assert from "node:assert/strict";
import test from "node:test";
import { verifyStagingDatabaseTransport, validateStagingRuntimeSecrets, validateStagingKeyrings } from "../../scripts/lib/rc-staging-fixture-transport";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

test("public TCP transport must retain authoritative database and credentials", () => {
  const result = verifyStagingDatabaseTransport("postgresql://synthetic:encoded%40value@internal.invalid:5432/synthetic", "postgresql://synthetic:encoded%40value@proxy.invalid:1234/synthetic", { domain: "proxy.invalid", port: "1234" });
  assert.equal(new URL(result).searchParams.get("sslmode"), "require");
});
test("secure runtime file cannot override connection, security profile or provider gates", () => {
  const runtime = Object.fromEntries(["SESSION_SECRET", "EMPLOYEE_AUTH_SECRET", "MFA_ACTIVE_KEY_VERSION", "MFA_ENCRYPTION_KEYS", "PAYROLL_PAYMENT_ACTIVE_KEY_VERSION", "PAYROLL_PAYMENT_ENCRYPTION_KEYS", "PAYROLL_PAYMENT_FINGERPRINT_KEY", "RC_STAGING_OTP_HMAC_SEED", "OPS_ALERT_WEBHOOK_BEARER_TOKEN"].map(key => [key, "synthetic"]));
  assert.doesNotThrow(() => validateStagingRuntimeSecrets(runtime));
  for (const key of ["DATABASE_URL", "NODE_ENV", "APP_ENVIRONMENT", "TETAMU_MFA_ENABLED", "WHATSAPP_SEND_MODE", "BANK_PAYMENT_EXECUTION_ENABLED", "NODE_OPTIONS"])
    assert.throws(() => validateStagingRuntimeSecrets({ ...runtime, [key]: "sentinel-private" }), /RC_STAGING_FIXTURE_RUNTIME_REJECTED/);
  for (const key of Object.keys(runtime)) {
    const incomplete = { ...runtime }; delete incomplete[key];
    assert.throws(() => validateStagingRuntimeSecrets(incomplete), /RC_STAGING_FIXTURE_RUNTIME_REJECTED/);
  }
});
test("direct worker cannot consume a caller-selected database or caller-issued identity proof", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/rc-staging-synthetic-worker.ts"], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, APP_ENVIRONMENT: "production", NODE_ENV: "production", DATABASE_URL: "postgresql://sentinel-private@127.0.0.1:1/forbidden" },
    input: '{"proof":{},"password":"sentinel-private"}', encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /SECURE_FILE_ARGUMENTS_REQUIRED/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("sentinel-private"));
});
test("keyrings deny inactive keys, alternate encodings, protected hashes and cross-domain reuse", () => {
  const keyA = Buffer.alloc(32, 5), keyB = Buffer.alloc(32, 9);
  const make = (a: string, b: string) => ({ MFA_ACTIVE_KEY_VERSION: "rc-staging-v1", MFA_ENCRYPTION_KEYS: JSON.stringify({ "rc-staging-v1": a }), PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "rc-staging-v1", PAYROLL_PAYMENT_ENCRYPTION_KEYS: JSON.stringify({ "rc-staging-v1": b }) });
  const valid = make(keyA.toString("base64"), keyB.toString("base64"));
  assert.equal(validateStagingKeyrings(valid, []).length, 2);
  const protectedHash = createHash("sha256").update(keyA).digest("hex");
  for (const invalid of [make(keyA.toString("base64"), keyA.toString("base64")), make(keyA.toString("base64").replace(/=+$/, ""), keyB.toString("base64")), { ...valid, MFA_ENCRYPTION_KEYS: JSON.stringify({ "rc-staging-v1": keyA.toString("base64"), old: keyB.toString("base64") }) }])
    assert.throws(() => validateStagingKeyrings(invalid, []), /RC_STAGING_FIXTURE_KEYRING_REJECTED/);
  assert.throws(() => validateStagingKeyrings(valid, [protectedHash]), /RC_STAGING_FIXTURE_KEYRING_REJECTED/);
});
test("wrong proxy, username, password, database, protocol and options fail without echoing inputs", () => {
  const internal = "postgresql://synthetic:sentinel-private@internal.invalid:5432/synthetic";
  for (const external of ["postgresql://synthetic:sentinel-private@other.invalid:1234/synthetic", "postgresql://other:sentinel-private@proxy.invalid:1234/synthetic", "postgresql://synthetic:other@proxy.invalid:1234/synthetic", "postgresql://synthetic:sentinel-private@proxy.invalid:1234/other", "https://synthetic:sentinel-private@proxy.invalid:1234/synthetic", "postgresql://synthetic:sentinel-private@proxy.invalid:1234/synthetic?options=unsafe", "not a url"]) {
    assert.throws(() => verifyStagingDatabaseTransport(internal, external, { domain: "proxy.invalid", port: "1234" }), { message: "RC_STAGING_FIXTURE_TRANSPORT_REJECTED" });
  }
});
