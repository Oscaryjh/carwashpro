import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { verifyMigrationIntegrity } from "../helpers/migration-integrity";

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

test("candidate preserves the immutable 222 baseline and verifies every append-only migration", () => {
  const actual = readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name).sort();
  const additions = JSON.parse(readFileSync(join(root, "prisma/migration-additions.json"), "utf8"));
  const actualEntries = actual.map((name) => ({ name, hash: createHash("sha256").update(readFileSync(join(migrationRoot, name, "migration.sql"))).digest("hex") }));
  verifyMigrationIntegrity(expected, additions, actualEntries);
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
