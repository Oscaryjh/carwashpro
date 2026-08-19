import assert from "node:assert/strict";
import test from "node:test";

import { isValidDateValue } from "../../src/lib/business-time";
import { calculateDailyClosingReport } from "../../src/lib/daily-closing/calculator";
import {
  buildDailyClosingWhatsAppPreview,
  formatMoneyFromCents,
} from "../../src/lib/daily-closing/format";
import { getDailyClosingRange } from "../../src/lib/daily-closing/range";
import {
  buildDailyClosingSnapshotPayload,
  buildFrozenDailyClosingWhatsAppText,
  getExpectedCashCents,
  getSnapshotBusinessDayCutoffTime,
  isDailyClosingSnapshotPayload,
  normalizeBusinessDate,
} from "../../src/lib/daily-closing/snapshot";
import type {
  DailyClosingInvoice,
  DailyClosingSourceData,
} from "../../src/lib/daily-closing/types";

const BUSINESS_DAY_START = new Date("2026-07-22T16:00:00.000Z");

function createSource(
  overrides: Partial<DailyClosingSourceData> = {},
): DailyClosingSourceData {
  return {
    appointments: [],
    customers: [],
    drawerExpensePayouts: [],
    invoices: [],
    packagePurchases: [],
    payments: [],
    refunds: [],
    shifts: [],
    workOrders: [],
    ...overrides,
  };
}

test("POS drawer expense payouts reduce expected closing cash", () => {
  const report = calculateDailyClosingReport(createSource({
    drawerExpensePayouts: [{ amountCents: 2_000 }],
    payments: [{ amountCents: 10_000, method: "CASH", packageUses: 0 }],
  }), BUSINESS_DAY_START);

  assert.equal(report.cashDrawer.expensePayoutCents, 2_000);
  assert.equal(getExpectedCashCents(report), 8_000);
});

function createInvoice(
  overrides: Partial<DailyClosingInvoice> = {},
): DailyClosingInvoice {
  return {
    balanceCents: 0,
    customerId: null,
    discountCents: 0,
    id: "invoice-1",
    items: [],
    loyaltyDiscountCents: 0,
    packageVoucherCents: 0,
    status: "PAID",
    tipCents: 0,
    totalCents: 0,
    ...overrides,
  };
}

test("uses the store cutoff when local time is after midnight", () => {
  const range = getDailyClosingRange(new Date("2026-07-22T16:30:00.000Z"));

  assert.equal(range.dateValue, "2026-07-22");
  assert.equal(range.fromDate.toISOString(), "2026-07-21T18:00:00.000Z");
  assert.equal(range.toDateExclusive.toISOString(), "2026-07-22T18:00:00.000Z");
  assert.equal(range.timeZone, "Asia/Kuching");
  assert.equal(range.businessDayCutoffTime, "02:00");
});

test("uses an explicit requested business date", () => {
  const range = getDailyClosingRange(
    new Date("2026-07-22T16:30:00.000Z"),
    "2026-07-20",
  );

  assert.equal(range.dateValue, "2026-07-20");
  assert.equal(range.fromDate.toISOString(), "2026-07-19T18:00:00.000Z");
  assert.equal(range.toDateExclusive.toISOString(), "2026-07-20T18:00:00.000Z");
});

test("uses an inclusive cutoff and exclusive next-cutoff boundary", () => {
  const range = getDailyClosingRange(
    new Date("2026-07-23T08:00:00.000Z"),
    "2026-07-23",
  );

  assert.equal(range.toDateExclusive.getTime() - range.fromDate.getTime(), 86_400_000);
});

test("uses each store timezone and preserves DST-safe cutoff boundaries", () => {
  const range = getDailyClosingRange(
    new Date("2026-03-08T06:30:00.000Z"),
    "2026-03-08",
    {
      timezone: "America/New_York",
      businessDayCutoffTime: "02:00",
    },
  );

  assert.equal(range.dateValue, "2026-03-08");
  assert.equal(range.fromDate.toISOString(), "2026-03-08T07:00:00.000Z");
  assert.equal(
    range.toDateExclusive.toISOString(),
    "2026-03-09T06:00:00.000Z",
  );
  assert.equal(range.timeZone, "America/New_York");
  assert.equal(range.businessDayCutoffTime, "02:00");
});

test("returns zero totals and a deterministic no-exception alert for an empty day", () => {
  const report = calculateDailyClosingReport(createSource(), BUSINESS_DAY_START);

  assert.deepEqual(report.financial, {
    collectedCents: 0,
    discountsCents: 0,
    grossSalesCents: 0,
    netSalesCents: 0,
    outstandingCents: 0,
    refundsCents: 0,
  });
  assert.equal(report.alerts[0]?.message, "No exceptions detected for this business day.");
});

test("reconstructs gross sales before invoice discount", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          discountCents: 1_000,
          totalCents: 9_000,
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.grossSalesCents, 10_000);
  assert.equal(report.financial.discountsCents, 1_000);
  assert.equal(report.financial.netSalesCents, 9_000);
});

test("includes loyalty discount in the discount total", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          loyaltyDiscountCents: 500,
          totalCents: 9_500,
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.grossSalesCents, 10_000);
  assert.equal(report.financial.discountsCents, 500);
});

test("does not count package voucher value as cash sales", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          packageVoucherCents: 7_420,
          totalCents: 7_420,
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.grossSalesCents, 0);
  assert.equal(report.financial.netSalesCents, 0);
});

test("does not count tips as gross or net sales", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          tipCents: 1_000,
          totalCents: 11_000,
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.grossSalesCents, 10_000);
  assert.equal(report.financial.netSalesCents, 10_000);
});

test("calculates collected cash from payments less monetary refunds", () => {
  const report = calculateDailyClosingReport(
    createSource({
      payments: [
        { amountCents: 10_000, method: "CASH", packageUses: 0 },
        { amountCents: 5_000, method: "CARD", packageUses: 0 },
      ],
      refunds: [
        { amountCents: 2_000, method: "CASH", packageUsesRestored: 0 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.collectedCents, 13_000);
  assert.equal(report.financial.refundsCents, 2_000);
});

test("subtracts monetary refunds from net sales", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [createInvoice({ totalCents: 10_000 })],
      refunds: [
        { amountCents: 2_500, method: "EWALLET", packageUsesRestored: 0 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.netSalesCents, 7_500);
});

test("does not treat restored package uses as a monetary refund", () => {
  const report = calculateDailyClosingReport(
    createSource({
      refunds: [
        { amountCents: 7_000, method: "PACKAGE", packageUsesRestored: 1 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.refundsCents, 0);
  assert.equal(report.financial.collectedCents, 0);
});

test("sums outstanding balances from unpaid and partial invoices only", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({ balanceCents: 4_000, id: "unpaid", status: "UNPAID" }),
        createInvoice({ balanceCents: 2_000, id: "partial", status: "PARTIAL" }),
        createInvoice({ balanceCents: 9_000, id: "paid", status: "PAID" }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.financial.outstandingCents, 6_000);
});

test("counts invoice payment statuses", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({ id: "paid", status: "PAID" }),
        createInvoice({ id: "partial", status: "PARTIAL" }),
        createInvoice({ id: "unpaid", status: "UNPAID" }),
        createInvoice({ id: "refunded", status: "REFUNDED" }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.deepEqual(report.invoiceCounts, {
    paid: 1,
    partial: 1,
    refunded: 1,
    total: 4,
    unpaid: 1,
  });
});

test("reports each real payment method separately", () => {
  const report = calculateDailyClosingReport(
    createSource({
      payments: [
        { amountCents: 1_000, method: "CASH", packageUses: 0 },
        { amountCents: 2_000, method: "DUITNOW", packageUses: 0 },
        { amountCents: 3_000, method: "BANK_TRANSFER", packageUses: 0 },
      ],
      refunds: [
        { amountCents: 500, method: "DUITNOW", packageUsesRestored: 0 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.paymentMethods.find((item) => item.method === "CASH")?.netCents, 1_000);
  assert.equal(
    report.paymentMethods.find((item) => item.method === "DUITNOW")?.netCents,
    1_500,
  );
  assert.equal(
    report.paymentMethods.find((item) => item.method === "BANK_TRANSFER")?.netCents,
    3_000,
  );
});

test("top services include only items linked to completed operations", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          items: [
            {
              completedOperation: true,
              name: "Haircut",
              quantity: 1,
              salesCents: 7_000,
              serviceId: "haircut",
            },
            {
              completedOperation: false,
              name: "Future Facial",
              quantity: 1,
              salesCents: 12_000,
              serviceId: "facial",
            },
          ],
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.deepEqual(report.topServices.map((item) => item.serviceId), ["haircut"]);
});

test("top services exclude products even on a completed operation", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          items: [
            {
              completedOperation: true,
              name: "Shampoo",
              quantity: 2,
              salesCents: 6_000,
              serviceId: null,
            },
          ],
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.topServices.length, 0);
});

test("top services aggregate quantities and keep only the highest three", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [
        createInvoice({
          items: [
            completedService("a", "A", 1, 1_000),
            completedService("b", "B", 1, 4_000),
            completedService("c", "C", 1, 3_000),
            completedService("d", "D", 1, 2_000),
            completedService("b", "B", 2, 2_000),
          ],
        }),
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.deepEqual(
    report.topServices.map((item) => [item.serviceId, item.quantity, item.salesCents]),
    [
      ["b", 3, 6_000],
      ["c", 1, 3_000],
      ["d", 1, 2_000],
    ],
  );
});

test("counts Salon completed, cancelled, and distinct customers served", () => {
  const report = calculateDailyClosingReport(
    createSource({
      appointments: [
        { customerId: "customer-1", status: "COMPLETED" },
        { customerId: "customer-1", status: "COMPLETED" },
        { customerId: "customer-2", status: "CANCELLED" },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.operations.completed, 2);
  assert.equal(report.operations.cancelled, 1);
  assert.equal(report.operations.customersServed, 1);
});

test("counts distinct vehicles served for Auto operations", () => {
  const report = calculateDailyClosingReport(
    createSource({
      workOrders: [
        { customerId: "customer-1", status: "COMPLETED", vehicleId: "vehicle-1" },
        { customerId: "customer-1", status: "COMPLETED", vehicleId: "vehicle-1" },
        { customerId: "customer-2", status: "COMPLETED", vehicleId: "vehicle-2" },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.operations.completed, 3);
  assert.equal(report.operations.customersServed, 2);
  assert.equal(report.operations.vehiclesServed, 2);
});

test("classifies served customers as new or returning", () => {
  const report = calculateDailyClosingReport(
    createSource({
      appointments: [
        { customerId: "new", status: "COMPLETED" },
        { customerId: "returning", status: "COMPLETED" },
      ],
      customers: [
        { createdAt: new Date("2026-07-22T17:00:00.000Z"), id: "new" },
        { createdAt: new Date("2026-07-01T00:00:00.000Z"), id: "returning" },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.operations.newCustomers, 1);
  assert.equal(report.operations.returningCustomers, 1);
});

test("calculates average net sales per completed operation", () => {
  const report = calculateDailyClosingReport(
    createSource({
      appointments: [
        { customerId: "a", status: "COMPLETED" },
        { customerId: "b", status: "COMPLETED" },
      ],
      invoices: [createInvoice({ totalCents: 15_001 })],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.operations.averageSpendCents, 7_501);
});

test("summarizes packages sold and their sales amount", () => {
  const report = calculateDailyClosingReport(
    createSource({
      packagePurchases: [
        { amountCents: 10_000, id: "package-1" },
        { amountCents: 15_000, id: "package-2" },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.packages.sold, 2);
  assert.equal(report.packages.amountCents, 25_000);
});

test("calculates net package redemptions after restored uses", () => {
  const report = calculateDailyClosingReport(
    createSource({
      payments: [
        { amountCents: 0, method: "PACKAGE", packageUses: 3 },
      ],
      refunds: [
        { amountCents: 0, method: "PACKAGE", packageUsesRestored: 1 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(report.packages.redemptions, 2);
});

test("creates deterministic alerts for unsettled invoices, refunds, cash differences, and open shifts", () => {
  const report = calculateDailyClosingReport(
    createSource({
      invoices: [createInvoice({ status: "PARTIAL" })],
      refunds: [
        { amountCents: 1_000, method: "CASH", packageUsesRestored: 0 },
      ],
      shifts: [
        { cashDifferenceCents: 500, isOpen: false },
        { cashDifferenceCents: null, isOpen: true },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.deepEqual(
    report.alerts.map((alert) => alert.message),
    [
      "1 invoice remain unpaid or partially paid.",
      "Refund activity was recorded during this business day.",
      "1 closed shift have a cash difference.",
      "1 cashier shift is still open.",
    ],
  );
});

test("formats all money values with RM and two decimal places", () => {
  assert.equal(formatMoneyFromCents(12_345), "RM123.45");
  assert.equal(formatMoneyFromCents(-50), "-RM0.50");
  assert.equal(formatMoneyFromCents(0), "RM0.00");
});

test("builds a fixed WhatsApp preview with real payment split and top services", () => {
  const report = calculateDailyClosingReport(
    createSource({
      appointments: [{ customerId: "customer-1", status: "COMPLETED" }],
      invoices: [
        createInvoice({
          items: [completedService("haircut", "Haircut", 2, 14_000)],
          totalCents: 14_000,
        }),
      ],
      packagePurchases: [{ amountCents: 20_000, id: "package-1" }],
      payments: [
        { amountCents: 10_000, method: "CASH", packageUses: 0 },
        { amountCents: 4_000, method: "DUITNOW", packageUses: 0 },
      ],
    }),
    BUSINESS_DAY_START,
  );
  const preview = buildDailyClosingWhatsAppPreview({
    branchName: "Kuching Branch",
    businessName: "Tetamu Wellness",
    dateValue: "2026-07-23",
    industry: "SALON_BEAUTY",
    report,
  });

  assert.match(preview, /\*Daily Closing - Tetamu Wellness\*/);
  assert.match(preview, /Cash: RM100\.00/);
  assert.match(preview, /DuitNow QR: RM40\.00/);
  assert.match(preview, /1\. Haircut x2 \(RM140\.00\)/);
  assert.match(preview, /Packages sold: 1 \(RM200\.00\)/);
});

test("WhatsApp preview explicitly shows when no payments were collected", () => {
  const report = calculateDailyClosingReport(createSource(), BUSINESS_DAY_START);
  const preview = buildDailyClosingWhatsAppPreview({
    branchName: "Kuching Branch",
    businessName: "Tetamu Wellness",
    dateValue: "2026-07-23",
    industry: "SALON_BEAUTY",
    report,
  });

  assert.match(preview, /No payments collected/);
});

test("uses net cash collected as the expected closing cash", () => {
  const report = calculateDailyClosingReport(
    createSource({
      payments: [
        { amountCents: 15_000, method: "CASH", packageUses: 0 },
        { amountCents: 8_000, method: "CARD", packageUses: 0 },
      ],
      refunds: [
        { amountCents: 2_500, method: "CASH", packageUsesRestored: 0 },
        { amountCents: 1_000, method: "CARD", packageUsesRestored: 0 },
      ],
    }),
    BUSINESS_DAY_START,
  );

  assert.equal(getExpectedCashCents(report), 12_500);
});

test("normalizes a business date to a database-safe UTC date", () => {
  assert.equal(
    normalizeBusinessDate("2026-07-23").toISOString(),
    "2026-07-23T00:00:00.000Z",
  );
});

test("rejects impossible business dates instead of rolling them into another month", () => {
  assert.equal(isValidDateValue("2026-02-28"), true);
  assert.equal(isValidDateValue("2028-02-29"), true);
  assert.equal(isValidDateValue("2026-02-29"), false);
  assert.equal(isValidDateValue("2026-02-31"), false);
  assert.equal(isValidDateValue("23-07-2026"), false);
});

test("freezes report, cash reconciliation, closer, and timezone in one payload", () => {
  const report = calculateDailyClosingReport(
    createSource({
      payments: [{ amountCents: 10_000, method: "CASH", packageUses: 0 }],
    }),
    BUSINESS_DAY_START,
  );
  const payload = buildDailyClosingSnapshotPayload({
    actualCashCents: 9_800,
    branch: { id: "branch-1", name: "Kuching Branch" },
    business: { id: "business-1", name: "Tetamu Wellness" },
    businessDate: "2026-07-23",
    businessDayCutoffTime: "02:00",
    businessType: "SALON_BEAUTY",
    closedAt: new Date("2026-07-23T10:05:00.000Z"),
    closedBy: { id: "user-1", name: "Oscar" },
    closingNote: "RM2 short after recount.",
    expectedCashCents: 10_000,
    generatedAt: new Date("2026-07-23T10:04:00.000Z"),
    report,
    timezone: "Asia/Kuching",
  });

  assert.equal(payload.cash.differenceCents, -200);
  assert.equal(payload.timezone, "Asia/Kuching");
  assert.equal(payload.businessDayCutoffTime, "02:00");
  assert.equal(payload.businessDayDefinitionVersion, 1);
  assert.equal(payload.metricDefinitionVersion, 1);
  assert.equal(payload.version, 2);
  assert.equal(payload.report.paymentMethods[0]?.netCents, 10_000);
  assert.equal(isDailyClosingSnapshotPayload(payload), true);
  const legacyPayload = {
    ...payload,
    businessDayCutoffTime: undefined,
    businessDayDefinitionVersion: undefined,
    metricDefinitionVersion: undefined,
    version: 1,
  };
  assert.equal(isDailyClosingSnapshotPayload(legacyPayload), true);
  assert.equal(getSnapshotBusinessDayCutoffTime(legacyPayload), "00:00");
  assert.equal(isDailyClosingSnapshotPayload({ version: 1 }), false);
});

test("freezes the WhatsApp summary together with cash reconciliation", () => {
  const report = calculateDailyClosingReport(createSource(), BUSINESS_DAY_START);
  const payload = buildDailyClosingSnapshotPayload({
    actualCashCents: 9_800,
    branch: { id: "branch-1", name: "Kuching Branch" },
    business: { id: "business-1", name: "Tetamu Wellness" },
    businessDate: "2026-07-23",
    businessDayCutoffTime: "02:00",
    businessType: "SALON_BEAUTY",
    closedAt: new Date("2026-07-23T10:05:00.000Z"),
    closedBy: { id: "user-1", name: "Oscar" },
    closingNote: "RM2 short after recount.",
    expectedCashCents: 10_000,
    generatedAt: new Date("2026-07-23T10:04:00.000Z"),
    report,
    timezone: "Asia/Kuching",
  });
  const text = buildFrozenDailyClosingWhatsAppText({
    baseText: "*Daily Closing - Tetamu Wellness*",
    payload,
  });

  assert.match(text, /Expected cash: RM100\.00/);
  assert.match(text, /Actual cash: RM98\.00/);
  assert.match(text, /Difference: -RM2\.00/);
  assert.match(text, /Note: RM2 short after recount\./);
  assert.match(text, /Closed by: Oscar/);
  assert.match(text, /Closed at: 23 Jul 2026, 6:05 pm/);
  assert.doesNotMatch(text, /2026-07-23T10:05:00\.000Z/);
});

function completedService(
  serviceId: string,
  name: string,
  quantity: number,
  salesCents: number,
) {
  return {
    completedOperation: true,
    name,
    quantity,
    salesCents,
    serviceId,
  };
}
