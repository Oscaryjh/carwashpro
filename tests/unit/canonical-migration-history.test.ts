import assert from "node:assert/strict";
import test from "node:test";
import { assertMigrationHistory } from "../../scripts/lib/canonical-migration-history.mjs";

const expected = [
  { name: "20260906010000_performance_coverage_indexes", checksum: "a".repeat(64) },
  { name: "20260906020000_performance_targets", checksum: "b".repeat(64) },
];
const applied = expected.map((entry) => ({
  migration_name: entry.name,
  checksum: entry.checksum,
  finished_at: new Date("2026-09-23T00:00:00.000Z"),
  rolled_back_at: null,
}));

test("migration history accepts exactly the expected finished rows", () => {
  assert.doesNotThrow(() => assertMigrationHistory(expected, applied));
});

test("migration history rejects missing, duplicate, unfinished or changed SQL", () => {
  assert.throws(() => assertMigrationHistory(expected, applied.slice(0, 1)), /count/);
  assert.throws(() => assertMigrationHistory(expected, [applied[0], applied[0]]), /duplicate|missing/);
  assert.throws(() => assertMigrationHistory(expected, [applied[0], { ...applied[1], finished_at: null }]), /unfinished/);
  assert.throws(() => assertMigrationHistory(expected, [applied[0], { ...applied[1], checksum: "c".repeat(64) }]), /checksum/);
});
