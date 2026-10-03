import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { summarizePayments } from "../../src/lib/closing/payment-summary";
import { getDailyClosingReport } from "../../src/lib/daily-closing/query";
import { getCurrentBusinessDateValue } from "../../src/lib/business-day";

const db = walletTestDatabase();
after(() => db.$disconnect());

test("UAT shift 2100 external / 380 wallet reconciles with day 2000 net and unassigned refunds", async () => {
  const h = await checkoutHarness();
  try {
    const f = await walletFixture(db, "1000", "100");
    await postWalletTopUp(f.ctx, f.input, db);
    await h.login(db, f);
    const product = await db.product.create({ data: { businessId: f.business.id, name: "Closing regression synthetic", price: 180 } });
    for (const [price, wallet, method] of [[180, "180", "MEMBER_WALLET"], [300, "200", "CARD"]] as const) {
      await db.product.update({ where: { id: product.id }, data: { price } });
      const form = new FormData();
      for (const [key, value] of Object.entries({ modeAtConfirmation: "ON", shiftId: f.shift.id, operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, productId: product.id, productQuantity: "1", method, walletAmount: wallet, paymentMethodCode: method === "MEMBER_WALLET" ? method : "BUILTIN_CARD", ...(method === "CARD" ? { reference: "Synthetic only" } : {}) })) form.set(key, value);
      const result = await h.action.completeCashierSaleAction(form);
      assert.equal(result.status, "success", result.message);
    }
    const mixed = await db.invoice.findFirstOrThrow({ where: { businessId: f.business.id, total: 300 }, include: { payments: true } });
    for (let i = 0; i < 2; i++) {
      await refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: mixed.id, reason: "Synthetic half refund", stockLines: [], legs: mixed.payments.map(payment => ({ paymentId: payment.id, amountCents: payment.method === "MEMBER_WALLET" ? 10000 : 5000, method: payment.method as "MEMBER_WALLET" | "CARD", reference: "Synthetic only" })) }, db);
    }
    await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
    const shift = await db.cashierShift.findUniqueOrThrow({ where: { id: f.shift.id }, include: { payments: { where: { status: "ACTIVE" } }, refunds: { include: { payment: { select: { purpose: true, method: true } } } } } });
    const shiftSummary = summarizePayments(shift.payments, shift.refunds);
    assert.equal(shiftSummary.grossCollected, "2100.00");
    assert.equal(shiftSummary.collected, "2100.00");
    assert.equal(shiftSummary.walletSettled, "380.00");
    assert.equal(shiftSummary.cashAmount, "2000.00");
    assert.equal(shiftSummary.refunded, "0.00");
    const refunds = await db.paymentRefund.findMany({ where: { businessId: f.business.id } });
    assert.equal(refunds.length, 4);
    assert.ok(refunds.every(row => row.shiftId === null));
    assert.equal(refunds.filter(row => row.method === "CARD").reduce((sum, row) => sum + Number(row.amount), 0), 100);
    const day = getCurrentBusinessDateValue(new Date(), f.business.timezone, f.business.businessDayCutoffTime);
    const closing = await getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY", dateValue: day }, db);
    assert.equal(closing.report.financial.grossSalesCents, 48000);
    assert.equal(closing.report.financial.refundsCents, 30000);
    assert.equal(closing.report.financial.netSalesCents, 18000);
    assert.equal(closing.report.financial.collectedCents, 200000);
    assert.equal(closing.report.paymentMethods.find(row => row.method === "CARD")?.refundCents, 10000);
    assert.equal(closing.report.paymentMethods.find(row => row.method === "CASH")?.netCents, 200000);
    assert.equal(closing.report.wallet?.topUpPrincipalCents, 200000);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 2);
  } finally { await h.close(); }
});
