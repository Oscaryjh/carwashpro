import assert from "node:assert/strict";
import test from "node:test";
import { sumMoneyAmounts } from "../../src/lib/validation/pos";

test("money totals add formatted amounts numerically", () => {
  assert.equal(sumMoneyAmounts(["50.00", "280.00"]), 330);
  assert.equal(sumMoneyAmounts(["20.00", "-20.00"]), 0);
});
