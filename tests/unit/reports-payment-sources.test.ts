import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { getBusinessDayRange } from "../../src/lib/business-day";
import { getDailySalesReport } from "../../src/lib/reports/daily-sales";

const range = getBusinessDayRange({ fromDateValue: "2026-10-04", toDateValue: "2026-10-04", timezone: "Asia/Singapore", businessDayCutoffTime: "00:00" });
const occurredAt = new Date("2026-10-04T05:00:00Z");
type Leg = { method: PaymentMethod; amount: number; label?: string; status?: "ACTIVE" | "VOID" };

// Only replace database I/O; exercise the actual report queries, projection and metrics.
async function reportFor(legs: Leg[], balance = 0, status = "PAID") {
  const selectedLegs = (where?: Prisma.PaymentWhereInput) => legs.filter(leg => {
    if (where?.status && leg.status === "VOID") return false;
    const method = where?.method;
    if (typeof method === "string") return leg.method === method;
    if (method?.not && typeof method.not === "string") return leg.method !== method.not;
    return true;
  });
  const row = {
    id: "invoice", branchId: "branch", invoiceNumber: "1007", issuedAt: occurredAt,
    subtotal: 4, total: 4, tipAmount: 0, discountAmount: 0, loyaltyDiscountAmount: 0,
    balance, status, customer: { name: "Test customer" }, appointment: null,
  };
  const database = {
    invoice: { findMany: async (args: Prisma.InvoiceFindManyArgs) => [{
      ...row,
      payments: selectedLegs(args.select?.payments && typeof args.select.payments === "object"
        ? args.select.payments.where : undefined).map(leg => ({
        amount: leg.amount, method: leg.method, paymentMethodLabel: leg.label ?? null,
        businessPaymentMethod: null,
      })),
    }] },
    payment: { findMany: async (args: Prisma.PaymentFindManyArgs) => selectedLegs(args.where).map((leg, index) => ({
      id: `payment-${index}`, branchId: "branch", invoiceId: row.id, paidAt: occurredAt,
      purpose: "SALE", amount: leg.amount, method: leg.method,
      paymentMethodLabel: leg.label ?? null, businessPaymentMethod: null,
      invoice: { invoiceNumber: row.invoiceNumber, customer: row.customer },
    })) },
    paymentRefund: { findMany: async () => [] },
    walletTransaction: { findMany: async () => [] },
  } as unknown as Parameters<typeof getDailySalesReport>[1];
  return getDailySalesReport({ businessId: "business", branchId: "branch", range, selectedDay: "2026-10-04" }, database);
}

for (const scenario of [
  { name: "Package only", legs: [{ method: "PACKAGE", amount: 4 }], label: "Package", collections: 0 },
  { name: "Package plus Cash", legs: [{ method: "CASH", amount: 2 }, { method: "PACKAGE", amount: 2 }], label: "Package + Cash", collections: 200 },
  { name: "Package plus Card", legs: [{ method: "CARD", amount: 2 }, { method: "PACKAGE", amount: 2 }], label: "Package + Card", collections: 200 },
  { name: "ordinary Cash", legs: [{ method: "CASH", amount: 4 }], label: "Cash", collections: 400 },
  { name: "Wallet plus Cash", legs: [{ method: "MEMBER_WALLET", amount: 2 }, { method: "CASH", amount: 2 }], label: "Member wallet + Cash", collections: 200 },
  { name: "Cash plus Card", legs: [{ method: "CASH", amount: 2 }, { method: "CARD", amount: 2 }], label: "Cash + Card", collections: 400 },
  { name: "custom external label", legs: [{ method: "CARD", amount: 4, label: "Test terminal" }], label: "Test terminal", collections: 400 },
] satisfies { name: string; legs: Leg[]; label: string; collections: number }[]) {
  test(`Reports settlement display and external collections: ${scenario.name}`, async () => {
    const report = await reportFor(scenario.legs);
    assert.equal(report.selectedDay?.transactions[0]?.paymentLabel, scenario.label);
    assert.equal(report.summary.grossCollectionsCents, scenario.collections);
    assert.equal(report.summary.netCollectionsCents, scenario.collections);
    assert.ok(report.paymentMethods.every(method => !method.label.startsWith("Package")));
    assert.equal(report.summary.netSalesCents, scenario.name === "Package only" ? 0
      : scenario.name.startsWith("Package plus") ? 200 : 400);
  });
}

test("Reports true unpaid invoice has no settlement sources and outstanding balance", async () => {
  assert.equal((await reportFor([], 4, "UNPAID")).selectedDay?.transactions[0]?.paymentLabel, "Unpaid");
});

test("Reports settled invoice without recorded sources is not mislabeled Unpaid", async () => {
  assert.equal((await reportFor([])).selectedDay?.transactions[0]?.paymentLabel, "Not recorded");
});

test("Reports inconsistent paid status with outstanding balance fails to neutral source copy", async () => {
  assert.equal((await reportFor([], 4)).selectedDay?.transactions[0]?.paymentLabel, "Not recorded");
});

test("Reports zero-balance unpaid status is not enough to claim Unpaid", async () => {
  assert.equal((await reportFor([], 0, "UNPAID")).selectedDay?.transactions[0]?.paymentLabel, "Not recorded");
});

test("Reports ignores voided Package settlement sources", async () => {
  assert.equal((await reportFor([{ method: "PACKAGE", amount: 4, status: "VOID" }], 4, "UNPAID")).selectedDay?.transactions[0]?.paymentLabel, "Unpaid");
});
