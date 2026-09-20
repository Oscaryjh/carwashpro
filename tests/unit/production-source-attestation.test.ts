import assert from "node:assert/strict";
import test from "node:test";
import { releaseIdentity } from "../../src/lib/release/environment";
import { productionRuntimeFixture } from "../helpers/production-runtime-fixture";

test("production health identity is bound to the build rather than stale APP_RELEASE labels", () => {
  const f = productionRuntimeFixture();
  assert.equal(releaseIdentity(f.env, f.attestation).tree, f.attestation.tree);
  f.env.APP_RELEASE_SHA = "e".repeat(40);
  assert.throws(() => releaseIdentity(f.env, f.attestation), /APP_RELEASE_SHA/);
});

test("production identity refuses missing build proof and mismatched worker artifact", () => {
  const f = productionRuntimeFixture("analytics");
  assert.throws(() => releaseIdentity(f.env, null), /ATTESTATION/);
  assert.throws(() => releaseIdentity(f.env, { ...f.attestation, sourceDigest: "e".repeat(64) }), /SOURCE_DIGEST/);
});
