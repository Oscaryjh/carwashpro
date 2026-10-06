import assert from "node:assert/strict";
import test from "node:test";

import { getBusinessDayRange } from "../../src/lib/business-day";
import {
  buildDailySalesReport,
  buildPaymentMethodDetails,
  resolveReportBranchScope,
  type DailySalesInvoiceSource,
  type DailySalesPaymentSource,
  type DailySalesRefundSource,
} from "../../src/lib/reports/daily-sales";

const range = getBusinessDayRange({
  fromDateValue: "2026-08-01",
  toDateValue: "2026-08-03",
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
});

for (const [name, totalDiscount, loyalty, net] of [
  ["points only", 1300, 1300, 8700],
  ["manual only", 500, 0, 9500],
  ["manual plus points", 1800, 1300, 8200],
  ["catalog plus points", 1800, 1300, 8200],
  ["no discount", 0, 0, 10000],
] as const) test(`canonical invoice discount counted once: ${name}`, () => {
  const report = build({ invoices: [invoice("sale", "2026-07-31T20:00:00Z", net, {
    discountCents: totalDiscount, loyaltyDiscountCents: loyalty,
  })] });
  assert.equal(report.summary.discountsCents, totalDiscount);
  assert.equal(report.days[0].discountsCents, totalDiscount);
  assert.equal(report.summary.grossSalesCents, 10000);
  assert.equal(report.summary.netSalesCents, net);
});

test("refunded sale retains its original discount once and refunds remain a separate event", () => {
  const report = build({
    invoices: [invoice("sale", "2026-07-31T20:00:00Z", 8700, {discountCents:1300,loyaltyDiscountCents:1300,status:"REFUNDED"})],
    refunds: [refund("refund", "2026-08-01T20:00:00Z", 8700)],
  });
  assert.equal(report.summary.discountsCents, 1300);
  assert.equal(report.summary.refundsCents, 8700);
  assert.equal(report.summary.netSalesCents, 0);
});

function invoice(
  id: string,
  issuedAt: string,
  totalCents: number,
  options: Partial<DailySalesInvoiceSource> = {},
): DailySalesInvoiceSource {
  return {
    id,
    branchId: "branch-1",
    issuedAt: new Date(issuedAt),
    totalCents,
    tipCents: 0,
    discountCents: 0,
    loyaltyDiscountCents: 0,
    packageVoucherCents: 0,
    balanceCents: 0,
    status: "PAID",
    ...options,
  };
}

function payment(
  id: string,
  paidAt: string,
  amountCents: number,
  label = "Cash",
  options: Partial<DailySalesPaymentSource> = {},
): DailySalesPaymentSource {
  return {
    id,
    branchId: "branch-1",
    invoiceId: id.replace("payment", "invoice"),
    paidAt: new Date(paidAt),
    amountCents,
    isPackage: false,
    label,
    ...options,
  };
}

function refund(
  id: string,
  refundedAt: string,
  amountCents: number,
  label = "Cash",
  options: Partial<DailySalesRefundSource> = {},
): DailySalesRefundSource {
  return {
    id,
    branchId: "branch-1",
    invoiceId: "invoice-1",
    refundedAt: new Date(refundedAt),
    amountCents,
    isPackage: false,
    label,
    ...options,
  };
}

function build(input: {
  branchId?: string | null;
  invoices?: DailySalesInvoiceSource[];
  payments?: DailySalesPaymentSource[];
  refunds?: DailySalesRefundSource[];
}) {
  const report = buildDailySalesReport({
    range,
    invoices: input.invoices ?? [],
    payments: input.payments ?? [],
    refunds: input.refunds ?? [],
    branchId: input.branchId,
  });
  assert.equal(
    report.days.reduce((sum, day) => sum + day.netSalesCents, 0),
    report.summary.netSalesCents,
  );
  assert.equal(
    report.paymentMethods.reduce((sum, method) => sum + method.netCents, 0),
    report.summary.netCollectionsCents,
  );
  return report;
}

test("A: one cash sale reconciles daily sales and collections", () => {
  const report = build({
    invoices: [invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000)],
    payments: [payment("payment-1", "2026-07-31T20:00:00.000Z", 10_000)],
  });
  assert.equal(report.summary.netSalesCents, 10_000);
  assert.equal(report.summary.transactionCount, 1);
  assert.equal(report.paymentMethods[0]?.label, "Cash");
});

test("B: multiple transactions on the same business day are aggregated", () => {
  const report = build({
    invoices: [
      invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000),
      invoice("invoice-2", "2026-08-01T10:00:00.000Z", 5_000),
    ],
  });
  assert.equal(report.days[0]?.transactionCount, 2);
  assert.equal(report.days[0]?.netSalesCents, 15_000);
});

test("C: multiple business days remain individually visible", () => {
  const report = build({
    invoices: [
      invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000),
      invoice("invoice-2", "2026-08-01T20:00:00.000Z", 5_000),
    ],
  });
  assert.deepEqual(
    report.days.map((day) => day.netSalesCents),
    [10_000, 5_000, 0],
  );
});

test("D: dynamic Cash and DuitNow payment methods are separated", () => {
  const report = build({
    payments: [
      payment("payment-1", "2026-07-31T20:00:00.000Z", 6_000),
      payment("payment-2", "2026-07-31T21:00:00.000Z", 4_000, "DuitNow QR"),
    ],
  });
  assert.deepEqual(
    report.paymentMethods.map((method) => method.label).sort(),
    ["Cash", "DuitNow QR"],
  );
});

test("E: split payment stays one sale transaction and two collection methods", () => {
  const report = build({
    invoices: [invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000)],
    payments: [
      payment("payment-1", "2026-07-31T20:00:00.000Z", 6_000),
      payment("payment-2", "2026-07-31T20:01:00.000Z", 4_000, "Card"),
    ],
  });
  assert.equal(report.summary.transactionCount, 1);
  assert.equal(report.paymentMethods.length, 2);
});

test("F: monetary refund follows refund date and reduces sales and collections", () => {
  const report = build({
    invoices: [invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000)],
    payments: [payment("payment-1", "2026-07-31T20:00:00.000Z", 10_000)],
    refunds: [refund("refund-1", "2026-08-01T20:00:00.000Z", 2_000)],
  });
  assert.equal(report.days[1]?.refundsCents, 2_000);
  assert.equal(report.summary.netSalesCents, 8_000);
  assert.equal(report.summary.netCollectionsCents, 8_000);
});

test("G: discounts use the canonical invoice financial formula", () => {
  const report = build({
    invoices: [
      invoice("invoice-1", "2026-07-31T20:00:00.000Z", 9_000, {
        discountCents: 1_000,
      }),
    ],
  });
  assert.equal(report.summary.grossSalesCents, 10_000);
  assert.equal(report.summary.discountsCents, 1_000);
  assert.equal(report.summary.netSalesCents, 9_000);
});

test("H: selected branch includes only that branch's financial events", () => {
  const report = build({
    branchId: "branch-1",
    invoices: [
      invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000),
      invoice("invoice-2", "2026-07-31T20:00:00.000Z", 50_000, {
        branchId: "branch-2",
      }),
    ],
  });
  assert.equal(report.summary.netSalesCents, 10_000);
});

test("I: all-branches scope combines all authorized branches", () => {
  const report = build({
    branchId: null,
    invoices: [
      invoice("invoice-1", "2026-07-31T20:00:00.000Z", 10_000),
      invoice("invoice-2", "2026-07-31T20:00:00.000Z", 50_000, {
        branchId: "branch-2",
      }),
    ],
  });
  assert.equal(report.summary.netSalesCents, 60_000);
});

test("J: explicit unauthorized branch request fails closed instead of becoming the staff branch", () => {
  assert.deepEqual(
    resolveReportBranchScope({
      canViewAllBranches: false,
      requestedBranchId: "branch-2",
      staffBranchId: "branch-1",
      activeBranchIds: ["branch-1", "branch-2"],
    }),
    {
      branchId: null,
      hasAccess: false,
      includesAllBranches: false,
    },
  );
});

for (const canViewAllBranches of [false, true]) {
  for (const requestedBranchId of ["nonexistent", "cross-business", "", "   "]) {
    test(`explicit invalid Reports branch fails closed: broad=${canViewAllBranches}, branch=${JSON.stringify(requestedBranchId)}`, () => {
      assert.deepEqual(resolveReportBranchScope({ canViewAllBranches, requestedBranchId,
        staffBranchId: "branch-1", activeBranchIds: ["branch-1", "branch-2"] }),
      { branchId: null, hasAccess: false, includesAllBranches: false });
    });
  }
}

test("Reports no-param and explicitly authorized scopes retain their defaults", () => {
  assert.deepEqual(resolveReportBranchScope({ canViewAllBranches: false,
    staffBranchId: "branch-1", activeBranchIds: ["branch-1", "branch-2"] }),
  { branchId: "branch-1", hasAccess: true, includesAllBranches: false });
  assert.deepEqual(resolveReportBranchScope({ canViewAllBranches: false, requestedBranchId: "branch-1",
    staffBranchId: "branch-1", activeBranchIds: ["branch-1", "branch-2"] }),
  { branchId: "branch-1", hasAccess: true, includesAllBranches: false });
  assert.deepEqual(resolveReportBranchScope({ canViewAllBranches: true,
    staffBranchId: "branch-1", activeBranchIds: ["branch-1", "branch-2"] }),
  { branchId: null, hasAccess: true, includesAllBranches: true });
  assert.deepEqual(resolveReportBranchScope({ canViewAllBranches: true, requestedBranchId: "branch-2",
    staffBranchId: "branch-1", activeBranchIds: ["branch-1", "branch-2"] }),
  { branchId: "branch-2", hasAccess: true, includesAllBranches: false });
});

test("K: business-day cutoff classifies after-midnight events correctly", () => {
  const report = build({
    invoices: [
      invoice("invoice-1", "2026-08-01T17:30:00.000Z", 10_000),
      invoice("invoice-2", "2026-08-01T18:30:00.000Z", 20_000),
    ],
  });
  assert.equal(report.days[0]?.netSalesCents, 10_000);
  assert.equal(report.days[1]?.netSalesCents, 20_000);
});

test("L: empty range returns stable zero-value rows", () => {
  const report = build({});
  assert.equal(report.days.length, 3);
  assert.equal(report.summary.netSalesCents, 0);
  assert.equal(report.summary.transactionCount, 0);
  assert.deepEqual(report.paymentMethods, []);
});

test("M: payment drill-down keeps split legs separate and refunds reduce only the matching method", () => {
  const payments = [
    payment("payment-1", "2026-07-31T20:00:00.000Z", 5_000, "Cash", {
      invoiceId: "invoice-1",
      invoiceNumber: "INV-001",
      customerName: "Customer One",
    }),
    payment("payment-2", "2026-07-31T20:01:00.000Z", 15_000, "DuitNow", {
      invoiceId: "invoice-1",
      invoiceNumber: "INV-001",
      customerName: "Customer One",
    }),
  ];
  const refunds = [
    refund("refund-1", "2026-08-01T20:00:00.000Z", 3_000, "DuitNow", {
      invoiceId: "invoice-1",
      invoiceNumber: "INV-001",
      customerName: "Customer One",
      reason: "Customer adjustment",
      processorName: "Amy",
    }),
  ];

  const cashRows = buildPaymentMethodDetails("Cash", payments, refunds);
  const duitNowRows = buildPaymentMethodDetails("DuitNow", payments, refunds);

  assert.equal(cashRows.length, 1);
  assert.equal(cashRows[0]?.grossCents, 5_000);
  assert.equal(duitNowRows.length, 2);
  assert.deepEqual(
    duitNowRows.map((row) => [row.kind, row.grossCents, row.refundCents, row.netCents]),
    [
      ["REFUND", 0, 3_000, -3_000],
      ["PAYMENT", 15_000, 0, 15_000],
    ],
  );
  assert.equal(duitNowRows[0]?.reason, "Customer adjustment");
  assert.equal(duitNowRows[0]?.processorName, "Amy");
});
