import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionRuntime } from "../../src/lib/release/production-contract.mjs";
import { stagingRuntimeFixture } from "../helpers/staging-runtime-fixture";
import { productionRuntimeFixture } from "../helpers/production-runtime-fixture";

const scopes = ["web", "staff", "analytics", "notification", "whatsapp", "monitor"];
const regionFields = ["RAILWAY_REPLICA_REGION", "PRODUCTION_DATABASE_REGION"];

for (const scope of scopes) {
  test(`staging ${scope} accepts current Singapore for both replica and database`, () => {
    const f = stagingRuntimeFixture(scope);
    f.env.RAILWAY_REPLICA_REGION = "asia-southeast1-eqsg3a";
    f.env.PRODUCTION_DATABASE_REGION = "asia-southeast1-eqsg3a";
    assert.doesNotThrow(() => validateProductionRuntime(f.env, scope, f.attestation));
  });

  for (const field of regionFields) {
    test(`staging ${scope} rejects invalid or mismatched ${field}`, () => {
      for (const region of ["us-west2", "us-west2-a", "unknown", "", "asia-southeast1", undefined]) {
        const f = stagingRuntimeFixture(scope);
        f.env.RAILWAY_REPLICA_REGION = "asia-southeast1-eqsg3a";
        f.env.PRODUCTION_DATABASE_REGION = "asia-southeast1-eqsg3a";
        if (region === undefined) delete f.env[field];
        else f.env[field] = region;
        assert.throws(() => validateProductionRuntime(f.env, scope, f.attestation), {
          message: `PRODUCTION_${field}_INVALID`,
        });
      }
    });
  }

  test(`staging ${scope} rejects a mutually consistent but unapproved region pair`, () => {
    for (const region of ["asia-southeast1", "us-west2", "unknown", ""]) {
      const f = stagingRuntimeFixture(scope);
      f.env.RAILWAY_REPLICA_REGION = region;
      f.env.PRODUCTION_DATABASE_REGION = region;
      assert.throws(() => validateProductionRuntime(f.env, scope, f.attestation), {
        message: "PRODUCTION_RAILWAY_REPLICA_REGION_INVALID",
      });
    }
  });

  test(`production ${scope} retains original region contract with default and explicit profile`, () => {
    for (const profile of [undefined, "production"]) {
      const f = productionRuntimeFixture(scope);
      if (profile) f.env.APP_DEPLOYMENT_PROFILE = profile;
      assert.doesNotThrow(() => validateProductionRuntime(f.env, scope, f.attestation));
      for (const field of regionFields) {
        for (const region of ["asia-southeast1-eqsg3a", "us-west2", "unknown", "", undefined]) {
          const env = { ...f.env };
          if (region === undefined) delete env[field];
          else env[field] = region;
          assert.throws(() => validateProductionRuntime(env, scope, f.attestation), {
            message: `PRODUCTION_${field}_INVALID`,
          });
        }
      }
    }
  });
}
