import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { getBusinessDayRange } from "../../src/lib/business-day";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";

const range = getBusinessDayRange({ fromDateValue: "2026-10-04", toDateValue: "2026-10-05", timezone: "Asia/Singapore", businessDayCutoffTime: "04:00" });
async function read(page: number, refunded = 0, status = "PAID", selectedDay = "2026-10-04") {
  const queries: Prisma.InvoiceFindManyArgs[] = [];
  const rows = Array.from({ length: 41 }, (_, i) => ({
    id: `invoice-${i}`, invoiceNumber: String(1000 + i), branchId: "branch",
    issuedAt: new Date("2026-10-04T05:00:00Z"), subtotal: 96, total: 96,
    discountAmount: 0, loyaltyDiscountAmount: 0, tipAmount: 0, balance: 0, status,
    customer: { name: "Customer" }, appointment: { assignedStaff: { name: "Staff" } },
    payments: [{ method: "CASH", amount: 96, status: "ACTIVE", paymentMethodLabel: null, businessPaymentMethod: null, refunds: [{ amount: refunded }] }],
  }));
  const db = {
    invoice: { findMany: async (args: Prisma.InvoiceFindManyArgs) => {
      queries.push(args);
      return args.take ? rows.slice(args.skip ?? 0, (args.skip ?? 0) + args.take) : rows;
    } },
    payment: { findMany: async () => [] }, paymentRefund: { findMany: async () => [] }, walletTransaction: { findMany: async () => [] },
  } as unknown as Parameters<typeof getDailySalesReport>[1];
  const report = await getDailySalesReport({ businessId: "business", branchId: "branch", range, selectedDay, transactionPage: page }, db);
  return { report, queries };
}

test("day detail reads 21, displays 20 and keeps tenant/date/VOID scope and stable order", async () => {
  const { report, queries } = await read(1);
  assert.equal(report.selectedDay?.transactions.length, 20);
  assert.equal(report.selectedDay?.hasNext, true);
  assert.equal(report.selectedDay?.page, 1);
  const query = queries.at(-1)!;
  assert.equal(query.take, 21);
  assert.equal(query.skip, 0);
  assert.deepEqual(query.orderBy, [{ issuedAt: "desc" }, { id: "desc" }]);
  const day = getBusinessDayRange({ fromDateValue: "2026-10-04", toDateValue: "2026-10-04", timezone: range.timezone, businessDayCutoffTime: range.businessDayCutoffTime });
  assert.deepEqual(query.where, { businessId: "business", branchId: "branch", status: { not: "VOID" }, issuedAt: { gte: day.fromDate, lt: day.toDateExclusive } });
});
test("page 2 skips 20 without changing period aggregates", async () => {
  const first = await read(1); const second = await read(2);
  assert.equal(second.queries.at(-1)?.skip, 20);
  assert.equal(second.report.selectedDay?.transactions[0].id, "invoice-20");
  assert.deepEqual(second.report.summary, first.report.summary);
  assert.deepEqual(second.report.days, first.report.days);
  assert.deepEqual(second.report.paymentMethods, first.report.paymentMethods);
});
for (const page of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  test(`invalid transaction page ${page} normalizes to 1`, async () => {
    assert.equal((await read(page)).report.selectedDay?.page, 1);
  });
}
test("beyond-last page is safely empty and has no next page", async () => {
  const { report } = await read(4);
  assert.deepEqual(report.selectedDay?.transactions, []);
  assert.equal(report.selectedDay?.hasNext, false);
  assert.equal(report.selectedDay?.page, 4);
});
test("out-of-range explicit day does not read transactions", async () => {
  const { report, queries } = await read(1, 0, "PAID", "2026-10-06");
  assert.equal(report.selectedDay, null);
  assert.equal(queries.some(query => query.take !== undefined), false);
});
for (const [refund, raw, display] of [[0, "PAID", "Paid"], [48, "PAID", "Partially Refunded"], [96, "PAID", "Refunded"], [0, "UNPAID", "Unpaid"], [0, "PARTIAL", "Partial"]] as const) {
  test(`canonical refund ${refund} and raw ${raw} display ${display} without mutating facts`, async () => {
    const row = (await read(1, refund, raw)).report.selectedDay!.transactions[0];
    assert.equal(row.displayStatus, display);
    assert.equal(row.status, raw); assert.equal(row.totalCents, 9600);
    assert.equal(row.paymentLabel, "Cash");
  });
}
