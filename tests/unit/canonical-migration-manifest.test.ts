import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const manifest = readFileSync(join(root, "CANONICAL_MIGRATION_MANIFEST_222.md"), "utf8");
const expected = [...manifest.matchAll(/^\|\s*\d+\s*\|\s*(\d{14}_[a-z0-9_]+)\s*\|[^\n]*?`([0-9a-f]{64})`/gm)]
  .map((match) => ({ name: match[1], hash: match[2] }));
const migrationRoot = join(root, "prisma/migrations");

test("verified manifest contains exactly 222 distinct ordered migration entries", () => {
  assert.equal(expected.length, 222);
  assert.equal(new Set(expected.map((entry) => entry.name)).size, 222);
  assert.deepEqual(expected.map((entry) => entry.name),
    [...expected.map((entry) => entry.name)].sort());
});

test("candidate has exactly the verified 222 SQL files with original SHA-256", () => {
  const actual = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name).sort();
  assert.deepEqual(actual, expected.map((entry) => entry.name));
  for (const entry of expected) {
    const bytes = readFileSync(join(migrationRoot, entry.name, "migration.sql"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, entry.hash, `${entry.name} SQL bytes changed`);
  }
});

test("Performance migration IDs occur once in the canonical 222 set", () => {
  for (const name of [
    "20260905160000_performance_receipts_phase1",
    "20260906010000_performance_coverage_indexes",
    "20260906020000_performance_targets",
  ]) {
    assert.equal(expected.filter((entry) => entry.name === name).length, 1);
  }
});
