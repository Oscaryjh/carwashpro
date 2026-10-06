import assert from "node:assert/strict";
import test from "node:test";
import { optionalShiftMigrationChain } from "../helpers/optional-shifts-upgrade";
import { assertMigrationHistory } from "../../scripts/lib/canonical-migration-history.mjs";

const baseline = ["20260901000000_historical", "20260930000000_wallet"];
const foundation = "20261002010000_optional_cashier_shifts";
const target = "20261003000000_cashier_shifts_default_off";
const historicalChain = [...baseline, foundation, target];

function chain(names: string[]) {
  return optionalShiftMigrationChain(names, baseline);
}

test("Optional Shift historical chain accepts later additive migrations without including them in the target upgrade", () => {
  assert.deepEqual(chain(historicalChain), historicalChain);
  assert.deepEqual(chain([...historicalChain, "20261006000000_invoice_item_explicit_kind", "20261007000000_future_addition"]), historicalChain);
});

test("Optional Shift historical chain still rejects a missing required migration, an insertion, duplicate or wrong order", () => {
  for (const names of [
    [...baseline, foundation], [...baseline, target],
    [...baseline, "20261002020000_unexpected_insertion", foundation, target],
    [...baseline, target, foundation], [...historicalChain, target],
  ]) assert.throws(() => chain(names));
});

test("Optional Shift applied chain retains mandatory target completion and checksum verification", () => {
  const expected = historicalChain.map((name, index) => ({ name, checksum: String(index).repeat(64) }));
  const applied = expected.map(entry => ({ migration_name: entry.name, checksum: entry.checksum, finished_at: new Date(), rolled_back_at: null }));
  assert.doesNotThrow(() => assertMigrationHistory(expected, applied));
  assert.throws(() => assertMigrationHistory(expected, applied.slice(0, -1)), /count|missing/);
  assert.throws(() => assertMigrationHistory(expected, [...applied.slice(0, -1), { ...applied.at(-1)!, finished_at: null }]), /unfinished/);
  assert.throws(() => assertMigrationHistory(expected, [...applied.slice(0, -1), { ...applied.at(-1)!, checksum: "f".repeat(64) }]), /checksum/);
});
