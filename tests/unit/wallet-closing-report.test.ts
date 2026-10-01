import assert from "node:assert/strict";
import test from "node:test";
import { calculateDailyClosingReport } from "../../src/lib/daily-closing/calculator";
import { buildDailySalesReport } from "../../src/lib/reports/daily-sales";
import { getBusinessDayRange } from "../../src/lib/business-day";
import { calculateDailyStoreSummaryCandidate } from "../../src/lib/analytics/daily-store-summary";
import { calculateAllStoresKpis } from "../../src/lib/business-groups/all-stores-kpi";
import { buildGroupReportTrend } from "../../src/lib/business-groups/group-reports";

test("Closing separates wallet sale, top-up reversal and unassigned cash refund", () => {
  const report = calculateDailyClosingReport({
    appointments: [], customers: [], drawerExpensePayouts: [], packagePurchases: [], shifts: [], workOrders: [],
    invoices: [{ id: "invoice", customerId: null, items: [], status: "PAID", totalCents: 18000, tipCents: 0, discountCents: 0, loyaltyDiscountCents: 0, packageVoucherCents: 0, balanceCents: 0 }],
    payments: [
      { amountCents: 100000, method: "CASH", purpose: "WALLET_TOP_UP", packageUses: 0 },
      { amountCents: 18000, method: "MEMBER_WALLET", purpose: "SALE", packageUses: 0 },
    ],
    refunds: [{ amountCents: 20000, method: "CASH", originalPayment: { purpose: "WALLET_TOP_UP", method: "CASH" }, shiftId: null, packageUsesRestored: 0 }],
  }, new Date("2026-10-01T00:00:00Z"));
  assert.equal(report.financial.netSalesCents, 18000);
  assert.equal(report.financial.collectedCents, 80000);
  assert.equal(report.cashDrawer.unassignedRefundCents, 20000);
  assert.equal(report.wallet?.redemptionsCents, 18000);
  assert.equal(report.paymentMethods.some(row => String(row.method) === "MEMBER_WALLET"), false);
});

test("Analytics stores sales independently from external collections and top-up reversals", () => {
  const at = new Date("2026-10-01T04:00:00Z");
  const candidate = calculateDailyStoreSummaryCandidate({
    businessId: "business", businessDate: "2026-10-01", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00",
    range: { fromDate: new Date("2026-09-30T18:00:00Z"), toDateExclusive: new Date("2026-10-01T18:00:00Z") },
    source: {
      invoices: [{ balance: 0, discountAmount: 0, loyaltyDiscountAmount: 0, payments: [], status: "PAID", tipAmount: 0, total: 300, updatedAt: at }],
      payments: [
        { amount: 200, purpose: "SALE", method: "MEMBER_WALLET", status: "ACTIVE", invoice: { status: "PAID" }, updatedAt: at },
        { amount: 100, purpose: "SALE", method: "CARD", status: "ACTIVE", invoice: { status: "PAID" }, updatedAt: at },
      ],
      refunds: [{ amount: 1000, method: "CASH", payment: { purpose: "WALLET_TOP_UP", method: "CASH" }, invoice: null, updatedAt: at }],
    },
  });
  assert.equal(candidate.netSalesCents, 30000);
  assert.equal(candidate.netCollectionsCents, -90000);
});

test("Daily Sales collections and method details exclude wallet tender, not top-up cash", () => {
  const range = getBusinessDayRange({ fromDateValue: "2026-10-01", toDateValue: "2026-10-01", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" });
  const common = { branchId: "branch", invoiceId: null, paidAt: new Date("2026-10-01T04:00:00Z"), isPackage: false };
  const report = buildDailySalesReport({ range, invoices: [], refunds: [], payments: [
    { ...common, id: "topup", purpose: "WALLET_TOP_UP", method: "CASH", label: "Cash", amountCents: 100000 },
    { ...common, id: "sale", purpose: "SALE", method: "MEMBER_WALLET", label: "Member wallet", amountCents: 18000 },
  ] });
  assert.equal(report.summary.grossCollectionsCents, 100000);
  assert.equal(report.paymentMethods.length, 1);
  assert.equal(report.paymentMethods[0].label, "Cash");
});

test("Group raw KPI preserves wallet classification through its source projection", () => {
  const range = getBusinessDayRange({ fromDateValue: "2026-10-01", toDateValue: "2026-10-01", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" });
  const result = calculateAllStoresKpis({ businessIds: ["business"], periods: new Map([["business", { current: range, previous: getBusinessDayRange({ fromDateValue: "2026-09-30", toDateValue: "2026-09-30", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" }) }]]),
    invoices: [], payments: [{ businessId: "business", paidAt: new Date("2026-10-01T04:00:00Z"), amount: 200, method: "MEMBER_WALLET", purpose: "SALE" }],
    refunds: [{ businessId: "business", refundedAt: new Date("2026-10-01T04:00:00Z"), amount: 1000, method: "CASH", payment: { purpose: "WALLET_TOP_UP", method: "CASH" } }],
  });
  assert.equal(result.get("business")?.current.netSalesCents, 0);
  // Group's existing headline is gross collections, not net collections.
  assert.equal(result.get("business")?.current.paymentsCollectedCents, 0);
});

test("Group trend excludes top-up reversals from sales and wallet from external receipts", () => {
  const range = getBusinessDayRange({ fromDateValue: "2026-10-01", toDateValue: "2026-10-01", timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" });
  const rows = buildGroupReportTrend({ businesses: [{ id: "business", name: "Synthetic", industryType: "SALON_BEAUTY", logoUrl: null, timezone: "Asia/Kuching", businessDayCutoffTime: "02:00", isCurrent: true }], periods: new Map([["business", { current: range, previous: range }]]), invoices: [],
    payments: [{ businessId: "business", paidAt: new Date("2026-10-01T04:00:00Z"), amount: 200, method: "MEMBER_WALLET", purpose: "SALE" }],
    refunds: [{ businessId: "business", refundedAt: new Date("2026-10-01T04:00:00Z"), amount: 1000, method: "CASH", payment: { purpose: "WALLET_TOP_UP", method: "CASH" } }],
  });
  assert.equal(rows[0].netSalesCents, 0);
  assert.equal(rows[0].paymentsCollectedCents, 0);
});
