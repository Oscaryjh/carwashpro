import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalDatabaseTarget, releaseIdentity, runtimeEnvironment } from "../../src/lib/release/environment";

test("runtime environment distinguishes Testing from Production", () => {
  assert.equal(runtimeEnvironment({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "testing" }), "testing");
  assert.equal(runtimeEnvironment({ NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production" }), "production");
  assert.equal(runtimeEnvironment({ APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "testing" }), "production");
});

test("Local fixture guard parses the database hostname exactly", () => {
  assert.doesNotThrow(() => assertLocalDatabaseTarget("postgresql://user:pass@localhost:5432/db", "fixture"));
  assert.throws(() => assertLocalDatabaseTarget("postgresql://user:pass@localhost.example.com:5432/db", "fixture"), /Local database/);
  assert.throws(() => assertLocalDatabaseTarget("postgresql://user:pass@remote.test:5432/localhost", "fixture"), /Local database/);
});

test("release identity reports commit, deployment and environment without secrets", () => {
  assert.deepEqual(releaseIdentity({ APP_ENVIRONMENT: "testing", APP_RELEASE_SHA: "abc123", RAILWAY_DEPLOYMENT_ID: "deploy-1", npm_package_version: "1.2.3" }), {
    commitSha: "abc123",
    deploymentId: "deploy-1",
    environment: "testing",
    sourceDigest: null,
    version: "1.2.3",
  });
});
