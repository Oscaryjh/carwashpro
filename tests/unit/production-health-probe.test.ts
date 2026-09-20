import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseHealth } from "../../src/lib/ops/health-probe";

const identity = { commitSha: "a".repeat(40), tree: "b".repeat(40), sourceDigest: "c".repeat(64) };
test("monitor rejects a healthy response from the wrong RC or an unavailable database", () => {
  const payload = { ok: true, database: "ready", release: { ...identity, environment: "production" } };
  assert.equal(evaluateReleaseHealth(payload, identity), true);
  for (const key of ["commitSha", "tree", "sourceDigest"] as const) {
    assert.equal(evaluateReleaseHealth({ ...payload, release: { ...payload.release, [key]: "wrong" } }, identity), false);
  }
  assert.equal(evaluateReleaseHealth({ ...payload, database: "unavailable" }, identity), false);
  assert.equal(evaluateReleaseHealth({ ...payload, release: { ...payload.release, environment: "testing" } }, identity), false);
  assert.equal(evaluateReleaseHealth(null, identity), false);
});
