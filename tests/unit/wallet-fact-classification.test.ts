import assert from "node:assert/strict";
import test from "node:test";
import { classifyPaymentFact } from "../../src/lib/payments/fact-classification";

test("wallet settlement and top-up collection are separate facts", () => {
  assert.deepEqual(classifyPaymentFact({ purpose: "SALE", method: "MEMBER_WALLET" }), { classification: "SALE", settlesInvoice: true, externalCollection: false, cashMovement: false, walletMovement: "DEBIT", salesRefund: true });
  assert.deepEqual(classifyPaymentFact({ purpose: "WALLET_TOP_UP", method: "CASH" }), { classification: "WALLET_TOP_UP", settlesInvoice: false, externalCollection: true, cashMovement: true, walletMovement: "CREDIT", salesRefund: false });
  for (const method of ["PACKAGE", "MEMBER_WALLET", "CRYPTO", "FOREIGN_CURRENCY"]) assert.throws(() => classifyPaymentFact({ purpose: "WALLET_TOP_UP", method: method as "CASH" }));
});

test("sale cash/card and package preserve distinct collection behavior", () => {
  assert.equal(classifyPaymentFact({ purpose: "SALE", method: "CASH" }).cashMovement, true);
  assert.equal(classifyPaymentFact({ purpose: "SALE", method: "CARD" }).externalCollection, true);
  assert.equal(classifyPaymentFact({ purpose: "SALE", method: "CARD" }).cashMovement, false);
  assert.equal(classifyPaymentFact({ purpose: "SALE", method: "PACKAGE" }).externalCollection, false);
});

test("legacy remains unresolved and never infers a topup from missing invoice", () => {
  assert.equal(classifyPaymentFact({ purpose: "LEGACY", method: "CASH" }).classification, "LEGACY");
  assert.equal(classifyPaymentFact({ purpose: "LEGACY", method: "CASH" }).settlesInvoice, null);
  assert.throws(() => classifyPaymentFact({ purpose: "LEGACY", method: "MEMBER_WALLET" }));
});
