import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { readCanonicalVersion } from "../../src/lib/release/canonical-version";
import { GET as versionRoute } from "../../src/app/api/internal/version/route";

const sha = "a".repeat(40);
const buildTime = "2026-09-23T09:00:00.000Z";

test("canonical Testing version requires embedded exact Git SHA, build time and 222 baseline", () => {
  const version = readCanonicalVersion({ APP_BUILD_SHA: sha, APP_BUILD_TIME: buildTime,
    APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing",
    RAILWAY_GIT_COMMIT_SHA: sha });
  assert.deepEqual(version, { commitSha: sha, buildTime, environment: "testing", migrationBaseline: 222, ready: true });
});

test("missing, short or mismatched SHA and non-Testing identity cannot claim alignment", () => {
  for (const env of [
    { APP_BUILD_SHA: undefined }, { APP_BUILD_SHA: "a".repeat(7) },
    { RAILWAY_GIT_COMMIT_SHA: "b".repeat(40) }, { APP_BUILD_TIME: "yesterday" },
    { APP_ENVIRONMENT: "production" }, { RAILWAY_ENVIRONMENT_NAME: "production" },
  ]) {
    assert.equal(readCanonicalVersion({ APP_BUILD_SHA: sha, APP_BUILD_TIME: buildTime,
      APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing",
      RAILWAY_GIT_COMMIT_SHA: sha, ...env }).ready, false);
  }
});

test("Next production build embeds Git source SHA and build timestamp rather than trusting runtime-only variables", () => {
  const source = readFileSync("next.config.mjs", "utf8");
  assert.match(source, /execFileSync\("git", \["rev-parse", "HEAD"\]/);
  assert.match(source, /APP_BUILD_SHA:\s*buildSha/);
  assert.match(source, /APP_BUILD_TIME:\s*buildTime/);
  assert.match(source, /RAILWAY_GIT_COMMIT_SHA/);
});

test("internal version endpoint exposes only source metadata and fails closed on mismatch", async () => {
  const keys = ["APP_BUILD_SHA", "APP_BUILD_TIME", "APP_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_GIT_COMMIT_SHA"] as const;
  const previous = keys.map((key) => process.env[key]);
  try {
    Object.assign(process.env, { APP_BUILD_SHA: sha, APP_BUILD_TIME: buildTime,
      APP_ENVIRONMENT: "testing", RAILWAY_ENVIRONMENT_NAME: "testing", RAILWAY_GIT_COMMIT_SHA: sha });
    const ok = await versionRoute();
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), readCanonicalVersion());
    assert.match(ok.headers.get("cache-control") ?? "", /no-store/);
    process.env.RAILWAY_GIT_COMMIT_SHA = "b".repeat(40);
    assert.equal((await versionRoute()).status, 503);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});
