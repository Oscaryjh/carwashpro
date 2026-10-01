import assert from "node:assert/strict";
import test from "node:test";
import { calculateFinancialMetrics } from "../../src/lib/financial-metrics";
import * as facts from "../../src/lib/payments/fact-classification";

const invoice = (totalCents: number) => ({ totalCents, tipCents: 0, discountCents: 0, loyaltyDiscountCents: 0, packageVoucherCents: 0 });
const payment = (amountCents: number, purpose: "SALE" | "WALLET_TOP_UP", method: "CASH" | "CARD" | "MEMBER_WALLET") => ({ amountCents, isPackage: false, purpose, method });

test("top-up and wallet settlement never double count external collections or sales", () => {
  const top = calculateFinancialMetrics({ invoices: [], payments: [payment(100000, "WALLET_TOP_UP", "CASH")], refunds: [] });
  assert.equal(top.netSalesCents, 0);
  assert.equal(top.grossCollectionsCents, 100000);
  assert.equal(top.topUpPrincipalCents, 100000);
  const sale = calculateFinancialMetrics({ invoices: [invoice(18000)], payments: [payment(18000, "SALE", "MEMBER_WALLET")], refunds: [] });
  assert.equal(sale.netSalesCents, 18000);
  assert.equal(sale.grossCollectionsCents, 0);
  assert.equal(sale.walletRedemptionsCents, 18000);
});

test("wallet plus card sale counts one invoice and only external leg as collection", () => {
  const result = calculateFinancialMetrics({ invoices: [invoice(30000)], payments: [payment(20000, "SALE", "MEMBER_WALLET"), payment(10000, "SALE", "CARD")], refunds: [] });
  assert.equal(result.netSalesCents, 30000);
  assert.equal(result.grossCollectionsCents, 10000);
  assert.equal(result.transactionCount, 1);
});

test("wallet refund is sales refund, never external refund; reversal is the opposite", () => {
  const result = calculateFinancialMetrics({ invoices: [invoice(30000)], payments: [], refunds: [
    { amountCents: 10000, isPackage: false, method: "MEMBER_WALLET", originalPayment: { purpose: "SALE", method: "MEMBER_WALLET" } },
    { amountCents: 100000, isPackage: false, method: "CASH", originalPayment: { purpose: "WALLET_TOP_UP", method: "CASH" } },
  ] });
  assert.equal(result.netSalesCents, 20000);
  assert.equal(result.netCollectionsCents, -100000);
  assert.equal(result.walletRefundsCents, 10000);
  assert.equal(result.topUpReversalsCents, 100000);
});

test("refund classifier rejects wallet refund to cash and source-less wallet facts", () => {
  assert.equal(typeof facts.classifyRefundFact, "function");
  assert.throws(() => facts.classifyRefundFact({ originalPayment: { purpose: "SALE", method: "MEMBER_WALLET" }, refundMethod: "CASH" }));
  assert.throws(() => calculateFinancialMetrics({ invoices: [], payments: [{ amountCents: 10, isPackage: false, method: "MEMBER_WALLET" }], refunds: [] }));
});
