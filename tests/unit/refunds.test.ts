import assert from "node:assert/strict";
import test from "node:test";
import {
  getRefundableCents,
} from "../../src/lib/refunds/rules";
import { getInvoicePaymentSummary } from "../../src/lib/invoices/payment-summary";
import {
  resolveInvoiceSettlement,
  resolveInvoiceSettlementFromPayments,
} from "../../src/lib/invoices/settlement";
import { evaluateRefundReceivableRecord } from "../../src/lib/invoices/refund-receivable-remediation";

test("refundable amount excludes earlier refunds", () => {
  assert.equal(getRefundableCents(10_000, [2_500, 1_000]), 6_500);
  assert.equal(getRefundableCents(10_000, [10_000]), 0);
  assert.equal(getRefundableCents(10_000, [12_000]), 0);
});

test("genuine partial payment keeps the contractual outstanding balance", () => {
  assert.deepEqual(
    resolveInvoiceSettlement({
      refundedCents: 0,
      settledObligationCents: 10_000,
      totalCents: 13_500,
    }),
    {
      outstandingCents: 3_500,
      refundLifecycle: "NONE",
      refundedCents: 0,
      settledObligationCents: 10_000,
      status: "PARTIAL",
    },
  );
});

test("fully paid invoice remains settled after a partial refund", () => {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: [{ amount: 135, refunds: [{ amount: 35 }], status: "ACTIVE" }],
    totalCents: 13_500,
  });

  assert.equal(settlement.settledObligationCents, 13_500);
  assert.equal(settlement.refundedCents, 3_500);
  assert.equal(settlement.outstandingCents, 0);
  assert.equal(settlement.status, "PAID");
  assert.equal(settlement.refundLifecycle, "PARTIAL");
});

test("fully paid invoice has REFUNDED lifecycle status without recreating debt", () => {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: [{ amount: 135, refunds: [{ amount: 135 }], status: "ACTIVE" }],
    totalCents: 13_500,
  });

  assert.equal(settlement.settledObligationCents, 13_500);
  assert.equal(settlement.refundedCents, 13_500);
  assert.equal(settlement.outstandingCents, 0);
  assert.equal(settlement.status, "REFUNDED");
  assert.equal(settlement.refundLifecycle, "FULL");
});

test("multiple refunds do not turn a settled invoice into a receivable", () => {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: [
      {
        amount: 200,
        refunds: [{ amount: 30 }, { amount: 20 }],
        status: "ACTIVE",
      },
    ],
    totalCents: 20_000,
  });

  assert.equal(settlement.refundedCents, 5_000);
  assert.equal(settlement.outstandingCents, 0);
  assert.equal(settlement.status, "PAID");
});

test("multiple payment legs keep settlement separate from method refunds", () => {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: [
      { amount: 50, method: "CASH", refunds: [], status: "ACTIVE" },
      {
        amount: 150,
        method: "DUITNOW",
        refunds: [{ amount: 30 }],
        status: "ACTIVE",
      },
    ],
    totalCents: 20_000,
  });

  assert.equal(settlement.settledObligationCents, 20_000);
  assert.equal(settlement.refundedCents, 3_000);
  assert.equal(settlement.outstandingCents, 0);
  assert.equal(settlement.status, "PAID");
});

test("partial payment refund does not increase contractual outstanding", () => {
  const settlement = resolveInvoiceSettlementFromPayments({
    payments: [
      { amount: 100, refunds: [{ amount: 30 }], status: "ACTIVE" },
    ],
    totalCents: 20_000,
  });

  assert.equal(settlement.settledObligationCents, 10_000);
  assert.equal(settlement.refundedCents, 3_000);
  assert.equal(settlement.outstandingCents, 10_000);
  assert.equal(settlement.status, "PARTIAL");
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
  assert.equal(summary.grossMonetaryCollectionAmount, 50);
  assert.equal(summary.monetaryRefundedAmount, 12.5);
  assert.equal(summary.netCollectedAmount, 37.5);
  assert.equal(summary.packageVoucherAmount, 0);
});

test("historical audit identifies legacy refund-created receivables", () => {
  const evaluation = evaluateRefundReceivableRecord({
    currentBalanceCents: 3_500,
    currentPaidAmountCents: 10_000,
    currentStatus: "PARTIAL",
    payments: [
      {
        amount: 135,
        id: "payment-1",
        refunds: [{ amount: 35, id: "refund-1" }],
        status: "ACTIVE",
      },
    ],
    totalCents: 13_500,
  });

  assert.equal(evaluation.category, "FULLY_PAID_PARTIAL_REFUND");
  assert.equal(evaluation.differsFromCanonical, true);
  assert.equal(evaluation.canonical.status, "PAID");
  assert.equal(evaluation.canonical.outstandingCents, 0);
});

test("historical audit classifies multiple refunds as complex but deterministic", () => {
  const evaluation = evaluateRefundReceivableRecord({
    currentBalanceCents: 0,
    currentPaidAmountCents: 20_000,
    currentStatus: "PAID",
    payments: [
      {
        amount: 200,
        id: "payment-1",
        refunds: [
          { amount: 10, id: "refund-1" },
          { amount: 15, id: "refund-2" },
        ],
        status: "ACTIVE",
      },
    ],
    totalCents: 20_000,
  });

  assert.equal(evaluation.complex, true);
  assert.equal(evaluation.refundCount, 2);
  assert.equal(evaluation.differsFromCanonical, false);
});
