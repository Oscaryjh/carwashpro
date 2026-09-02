import assert from "node:assert/strict";
import test from "node:test";

import { getBusinessDayRangeWithPrevious } from "../../src/lib/business-day";
import { calculateAllStoresKpis } from "../../src/lib/business-groups/all-stores-kpi";
import { calculateDailyClosingReport } from "../../src/lib/daily-closing/calculator";
import type { DailyClosingSourceData } from "../../src/lib/daily-closing/types";
import {
  calculateFinancialMetrics,
  FINANCIAL_METRIC_DEFINITIONS,
  FINANCIAL_METRIC_DEFINITION_VERSION,
} from "../../src/lib/financial-metrics";

test("publishes a versioned and explicit financial metric contract", () => {
  assert.equal(FINANCIAL_METRIC_DEFINITION_VERSION, 1);
  assert.equal(
    FINANCIAL_METRIC_DEFINITIONS.grossCollectionsCents.label,
    "Gross collections",
  );
  assert.equal(
    FINANCIAL_METRIC_DEFINITIONS.netCollectionsCents.formula,
    "gross collections - monetary refunds",
  );
});

test("calculates sales, gross and net collections, refunds, and outstanding", () => {
  const metrics = calculateFinancialMetrics({
    invoices: [
      {
        balanceCents: 4_000,
        discountCents: 1_000,
        loyaltyDiscountCents: 500,
        packageVoucherCents: 2_000,
        status: "PARTIAL",
        tipCents: 1_000,
        totalCents: 12_000,
      },
    ],
    payments: [
      { amountCents: 10_000, isPackage: false },
      { amountCents: 2_000, isPackage: true },
    ],
    refunds: [
      { amountCents: 1_500, isPackage: false },
      { amountCents: 2_000, isPackage: true },
    ],
  });

  assert.deepEqual(metrics, {
    averageTransactionValueCents: 7_500,
    discountsCents: 1_500,
    grossCollectionsCents: 10_000,
    grossSalesCents: 10_500,
    netCollectionsCents: 8_500,
    netSalesCents: 7_500,
    outstandingCents: 4_000,
    packageVoucherCents: 2_000,
    recognizedSalesCents: 9_000,
    refundsCents: 1_500,
    tipsCents: 1_000,
    transactionCount: 1,
  });
});

test("refunds reduce collections without creating outstanding on a settled invoice", () => {
  const partialRefund = calculateFinancialMetrics({
    invoices: [
      {
        balanceCents: 0,
        discountCents: 0,
        loyaltyDiscountCents: 0,
        packageVoucherCents: 0,
        status: "PAID",
        tipCents: 0,
        totalCents: 13_500,
      },
    ],
    payments: [{ amountCents: 13_500, isPackage: false }],
    refunds: [{ amountCents: 3_500, isPackage: false }],
  });
  const fullRefund = calculateFinancialMetrics({
    invoices: [
      {
        balanceCents: 0,
        discountCents: 0,
        loyaltyDiscountCents: 0,
        packageVoucherCents: 0,
        status: "REFUNDED",
        tipCents: 0,
        totalCents: 13_500,
      },
    ],
    payments: [{ amountCents: 13_500, isPackage: false }],
    refunds: [{ amountCents: 13_500, isPackage: false }],
  });

  assert.equal(partialRefund.grossCollectionsCents, 13_500);
  assert.equal(partialRefund.refundsCents, 3_500);
  assert.equal(partialRefund.netCollectionsCents, 10_000);
  assert.equal(partialRefund.outstandingCents, 0);
  assert.equal(fullRefund.netCollectionsCents, 0);
  assert.equal(fullRefund.outstandingCents, 0);
});

test("partial-payment refund preserves the original contractual outstanding", () => {
  const metrics = calculateFinancialMetrics({
    invoices: [
      {
        balanceCents: 10_000,
        discountCents: 0,
        loyaltyDiscountCents: 0,
        packageVoucherCents: 0,
        status: "PARTIAL",
        tipCents: 0,
        totalCents: 20_000,
      },
    ],
    payments: [{ amountCents: 10_000, isPackage: false }],
    refunds: [{ amountCents: 3_000, isPackage: false }],
  });

  assert.equal(metrics.grossCollectionsCents, 10_000);
  assert.equal(metrics.refundsCents, 3_000);
  assert.equal(metrics.netCollectionsCents, 7_000);
  assert.equal(metrics.outstandingCents, 10_000);
});

test("Group KPI and Daily Closing produce the same sales and refund values", () => {
  const periods = getBusinessDayRangeWithPrevious({
    fromDateValue: "2026-07-01",
    toDateValue: "2026-07-01",
    timezone: "Asia/Kuching",
    businessDayCutoffTime: "02:00",
  });
  const group = calculateAllStoresKpis({
    businessIds: ["store-1"],
    periods: new Map([["store-1", periods]]),
    invoices: [
      {
        businessId: "store-1",
        discountAmount: "10.00",
        id: "invoice-1",
        issuedAt: new Date("2026-06-30T20:00:00.000Z"),
        loyaltyDiscountAmount: "5.00",
        payments: [{ amount: "20.00" }],
        tipAmount: "10.00",
        total: "120.00",
      },
    ],
    payments: [
      {
        amount: "100.00",
        businessId: "store-1",
        paidAt: new Date("2026-06-30T22:00:00.000Z"),
      },
    ],
    refunds: [
      {
        amount: "15.00",
        businessId: "store-1",
        refundedAt: new Date("2026-07-01T01:00:00.000Z"),
      },
    ],
  }).get("store-1")!.current;
  const closingSource: DailyClosingSourceData = {
    appointments: [],
    customers: [],
    drawerExpensePayouts: [],
    invoices: [
      {
        balanceCents: 0,
        customerId: null,
        discountCents: 1_000,
        id: "invoice-1",
        items: [],
        loyaltyDiscountCents: 500,
        packageVoucherCents: 2_000,
        status: "PAID",
        tipCents: 1_000,
        totalCents: 12_000,
      },
    ],
    packagePurchases: [],
    payments: [
      { amountCents: 10_000, method: "CASH", packageUses: 0 },
    ],
    refunds: [
      {
        amountCents: 1_500,
        method: "CASH",
        packageUsesRestored: 0,
      },
    ],
    shifts: [],
    workOrders: [],
  };
  const closing = calculateDailyClosingReport(
    closingSource,
    periods.current.fromDate,
  );

  assert.equal(group.grossSalesCents, closing.financial.grossSalesCents);
  assert.equal(group.netSalesCents, closing.financial.netSalesCents);
  assert.equal(group.refundsCents, closing.financial.refundsCents);
  assert.equal(group.paymentsCollectedCents, 10_000);
  assert.equal(closing.financial.collectedCents, 8_500);
});

test("rejects non-integer cents before publishing financial results", () => {
  assert.throws(
    () =>
      calculateFinancialMetrics({
        invoices: [],
        payments: [{ amountCents: 10.5, isPackage: false }],
        refunds: [],
      }),
    /integer number of cents/,
  );
});
