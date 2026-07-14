import assert from "node:assert/strict";
import test from "node:test";
import {
  getRefundableCents,
  getRefundedPaymentState,
} from "../../src/lib/refunds/rules";
import { getInvoicePaymentSummary } from "../../src/lib/invoices/payment-summary";

test("refundable amount excludes earlier refunds", () => {
  assert.equal(getRefundableCents(10_000, [2_500, 1_000]), 6_500);
  assert.equal(getRefundableCents(10_000, [10_000]), 0);
  assert.equal(getRefundableCents(10_000, [12_000]), 0);
});

test("partial refund leaves the invoice partially paid", () => {
  assert.equal(getRefundedPaymentState(10_000, 7_500, true), "PARTIAL");
});

test("full refund has a distinct refunded state", () => {
  assert.equal(getRefundedPaymentState(10_000, 0, true), "REFUNDED");
  assert.equal(getRefundedPaymentState(10_000, 0, false), "UNPAID");
});

test("fully paid invoices remain paid after unrelated partial-payment math", () => {
  assert.equal(getRefundedPaymentState(10_000, 10_000, true), "PAID");
});

test("invoice payment summary reports net paid values after refunds", () => {
  const summary = getInvoicePaymentSummary([
    {
      amount: 50,
      method: "CASH",
      status: "ACTIVE",
      refunds: [{ amount: 12.5 }],
    },
    {
      amount: 20,
      method: "PACKAGE",
      status: "ACTIVE",
      refunds: [{ amount: 20 }],
    },
  ]);

  assert.equal(summary.grossPaidAmount, 70);
  assert.equal(summary.totalRefundedAmount, 32.5);
  assert.equal(summary.cashPaidAmount, 37.5);
  assert.equal(summary.packageVoucherAmount, 0);
});
