import assert from "node:assert/strict";
import test from "node:test";
import { selectedOrOnlyBranch } from "../../src/lib/branch-selection";

test("read context resolves only a valid explicit selection or the sole authorised location", () => {
  const one = { id: "one", name: "Store one" };
  const two = { id: "two", name: "Store two" };
  assert.equal(selectedOrOnlyBranch([], null), undefined);
  assert.equal(selectedOrOnlyBranch([one], null), one);
  assert.equal(selectedOrOnlyBranch([one], "foreign"), undefined);
  assert.equal(selectedOrOnlyBranch([one, two], null), undefined);
  assert.equal(selectedOrOnlyBranch([one, two], "two"), two);
  assert.equal(selectedOrOnlyBranch([one, two], "foreign"), undefined);
});
