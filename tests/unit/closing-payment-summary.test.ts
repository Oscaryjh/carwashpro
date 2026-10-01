import assert from "node:assert/strict";
import test from "node:test";
import { summarizePayments } from "../../src/lib/closing/payment-summary";
import type { Method, Purpose } from "../../src/lib/payments/fact-classification";

test("shift collections exclude wallet settlement but retain cash top-up principal", () => {
  const summary = summarizePayments([
    { amount: 1000, method: "CASH", purpose: "WALLET_TOP_UP", packageUses: 0 },
    { amount: 180, method: "MEMBER_WALLET", purpose: "SALE", packageUses: 0 },
    { amount: 200, method: "MEMBER_WALLET", purpose: "SALE", packageUses: 0 },
    { amount: 100, method: "CARD", purpose: "LEGACY", packageUses: 0 },
    { amount: 1000, method: "CASH", purpose: "WALLET_TOP_UP", packageUses: 0 },
  ], []);
  assert.equal(summary.grossCollected, "2100.00");
  assert.equal(summary.collected, "2100.00");
  assert.equal(summary.cashAmount, "2000.00");
  assert.equal(summary.walletSettled, "380.00");
  assert.equal(summary.refunded, "0.00");
});

for (const method of ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER", "FOREIGN_CURRENCY", "CRYPTO"] as Method[]) {
  for (const purpose of ["SALE", "LEGACY"] as Purpose[]) {
    test(`${purpose} ${method} retains external receipts and refunds`, () => {
      const payment = { amount: 12.34, method, purpose, packageUses: 0 };
      const summary = summarizePayments([payment], [{ amount: 2.34, method, payment, packageUsesRestored: 0 }]);
      assert.equal(summary.grossCollected, "12.34");
      assert.equal(summary.refunded, "2.34");
      assert.equal(summary.collected, "10.00");
      assert.equal(summary.cashAmount, method === "CASH" ? "10.00" : "0.00");
      assert.equal(summary.walletSettled, "0.00");
    });
  }
}

test("wallet refund stays separate while cash top-up reversal reduces external cash", () => {
  const wallet = { amount: 180, purpose: "SALE" as const, method: "MEMBER_WALLET" as const, packageUses: 0 };
  const topUp = { amount: 1000, purpose: "WALLET_TOP_UP" as const, method: "CASH" as const, packageUses: 0 };
  const summary = summarizePayments([wallet, topUp], [
    { amount: 80, method: wallet.method, payment: wallet, packageUsesRestored: 0 },
    { amount: 1000, method: topUp.method, payment: topUp, packageUsesRestored: 0 },
  ]);
  assert.equal(summary.grossCollected, "1000.00");
  assert.equal(summary.refunded, "1000.00");
  assert.equal(summary.collected, "0.00");
  assert.equal(summary.cashAmount, "0.00");
  assert.equal(summary.walletSettled, "180.00");
  assert.equal(summary.walletRefunded, "80.00");
});

test("package uses remain separate from receipts and restored uses are deducted", () => {
  const payment = { amount: 90, method: "PACKAGE" as const, purpose: "LEGACY" as const, packageUses: 3 };
  const summary = summarizePayments([payment], [{ amount: 30, method: payment.method, payment, packageUsesRestored: 1 }]);
  assert.equal(summary.packageUses, 2);
  assert.equal(summary.grossCollected, "0.00");
  assert.equal(summary.refunded, "0.00");
  assert.equal(summary.paymentCount, 0);
});

test("invalid wallet source semantics fail closed through the shared classifier", () => {
  assert.throws(() => summarizePayments([{ amount: 10, method: "MEMBER_WALLET", purpose: "LEGACY", packageUses: 0 }], []), /Wallet only settles sales/);
});
