import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { computeBuildContextDigest } from "../../src/lib/release/build-attestation.mjs";
import { verifyDeploymentAttestation } from "../../scripts/verify-rc-staging-deployment-attestation.mjs";

const script = resolve("scripts/attest-release-source.mjs");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function manifest(overrides: Record<string, string> = {}) {
  return JSON.stringify({
    version: 1,
    commitSha: "a".repeat(40),
    tree: "b".repeat(40),
    sourceDigest: "c".repeat(64),
    lockfileHash: sha("{}\n"),
    buildContextDigest: "d".repeat(64),
    ...overrides,
  });
}

function run(cwd: string, extra: Record<string, string | undefined> = {}) {
  const env = Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    HOME: cwd,
    NODE_ENV: "production",
    APP_ENVIRONMENT: "production",
    APP_DEPLOYMENT_PROFILE: "rc-staging",
    RAILWAY_ENVIRONMENT_NAME: "Production-RC-Staging-20260920",
    APP_RELEASE_SHA: "a".repeat(40),
    APP_RELEASE_TREE: "b".repeat(40),
    APP_RELEASE_SOURCE_DIGEST: "c".repeat(64),
    APP_IMMUTABLE_SOURCE_MANIFEST: manifest(),
    RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
    ...extra,
  }).filter(([, value]) => value !== undefined)) as NodeJS.ProcessEnv;
  return spawnSync(process.execPath, [script], { cwd, env, encoding: "utf8" });
}

test("Railpack context without .git produces a content-based attestation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-railpack-no-git-"));
  try {
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    writeFileSync(join(directory, "app.txt"), "synthetic\n");
    const result = run(directory, { APP_IMMUTABLE_SOURCE_MANIFEST: manifest({ buildContextDigest: computeBuildContextDigest(directory) }) });
    assert.equal(result.status, 0);
    const proof = JSON.parse(readFileSync(join(directory, ".release/source-attestation.json"), "utf8"));
    assert.equal(proof.mode, "RAILPACK_BUILD");
    assert.equal(proof.buildContextDigest.length, 64);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Railpack attestation fails closed for missing or mismatched immutable manifest values", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-railpack-manifest-"));
  try {
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    for (const [name, value] of [["missing", undefined], ["sha", manifest({ commitSha: "e".repeat(40) })], ["tree", manifest({ tree: "e".repeat(40) })], ["source", manifest({ sourceDigest: "e".repeat(64) })], ["lock", manifest({ lockfileHash: "e".repeat(64) })], ["context", manifest({ buildContextDigest: "e".repeat(64) })]] as const) {
      const result = run(directory, { APP_IMMUTABLE_SOURCE_MANIFEST: value });
      assert.equal(result.status, 1, name);
      const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
      assert.match(error.code, /MANIFEST|DIGEST|LOCKFILE/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Railpack attestation classifies a missing lockfile", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-railpack-lockfile-"));
  try {
    const result = run(directory);
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
    assert.equal(error.code, "LOCKFILE_MISSING");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Railpack attestation rejects build-context tampering and platform commit mismatch", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-railpack-tamper-"));
  try {
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    writeFileSync(join(directory, "app.txt"), "synthetic\n");
    const context = computeBuildContextDigest(directory);
    writeFileSync(join(directory, "app.txt"), "tampered\n");
    assert.notEqual(run(directory, { APP_IMMUTABLE_SOURCE_MANIFEST: manifest({ buildContextDigest: context }) }).status, 0, "manifest context digest must match actual context");
    const result = run(directory, { APP_IMMUTABLE_SOURCE_MANIFEST: manifest({ buildContextDigest: computeBuildContextDigest(directory) }), RAILWAY_GIT_COMMIT_SHA: "f".repeat(40) });
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
    assert.equal(error.code, "RAILWAY_COMMIT_MISMATCH");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("local publication remains clean-Git-only and rejects dirty or unknown environments", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-local-attester-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "-q"); git("config", "user.name", "RC local test"); git("config", "user.email", "local@invalid.test");
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "source");
    const commit = git("rev-parse", "HEAD").toString().trim();
    assert.equal(run(directory, { APP_DEPLOYMENT_PROFILE: "production", RAILWAY_ENVIRONMENT_NAME: "production", RAILWAY_GIT_COMMIT_SHA: commit }).status, 0);
    writeFileSync(join(directory, "dirty.txt"), "dirty\n");
    assert.equal(run(directory, { APP_DEPLOYMENT_PROFILE: "production", RAILWAY_ENVIRONMENT_NAME: "production" }).status, 1);
    const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
    assert.equal(error.code, "LOCAL_DIRTY");
    assert.equal(run(directory, { APP_ENVIRONMENT: "mystery", APP_DEPLOYMENT_PROFILE: "rc-staging" }).status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("external deployment verifier requires Railway platform commit metadata and rejects drift", () => {
  assert.throws(() => verifyDeploymentAttestation({ metadata: {}, manifestRaw: manifest() }), /RAILWAY_COMMIT_METADATA_MISSING/);
  assert.throws(() => verifyDeploymentAttestation({ metadata: { commitHash: "f".repeat(40) }, manifestRaw: manifest() }), /RAILWAY_COMMIT_MISMATCH/);
  assert.deepEqual(verifyDeploymentAttestation({ metadata: { meta: { commitHash: "a".repeat(40) } }, manifestRaw: manifest() }), {
    verified: true, commitSha: "a".repeat(40), tree: "b".repeat(40), sourceDigest: "c".repeat(64), lockfileHash: sha("{}\n"), buildContextDigest: "d".repeat(64),
  });
});

test("self-reported or unknown Railway environment values cannot bypass attestation", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-env-contract-"));
  try {
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    const result = run(directory, { RAILWAY_ENVIRONMENT_NAME: "unapproved-environment" });
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
    assert.equal(error.code, "UNKNOWN_ENVIRONMENT");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("Railpack attestation rejects a missing Railway environment identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-env-missing-"));
  try {
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    const result = run(directory, { RAILWAY_ENVIRONMENT_NAME: undefined });
    assert.equal(result.status, 1);
    const error = JSON.parse(readFileSync(join(directory, ".release/source-attestation-error.json"), "utf8"));
    assert.equal(error.code, "RAILWAY_ENVIRONMENT_IDENTITY_MISSING");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
