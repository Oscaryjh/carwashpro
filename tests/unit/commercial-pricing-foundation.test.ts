import test from "node:test";
import assert from "node:assert/strict";
import { formatCents, parseMoneyToCents, percentDiscount } from "../../src/lib/commercial/money";
import { MODULE_REGISTRY } from "../../src/lib/modules/registry";

test("commercial money uses exact integer cents and missing price is not free", () => {
  assert.equal(parseMoneyToCents("199"), 19_900);
  assert.equal(parseMoneyToCents("159.20"), 15_920);
  assert.equal(parseMoneyToCents(""), null);
  assert.equal(formatCents(null), "Price review required");
  assert.equal(percentDiscount(19_900, 2_000), 3_980);
});

test("commercial module bundles reuse the canonical dependency registry", () => {
  assert.deepEqual(MODULE_REGISTRY.PAYROLL.dependencies, ["HR"]);
  assert.deepEqual(MODULE_REGISTRY.INVENTORY.dependencies, ["POS"]);
});
