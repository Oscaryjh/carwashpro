import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

test("build proof uses actual clean Git archive and rejects dirty or mismatched source", () => {
  const directory = mkdtempSync(join(tmpdir(), "rc-attester-"));
  const script = resolve("scripts/attest-release-source.mjs");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
  const run = (extra: Record<string, string> = {}) => spawnSync(process.execPath, [script], { cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: "test", APP_ENVIRONMENT: "production", ...extra } });
  try {
    git("init", "-q"); git("config", "user.name", "RC local test"); git("config", "user.email", "local@invalid.test");
    writeFileSync(join(directory, ".gitignore"), ".release/\n");
    writeFileSync(join(directory, "package-lock.json"), "{}\n");
    git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-qm", "local synthetic source");
    const sha = git("rev-parse", "HEAD").toString().trim();
    assert.equal(run({ RAILWAY_GIT_COMMIT_SHA: sha }).status, 0);
    const proof = JSON.parse(readFileSync(join(directory, ".release/source-attestation.json"), "utf8"));
    assert.deepEqual(proof, { commitSha: sha, tree: git("rev-parse", "HEAD^{tree}").toString().trim(), sourceDigest: hash(git("archive", "--format=tar", "HEAD")), lockfileHash: hash("{}\n") });
    assert.equal(run({ RAILWAY_GIT_COMMIT_SHA: "0".repeat(40) }).status, 1);
    assert.equal(JSON.parse(readFileSync(join(directory, ".release/source-attestation.json"), "utf8")).mode, "INVALID");
    writeFileSync(join(directory, "package-lock.json"), "{\"dirty\":true}\n");
    assert.equal(run().status, 1);
    assert.equal(run({ APP_ENVIRONMENT: "development" }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(directory, ".release/source-attestation.json"), "utf8")).mode, "LOCAL_UNATTESTED");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
