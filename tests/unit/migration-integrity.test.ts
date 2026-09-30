import assert from "node:assert/strict";
import test from "node:test";
import { verifyMigrationIntegrity } from "../helpers/migration-integrity";

const old = [{ name: "20260915090000_baseline", hash: "a".repeat(64) }];
const additions = [{ name: "20260929235900_wallet_enum", hash: "b".repeat(64) }];
const actual = [...old, ...additions];
test("migration integrity accepts append-only verified extensions without a fixed repository count", () => {
  verifyMigrationIntegrity(old, additions, actual);
  const more = [...additions, { name: "20261001000000_next", hash: "c".repeat(64) }];
  verifyMigrationIntegrity(old, more, [...old, ...more]);
});
test("migration integrity rejects historical edits, missing/inserted migrations and unmanifested additions", () => {
  for (const invalid of [actual.slice(1), [...actual].reverse(), [{ ...old[0], hash: "d".repeat(64) }, ...additions], [old[0], { name: "20260914000000_insertion", hash: "e".repeat(64) }, ...additions], [...actual, { name: "20261001000000_unknown", hash: "f".repeat(64) }]]) {
    assert.throws(() => verifyMigrationIntegrity(old, additions, invalid));
  }
});
test("migration integrity rejects changed new SQL, malformed dates, duplicates and non-increasing timestamps", () => {
  assert.throws(() => verifyMigrationIntegrity(old, additions, [old[0], { ...additions[0], hash: "0".repeat(64) }]));
  for (const invalid of [
    [{ name: "20260230000000_bad_date", hash: "b".repeat(64) }],
    [{ name: "bad_name", hash: "b".repeat(64) }],
    [{ ...additions[0], hash: "invalid" }],
    [additions[0], additions[0]],
    [additions[0], { name: "20260929235900_same_timestamp", hash: "c".repeat(64) }],
  ]) assert.throws(() => verifyMigrationIntegrity(old, invalid, [...old, ...invalid]));
});
