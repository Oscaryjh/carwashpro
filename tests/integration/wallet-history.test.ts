import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { reverseWalletTopUp } from "../../src/lib/wallet/reversals";
import { getWalletHistory } from "../../src/lib/wallet/ui-adapter";

const db = walletTestDatabase();
after(() => db.$disconnect());

test("ledger history groups all seven UAT activities with signed deltas and original ending balances", async () => {
  const h = await checkoutHarness();
  try {
    const f = await walletFixture(db, "1000", "100");
    const firstTop = await postWalletTopUp(f.ctx, f.input, db);
    await h.login(db, f);
    const product = await db.product.create({ data: { businessId: f.business.id, name: "History synthetic", price: 180 } });
    for (const [price, wallet, method] of [[180, "180", "MEMBER_WALLET"], [300, "200", "CARD"]] as const) {
      await db.product.update({ where: { id: product.id }, data: { price } });
      const form = new FormData();
      for (const [key, value] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, productId: product.id, productQuantity: "1", method, walletAmount: wallet, paymentMethodCode: method === "MEMBER_WALLET" ? method : "BUILTIN_CARD", ...(method === "CARD" ? { reference: "Synthetic" } : {}) })) form.set(key, value);
      const result = await h.action.completeCashierSaleAction(form);
      assert.equal(result.status, "success", result.message);
    }
    const invoice = await db.invoice.findFirstOrThrow({ where: { businessId: f.business.id, total: 300 }, include: { payments: true } });
    for (let i = 0; i < 2; i++) await refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: invoice.id, reason: "History synthetic", stockLines: [], legs: invoice.payments.map(p => ({ paymentId: p.id, amountCents: p.method === "MEMBER_WALLET" ? 10000 : 5000, method: p.method as "MEMBER_WALLET" | "CARD", reference: "Synthetic" })) }, db);
    const top = await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
    await reverseWalletTopUp(f.ctx, { operationKey: randomUUID(), topUpId: top.topUpId, reason: "History synthetic" }, db);
    const where = { businessId: f.business.id };
    const before = await db.walletTransaction.findMany({ where, orderBy: { sequence: "asc" } });
    const accountBefore = await db.walletAccount.findMany({ where });
    const history = await getWalletHistory(f.ctx, f.customer.id, 0, db);
    assert.equal(history.rows.length, 7, "history must not silently omit payment/refund/reversal ledger facts");
    assert.deepEqual(history.rows.map(r => [r.type, r.amount, r.balanceAfter, r.paidAmount, r.bonusAmount]), [
      ["Top-up reversal", "-1100.00", "920.00", "-1000.00", "-100.00"],
      ["Top-up", "1100.00", "2020.00", "1000.00", "100.00"],
      ["Refund", "100.00", "920.00", "100.00", "0.00"],
      ["Refund", "100.00", "820.00", "100.00", "0.00"],
      ["Payment", "-200.00", "720.00", "-200.00", "0.00"],
      ["Payment", "-180.00", "920.00", "-80.00", "-100.00"],
      ["Top-up", "1100.00", "1100.00", "1000.00", "100.00"],
    ]);
    assert.equal(new Set(history.rows.map(r => r.id)).size, 7);
    assert.equal(history.hasMore, false);
    assert.deepEqual(new Set(history.reversalSources.map(row => row.id)), new Set([firstTop.topUpId, top.topUpId]));
    assert.ok(history.reversalSources.every(source => !history.rows.some(row => row.id === source.id)), "activity operation IDs must never become top-up command IDs");
    assert.match(history.rows[2].source, new RegExp(`Invoice #${invoice.invoiceNumber}`));
    assert.match(history.rows[0].source, /Synthetic offer/);
    for (const row of history.rows) assert.doesNotMatch(row.source, /[a-f0-9]{8}-[a-f0-9]{4}-|\{|REDEMPTION/);
    assert.deepEqual(await db.walletTransaction.findMany({ where, orderBy: { sequence: "asc" } }), before);
    assert.deepEqual(await db.walletAccount.findMany({ where }), accountBefore);
  } finally { await h.close(); }
});

test("invoice void restoration is a positive Refund, never a top-up reversal command", async () => {
  const h = await checkoutHarness();
  try {
    const f = await walletFixture(db, "50", "30");
    await postWalletTopUp(f.ctx, f.input, db); await h.login(db, f);
    const service = await db.service.create({ data: { businessId: f.business.id, name: "History void synthetic", price: 40, taxable: false } });
    const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id, customerId: f.customer.id, serviceId: service.id, serviceQuantity: "1", appointmentId: visit.id, assignedStaffId: f.actor.id, method: "MEMBER_WALLET", paymentMethodCode: "MEMBER_WALLET", walletAmount: "40" })) form.set(key, value);
    const sale = await h.action.completeCashierSaleAction(form); assert.equal(sale.status, "success", sale.message);
    const voidForm = new FormData(); voidForm.set("invoiceId", sale.invoice!.id); voidForm.set("operationId", randomUUID()); voidForm.set("voidReason", "History synthetic correction");
    const result = await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, voidForm); assert.equal(result.status, "success", result.message);
    const history = await getWalletHistory(f.ctx, f.customer.id, 0, db);
    assert.deepEqual([history.rows[0].type, history.rows[0].amount, history.rows[0].balanceAfter, history.rows[0].paidAmount, history.rows[0].bonusAmount], ["Refund", "40.00", "80.00", "10.00", "30.00"]);
    assert.match(history.rows[0].source, /Invoice void · Invoice #/);
    assert.equal(history.reversalSources.length, 1);
  } finally { await h.close(); }
});

test("pagination happens after grouping, with complete bonus pairs and no duplicate activities", async () => {
  const f = await walletFixture(db, "1", "0.50");
  for (let i = 0; i < 21; i++) await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
  const first = await getWalletHistory(f.ctx, f.customer.id, 0, db);
  const second = await getWalletHistory(f.ctx, f.customer.id, 1, db);
  assert.equal(first.rows.length, 20); assert.equal(first.hasMore, true);
  assert.equal(second.rows.length, 1); assert.equal(second.hasMore, false);
  assert.equal(first.rows[0].balanceAfter, "31.50");
  assert.equal(second.rows[0].balanceAfter, "1.50");
  for (const row of [...first.rows, ...second.rows]) assert.deepEqual([row.amount, row.paidAmount, row.bonusAmount], ["1.50", "1.00", "0.50"]);
  assert.equal(new Set([...first.rows, ...second.rows].map(r => r.id)).size, 21);
  assert.equal((await getWalletHistory(f.ctx, f.customer.id, 2, db)).rows.length, 0);
});
