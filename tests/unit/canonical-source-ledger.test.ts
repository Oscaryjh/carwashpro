import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const verifier = join(root, "scripts/verify-canonical-source-ledger.mjs");
const baseSha = "0c2b8d13aac620368e8d2d1c191c8e59efee9169";

function runWithEntries(entries: unknown[]) {
  const directory = mkdtempSync(join(tmpdir(), "tetamu-source-ledger-"));
  try {
    const manifest = join(directory, "sources.json");
    writeFileSync(manifest, JSON.stringify({ entries }));
    return spawnSync(process.execPath, [verifier, manifest], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("source ledger accepts an existing commit with an explicit decision", () => {
  const result = runWithEntries([
    {
      feature: "common baseline",
      sha: baseSha,
      decision: "APPLY",
      files: ["package.json"],
      migrationNames: [],
      tests: ["tests/unit/canonical-source-ledger.test.ts"],
      reason: "verified common Git ancestor",
    },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 source/);
});

test("source ledger rejects a migration claimed by two sources", () => {
  const source = {
    feature: "duplicate source",
    sha: baseSha,
    decision: "APPLY",
    files: ["package.json"],
    migrationNames: ["20260905160000_performance_receipts_phase1"],
    tests: ["tests/unit/canonical-source-ledger.test.ts"],
    reason: "must not duplicate verified SQL",
  };
  const result = runWithEntries([source, { ...source, feature: "second claimant" }]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate migration/i);
});

test("source ledger rejects a nonexistent Git commit", () => {
  const result = runWithEntries([
    {
      feature: "invalid source",
      sha: "0".repeat(40),
      decision: "APPLY",
      files: ["package.json"],
      migrationNames: [],
      tests: ["tests/unit/canonical-source-ledger.test.ts"],
      reason: "must be traceable",
    },
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a commit/i);
});

test("source ledger records post-alignment migrations as deferred without claiming the 222 baseline", () => {
  const result = runWithEntries([{
    feature: "post-alignment PCB",
    sha: baseSha,
    decision: "DEFERRED_POST_ALIGNMENT_FEATURE",
    files: ["src/lib/payroll/pcb-published-correction.ts"],
    migrationNames: [],
    deferredMigrationNames: [
      "20260920000100_controlled_manual_pcb_source",
      "20260920000200_published_pcb_correction",
    ],
    tests: ["tests/unit/canonical-source-ledger.test.ts"],
    reason: "not in the verified 222 SQL baseline",
  }]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 migration claims/);
});
