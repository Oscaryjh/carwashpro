import assert from "node:assert/strict";
import test from "node:test";
import { formatProductSku, nextProductSku } from "../../src/lib/products/product-sku";

test("formats the first product SKU as SKU-001", () => {
  assert.equal(formatProductSku(1), "SKU-001");
});

test("keeps numbering readable after three digits", () => {
  assert.equal(formatProductSku(12), "SKU-012");
  assert.equal(formatProductSku(1000), "SKU-1000");
});

test("rejects invalid product SKU sequences", () => {
  assert.throws(() => formatProductSku(0), /positive integer/i);
  assert.throws(() => formatProductSku(1.5), /positive integer/i);
});

test("increments the business-owned sequence before assigning a SKU", async () => {
  const updates: unknown[] = [];
  const transaction = {
    business: {
      async update(input: unknown) {
        updates.push(input);
        return { productSequence: 8 };
      },
    },
  };

  assert.equal(await nextProductSku(transaction as never, "business-1"), "SKU-008");
  assert.deepEqual(updates, [{
    where: { id: "business-1" },
    data: { productSequence: { increment: 1 } },
    select: { productSequence: true },
  }]);
});
