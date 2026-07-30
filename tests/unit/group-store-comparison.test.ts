import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveGroupStoreComparisonSelection,
} from "../../src/lib/business-groups/group-store-comparison";

const rankedIds = ["store-a", "store-d", "store-b", "store-c", "store-e"];

test("defaults to the top two ranked stores", () => {
  assert.deepEqual(
    resolveGroupStoreComparisonSelection(undefined, rankedIds),
    {
      ids: ["store-a", "store-d"],
      error: null,
      isDefault: true,
    },
  );
});

test("accepts two to four stores and keeps stable ranking order", () => {
  assert.deepEqual(
    resolveGroupStoreComparisonSelection(
      ["store-c", "store-a", "store-b"],
      rankedIds,
    ),
    {
      ids: ["store-a", "store-b", "store-c"],
      error: null,
      isDefault: false,
    },
  );
  assert.deepEqual(
    resolveGroupStoreComparisonSelection(
      "store-c,store-a,store-d,store-b",
      rankedIds,
    ).ids,
    ["store-a", "store-d", "store-b", "store-c"],
  );
});

test("deduplicates selections before enforcing the minimum", () => {
  const selection = resolveGroupStoreComparisonSelection(
    ["store-a", "store-a"],
    rankedIds,
  );
  assert.deepEqual(selection.ids, ["store-a"]);
  assert.match(selection.error ?? "", /at least 2/);
});

test("rejects more than four stores", () => {
  const selection = resolveGroupStoreComparisonSelection(rankedIds, rankedIds);
  assert.deepEqual(selection.ids, rankedIds);
  assert.match(selection.error ?? "", /no more than 4/);
});

test("fails closed when any selected store is not available", () => {
  const selection = resolveGroupStoreComparisonSelection(
    ["store-a", "outside-store"],
    rankedIds,
  );
  assert.deepEqual(selection.ids, ["store-a"]);
  assert.match(selection.error ?? "", /not available/);
});

test("does not mutate ranked candidates or discard a zero-activity candidate", () => {
  const original = [...rankedIds];
  const selection = resolveGroupStoreComparisonSelection(
    ["store-a", "store-c"],
    rankedIds,
  );
  assert.deepEqual(selection.ids, ["store-a", "store-c"]);
  assert.deepEqual(rankedIds, original);
});
