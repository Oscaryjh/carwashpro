import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase, assertNoWalletMoney } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { getWalletSummary } from "../../src/lib/wallet/read-model";
import { getWalletHistory, listWalletOffers, saveWalletOffer } from "../../src/lib/wallet/ui-adapter";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function production(ids: string, run: () => Promise<void>) {
  const values = { APP_ENVIRONMENT: "production", RAILWAY_ENVIRONMENT_NAME: "production", TETAMU_ENVIRONMENT: "PRODUCTION", NODE_ENV: "production",
    TETAMU_WALLET_PRODUCTION_PILOT: "true", TETAMU_WALLET_PRODUCTION_BUSINESS_IDS: ids };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { await run(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}
const denied = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "WALLET_UNAVAILABLE";

test("Production server gate controls top-up, summary, offers, history and completed top-up replay", async () => {
  const a = await walletFixture(db), b = await walletFixture(db);
  await production(a.business.id, async () => {
    const posted = await postWalletTopUp(a.ctx, a.input, db);
    assert.equal((await postWalletTopUp(a.ctx, a.input, db)).topUpId, posted.topUpId);
    assert.equal((await getWalletSummary(a.ctx, a.customer.id, db)).totalBalance, "1100.00");
    assert.equal((await getWalletHistory(a.ctx, a.customer.id, 0, db)).rows.length, 1);
    assert.equal((await listWalletOffers(a.ctx, db)).length, 1);
    await assert.rejects(postWalletTopUp(b.ctx, b.input, db), denied);
    await assert.rejects(getWalletSummary(b.ctx, b.customer.id, db), denied);
    await assert.rejects(getWalletHistory(b.ctx, b.customer.id, 0, db), denied);
    await assert.rejects(listWalletOffers(b.ctx, db), denied);
    await assert.rejects(saveWalletOffer(b.ctx, { name: "Denied offer", paidAmount: "1", bonusAmount: "0", active: true }, db), denied);
    await assertNoWalletMoney(db, b.business.id);
    process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = b.business.id;
    await assert.rejects(postWalletTopUp(a.ctx, a.input, db), denied);
    await assert.rejects(getWalletSummary(a.ctx, a.customer.id, db), denied);
    assert.equal(await db.walletTopUp.count({ where: { businessId: a.business.id } }), 1);
    assert.equal(await db.walletTransaction.count({ where: { businessId: a.business.id } }), 2);
  });
});

test("Production authenticated actions reject business and customer injection without money writes", async () => {
  const a = await walletFixture(db), b = await walletFixture(db), h = await checkoutHarness(db);
  try { await production(a.business.id, async () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(a.input)) form.set(key, String(value));
    await h.login(db, b);
    form.set("businessId", a.business.id);
    form.set("TETAMU_WALLET_PRODUCTION_PILOT", "true");
    form.set("TETAMU_WALLET_PRODUCTION_BUSINESS_IDS", a.business.id);
    const foreignBusiness = await h.wallet.walletTopUpAction(form);
    assert.equal(foreignBusiness.ok, false);
    if (!foreignBusiness.ok) assert.equal(foreignBusiness.code, "WALLET_UNAVAILABLE");
    assert.equal((await h.wallet.walletPanelAction(a.customer.id)).ok, false);
    await h.login(db, a);
    form.set("customerId", b.customer.id);
    const foreignCustomer = await h.wallet.walletTopUpAction(form);
    assert.equal(foreignCustomer.ok, false);
    if (!foreignCustomer.ok) assert.equal(foreignCustomer.code, "WALLET_CUSTOMER_NOT_FOUND");
    assert.equal((await h.wallet.walletPanelAction(b.customer.id)).ok, false);
    await assertNoWalletMoney(db, a.business.id);
    await assertNoWalletMoney(db, b.business.id);
  }); } finally { await h.close(); }
});

for (const method of ["MEMBER_WALLET", "CARD"]) test(`Production ${method} checkout and refund recheck allowlist before replay and pending recovery`, async () => {
  const a = await checkoutFixture(db, method), h = await checkoutHarness(db);
  try { await production(a.business.id, async () => {
    await h.login(db, a);
    const sale = await h.action.completeCashierSaleAction(a.form);
    assert.equal(sale.status, "success", sale.message);
    const payments = await db.payment.findMany({ where: { invoiceId: sale.invoice!.id } });
    assert.equal(payments.length, method === "CARD" ? 2 : 1);
    assert.equal(payments.filter(p => p.method === "MEMBER_WALLET").length, 1);
    assert.equal(payments.filter(p => p.method === "CARD").length, method === "CARD" ? 1 : 0);
    const request = { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "Production gate synthetic refund",
      legs: payments.map(p => ({ paymentId: p.id, method: p.method as "MEMBER_WALLET" | "CARD", amountCents: Number(p.amount) * 100,
        ...(p.method === "CARD" ? { reference: "Synthetic card refund" } : {}) })), stockLines: [] };
    process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = "";
    assert.equal((await h.action.completeCashierSaleAction(a.form)).status, "error");
    await assert.rejects(refundWalletSale(a.ctx, request, db), denied);
    assert.equal((await h.wallet.walletRefundOptionsAction(sale.invoice!.id, "invoice")).ok, false);
    assert.equal(await db.paymentRefund.count({ where: { businessId: a.business.id } }), 0);
    process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = a.business.id;
    await refundWalletSale(a.ctx, request, db);
    await refundWalletSale(a.ctx, request, db);
    process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = "";
    await assert.rejects(refundWalletSale(a.ctx, request, db), denied);
    const pendingForm = new FormData(); for (const [key, value] of a.form) pendingForm.append(key, value);
    pendingForm.set("operationId", randomUUID());
    assert.equal((await h.action.completeCashierSaleAction(pendingForm)).status, "error");
    assert.equal(await db.invoice.count({ where: { businessId: a.business.id } }), 1);
    assert.equal(await db.paymentRefund.count({ where: { businessId: a.business.id } }), payments.length);
    assert.equal(await db.walletTransaction.count({ where: { businessId: a.business.id, type: "REFUND" } }), 1);
  }); } finally { await h.close(); }
});

test("Production reversal completed replay and pending recovery deny after allowlist removal", async () => {
  const a = await checkoutFixture(db), h = await checkoutHarness(db);
  const topUp = await db.walletTopUp.findFirstOrThrow({ where: { businessId: a.business.id } });
  const request = { operationKey: randomUUID(), topUpId: topUp.id, reason: "Production gate reversal" };
  try { await production(a.business.id, async () => {
    await h.login(db, a);
    await reverseWalletTopUp(a.ctx, request, db);
    await reverseWalletTopUp(a.ctx, request, db);
    process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = "";
    await assert.rejects(reverseWalletTopUp(a.ctx, request, db), denied);
    await assert.rejects(reverseWalletTopUp(a.ctx, { ...request, operationKey: randomUUID() }, db), denied);
    const recovery = await h.wallet.walletRefundOptionsAction(topUp.id, "top-up");
    assert.equal(recovery.ok, false);
    if (!recovery.ok) assert.equal(recovery.code, "WALLET_UNAVAILABLE");
    assert.equal(await db.walletTopUpReversal.count({ where: { businessId: a.business.id } }), 1);
  }); } finally { await h.close(); }
});

test("Production Wallet invoice void and completed replay require the current gate", async () => {
  const a = await checkoutFixture(db), h = await checkoutHarness(db);
  try {
    const service = await db.service.create({ data: { businessId: a.business.id, name: "Production gate service", price: 40, taxable: false } });
    const appointment = await db.appointment.create({ data: { businessId: a.business.id, branchId: a.branch.id, customerId: a.customer.id,
      assignedStaffId: a.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    a.form.delete("productId"); a.form.delete("productQuantity");
    a.form.set("serviceId", service.id); a.form.set("serviceQuantity", "1");
    a.form.set("appointmentId", appointment.id); a.form.set("assignedStaffId", a.actor.id);
    await production(a.business.id, async () => {
      await h.login(db, a);
      const sale = await h.action.completeCashierSaleAction(a.form); assert.equal(sale.status, "success", sale.message);
      const form = new FormData(); form.set("invoiceId", sale.invoice!.id); form.set("operationId", randomUUID()); form.set("voidReason", "Synthetic correction");
      process.env.TETAMU_WALLET_PRODUCTION_PILOT = "false";
      assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form)).status, "error");
      assert.equal(await db.walletTransaction.count({ where: { businessId: a.business.id, type: "REVERSAL" } }), 0);
      process.env.TETAMU_WALLET_PRODUCTION_PILOT = "true";
      assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form)).status, "success");
      process.env.TETAMU_WALLET_PRODUCTION_BUSINESS_IDS = "";
      assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form)).status, "error");
      assert.equal(await db.walletTransaction.count({ where: { businessId: a.business.id, type: "REVERSAL" } }), 1);
    });
  } finally { await h.close(); }
});

test("Production pilot disabled does not block ordinary Cash/Card sales or non-Wallet refunds", async () => {
  const a = await checkoutFixture(db), h = await checkoutHarness(db);
  try { await production("", async () => {
    process.env.TETAMU_WALLET_PRODUCTION_PILOT = "false";
    await h.login(db, a);
    for (const method of ["CASH", "CARD"]) {
      const form = new FormData(); for (const [key, value] of a.form) form.append(key, value);
      form.delete("walletAmount"); form.set("method", method); form.set("paymentMethodCode", `BUILTIN_${method}`);
      form.set("operationId", randomUUID()); if (method === "CARD") form.set("reference", "Synthetic card");
      const sale = await h.action.completeCashierSaleAction(form); assert.equal(sale.status, "success", sale.message);
      const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id } });
      const refund = new FormData();
      for (const [key, value] of Object.entries({ invoiceId: sale.invoice!.id, paymentId: payment.id, operationId: randomUUID(),
        amount: "1", method, reference: "Synthetic refund", reason: "Ordinary regression" })) refund.set(key, value);
      const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, refund);
      assert.equal(result.status, "success", result.message);
    }
    assert.equal(await db.paymentRefund.count({ where: { businessId: a.business.id } }), 2);
    assert.equal(await db.walletTransaction.count({ where: { businessId: a.business.id, type: "REDEMPTION" } }), 0);
  }); } finally { await h.close(); }
});
