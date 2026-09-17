import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseIdentity,
  runtimeEnvironment,
} from "../../src/lib/release/environment";

test("uat-preview remains a distinct runtime identity in a production build", () => {
  const env = {
    APP_ENVIRONMENT: "uat-preview",
    NODE_ENV: "production",
    RAILWAY_ENVIRONMENT_NAME: "hr-payroll-uat-preview-20260917",
  };

  assert.equal(runtimeEnvironment(env), "uat-preview");
  assert.equal(releaseIdentity(env).environment, "uat-preview");
});

test("unknown explicit runtime environments fail closed", () => {
  assert.throws(
    () =>
      runtimeEnvironment({
        APP_ENVIRONMENT: "preview-ish",
        NODE_ENV: "production",
      }),
    /UNKNOWN_RUNTIME_ENVIRONMENT/i,
  );
});

test("Railway deployments cannot infer business environment from NODE_ENV", () => {
  assert.throws(
    () =>
      runtimeEnvironment({
        NODE_ENV: "production",
        RAILWAY_DEPLOYMENT_ID: "deployment-preview",
      }),
    /RUNTIME_ENVIRONMENT_REQUIRED_FOR_DEPLOYED_BUILD/i,
  );
});

test("existing local, Testing, and Production identities remain stable", () => {
  assert.equal(runtimeEnvironment({ NODE_ENV: "development" }), "development");
  assert.equal(runtimeEnvironment({ NODE_ENV: "test" }), "testing");
  assert.equal(
    runtimeEnvironment({
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "testing",
    }),
    "testing",
  );
  assert.equal(
    runtimeEnvironment({
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
    }),
    "production",
  );
  assert.equal(runtimeEnvironment({ NODE_ENV: "production" }), "production");
});
