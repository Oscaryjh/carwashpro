import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable runner required");
const db = walletTestDatabase();
process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
after(() => db.$disconnect());

async function fixture(split = false, enabled = false) {
  const f = await walletFixture(db);
  await postWalletTopUp(f.ctx, f.input, db);
  if (!enabled) {
    await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED", endedAt: new Date() } });
    await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: false } });
  }
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Package benefit", price: 50 } });
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Wallet package", price: 200, totalUses: 5, serviceId: service.id } });
  const form = new FormData();
  for (const [key, value] of Object.entries({ operationId: randomUUID(), branchId: f.branch.id,
    customerId: f.customer.id, modeAtConfirmation: enabled ? "ON" : "OFF", shiftId: enabled ? f.shift.id : "",
    method: split ? "CASH" : "MEMBER_WALLET", paymentMethodCode: split ? "BUILTIN_CASH" : "MEMBER_WALLET",
    walletAmount: split ? "100" : "200", packageId: pkg.id, packageQuantity: "1",
    performanceAttribution: JSON.stringify({ version: 1, sales: [], unassignedReason: "Disposable package purchase test" }) })) form.set(key, value);
  return { ...f, pkg, form };
}

async function snapshot(businessId: string) {
  const where = { businessId }, orderBy = { id: "asc" as const };
  return JSON.stringify(await Promise.all([
    db.invoice.findMany({ where, orderBy }), db.payment.findMany({ where, orderBy }),
    db.paymentRefund.findMany({ where, orderBy }), db.customerPackage.findMany({ where, orderBy }),
    db.customerPackageServiceBalance.findMany({ where, orderBy }), db.walletAccount.findMany({ where, orderBy }),
    db.walletTransaction.findMany({ where, orderBy }), db.financialOperation.findMany({ where, orderBy }),
    db.loyaltyTransaction.findMany({ where, orderBy }), db.performanceReceipt.findMany({ where, orderBy }),
    db.auditLog.findMany({ where, orderBy }), db.creditNote.findMany({ where, orderBy }),
  ]), (_key, value) => typeof value === "bigint" ? value.toString() : value);
}

async function refundForm(businessId: string, invoiceId: string) {
  const payments = await db.payment.findMany({ where: { invoiceId }, orderBy: { id: "asc" } });
  const form = new FormData();
  form.set("businessId", businessId); form.set("invoiceId", invoiceId);
  form.set("operationKey", randomUUID()); form.set("reason", "Unused package full refund");
  form.set("stockLines", "[]");
  form.set("legs", JSON.stringify(payments.map(p => ({ paymentId: p.id, amountCents: Number(p.amount) * 100, method: p.method }))));
  return form;
}

for (const split of [false, true]) for (const enabled of [false, true]) {
  test(`Package Wallet ${split ? "split" : "full"}, shifts ${enabled}: purchase, full refund and replay`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await fixture(split, enabled); await h.login(db, f);
      await db.loyaltyProgram.create({ data: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1 } });
      const sale = await h.action.completeCashierSaleAction(f.form);
      assert.equal(sale.status, "success", sale.message);
      const invoiceId = sale.invoice!.id;
      const payments = await db.payment.findMany({ where: { invoiceId } });
      assert.equal(payments.length, split ? 2 : 1);
      assert.equal(payments.reduce((n, p) => n + Number(p.amount) * 100, 0), 20000);
      assert.ok(payments.every(p => p.shiftId === (enabled ? f.shift.id : null)));
      assert.ok(payments.every(p => p.purpose === (p.method === "MEMBER_WALLET" ? "SALE" : "LEGACY")));
      const wallet = payments.find(p => p.method === "MEMBER_WALLET")!;
      assert.equal(Number(wallet.amount) * 100, split ? 10000 : 20000);
      const entitlement = await db.customerPackage.findFirstOrThrow({ where: { businessId: f.business.id } });
      assert.ok(payments.every(payment => payment.customerPackageId === entitlement.id), "Each tender retains the package purchase payment-history link");
      assert.equal(entitlement.status, "ACTIVE"); assert.equal(entitlement.remainingUses, 5);
      assert.equal(entitlement.totalUses, 5); assert.equal(Number(entitlement.purchasePrice), 200);
      const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
      assert.equal(account.paidBalance.toFixed(2), split ? "1000.00" : "900.00");
      assert.equal(account.bonusBalance.toFixed(2), "0.00");
      const debit = await db.walletTransaction.findFirstOrThrow({ where: { paymentId: wallet.id, type: "REDEMPTION" } });
      assert.equal(debit.bonusDelta.toFixed(2), "-100.00");
      assert.equal(debit.paidDelta.toFixed(2), split ? "0.00" : "-100.00");
      const earned = await db.loyaltyTransaction.findMany({ where: { businessId: f.business.id, type: "EARN" } });
      assert.equal(earned.reduce((sum, row) => sum + row.points, 0), 200);
      const receipts = await db.performanceReceipt.findMany({ where: { invoiceId, kind: "PAYMENT" } });
      assert.equal(receipts.reduce((sum, row) => sum + Number(row.salesCents), 0), 20000);
      const bought = await snapshot(f.business.id);
      assert.equal((await h.action.completeCashierSaleAction(f.form)).invoice?.id, invoiceId);
      assert.equal(await snapshot(f.business.id), bought);
      const form = await refundForm(f.business.id, invoiceId);
      const result = await h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form);
      assert.equal(result.status, "success", result.message);
      const refunds = await db.paymentRefund.findMany({ where: { invoiceId } });
      assert.equal(refunds.length, payments.length);
      for (const payment of payments) {
        const refund = refunds.find(r => r.paymentId === payment.id)!;
        assert.equal(refund.amount.toFixed(2), payment.amount.toFixed(2));
        assert.equal(refund.method, payment.method);
      }
      const restored = await db.walletAccount.findUniqueOrThrow({ where: { id: account.id } });
      assert.equal(restored.paidBalance.toFixed(2), "1000.00"); assert.equal(restored.bonusBalance.toFixed(2), "100.00");
      const cancelled = await db.customerPackage.findUniqueOrThrow({ where: { id: entitlement.id } });
      assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.remainingUses, 0);
      assert.equal((await db.customerPackageServiceBalance.findFirstOrThrow({ where: { customerPackageId: entitlement.id } })).remainingUses, 0);
      assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status, "REFUNDED");
      assert.equal((await db.customerMembership.findFirstOrThrow({ where: { businessId: f.business.id, customerId: f.customer.id } })).pointsBalance, 0);
      const performance = await db.performanceReceipt.findMany({ where: { invoiceId } });
      assert.equal(performance.reduce((sum, row) => sum + Number(row.salesCents), 0), 0);
      assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "PAYMENT_REFUNDED" } }), split ? 2 : 1);
      const refunded = await snapshot(f.business.id);
      assert.equal((await h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form)).status, "success");
      assert.equal(await snapshot(f.business.id), refunded);
    } finally { await h.close(); }
  });
}

for (const invalid of ["single-leg", "partial", "used", "used-benefit", "wrong-source"] as const) {
  test(`Package refund refuses ${invalid} without financial mutation`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await fixture(true); await h.login(db, f);
      const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
      const form = await refundForm(f.business.id, sale.invoice!.id);
      const legs = JSON.parse(form.get("legs")!.toString());
      if (invalid === "single-leg") legs.pop();
      if (invalid === "partial") legs[0].amountCents = 5000;
      if (invalid === "wrong-source") Object.assign(legs.find((l: {method:string}) => l.method === "CASH"), { method: "CARD", reference: "wrong source" });
      if (invalid === "used") await db.customerPackage.updateMany({ where: { businessId: f.business.id }, data: { remainingUses: 4 } });
      if (invalid === "used-benefit") await db.customerPackageServiceBalance.updateMany({ where: { businessId: f.business.id }, data: { remainingUses: 4 } });
      form.set("legs", JSON.stringify(legs));
      const before = await snapshot(f.business.id);
      const result = await h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form);
      assert.equal(result.status, "error"); assert.equal(await snapshot(f.business.id), before);
    } finally { await h.close(); }
  });
}

for (const model of ["paymentRefund", "second-paymentRefund", "walletTransaction", "customerPackage", "customerPackageServiceBalance"]) {
  test(`Package refund rollback after ${model} write preserves all canonical facts`, async () => {
    const h = await checkoutHarness(db);
    try {
      const f = await fixture(true); await h.login(db, f);
      const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
      const form = await refundForm(f.business.id, sale.invoice!.id), before = await snapshot(f.business.id);
      h.failAfter(model === "second-paymentRefund" ? "paymentRefund" : model, model.startsWith("customerPackage") ? "updateMany" : "create", model === "second-paymentRefund" ? 2 : 1);
      const result = await h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form);
      assert.equal(result.status, "error"); assert.equal(h.injections(), 1);
      assert.equal(await snapshot(f.business.id), before);
    } finally { await h.close(); }
  });
}

test("Wallet package eligibility does not admit redemption, training, foreign tender or top-up", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(true); await h.login(db, f);
    const before = await snapshot(f.business.id);
    for (const fields of [
      { customerPackageId: randomUUID() },
      { paymentMethodCode: "TRAINING_COMPLIMENTARY", checkoutReason: "Training only" },
      { method: "FOREIGN_CURRENCY", paymentMethodCode: "FOREIGN_CURRENCY", tenderAmount: "20", exchangeRateToMyr: "5" },
      { method: "CRYPTO", paymentMethodCode: "CRYPTO", tenderAmount: "20", exchangeRateToMyr: "5" },
    ]) {
      const form = new FormData(); for (const [key, value] of f.form) form.append(key, value);
      for (const [key, value] of Object.entries(fields)) form.set(key, value!);
      assert.equal((await h.action.completeCashierSaleAction(form)).status, "error");
      assert.equal(await snapshot(f.business.id), before);
    }
    await assert.rejects(postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID(), paymentMethodCode: "MEMBER_WALLET", modeAtConfirmation: "OFF", shiftId: null }, db));
    assert.equal(await snapshot(f.business.id), before);
  } finally { await h.close(); }
});

test("mixed cart with two purchased packages refunds every source and cancels both entitlements", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(true); await h.login(db, f);
    const product = await db.product.create({ data: { businessId: f.business.id, name: "Mixed cart product", sku: randomUUID(), price: 40 } });
    f.form.set("packageQuantity", "2"); f.form.set("productId", product.id); f.form.set("productQuantity", "1"); f.form.set("walletAmount", "200");
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    assert.equal(sale.invoice!.total, 440);
    const packages = await db.customerPackage.findMany({ where: { businessId: f.business.id } });
    assert.equal(packages.length, 2); assert.ok(packages.every(p => p.remainingUses === 5));
    const form = await refundForm(f.business.id, sale.invoice!.id);
    const result = await h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form);
    assert.equal(result.status, "success", result.message);
    const refunds = await db.paymentRefund.findMany({ where: { invoiceId: sale.invoice!.id } });
    assert.deepEqual(refunds.map(r => [r.method, Number(r.amount) * 100]).sort(), [["CASH", 24000], ["MEMBER_WALLET", 20000]]);
    assert.equal(await db.customerPackage.count({ where: { businessId: f.business.id, status: "CANCELLED", remainingUses: 0 } }), 2);
    assert.equal(await db.customerPackageServiceBalance.count({ where: { businessId: f.business.id, remainingUses: 0 } }), 2);
  } finally { await h.close(); }
});

test("different-key concurrent full package refunds commit exactly once", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(true); await h.login(db, f);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const first = await refundForm(f.business.id, sale.invoice!.id), second = await refundForm(f.business.id, sale.invoice!.id);
    const results = await Promise.all([first, second].map(form => h.invoices.refundWalletSaleAction({ status: "idle", message: "" }, form)));
    assert.equal(results.filter(r => r.status === "success").length, 1);
    assert.equal(results.filter(r => r.status === "error").length, 1);
    assert.equal(await db.paymentRefund.count({ where: { invoiceId: sale.invoice!.id } }), 2);
    assert.equal(await db.financialOperation.count({ where: { businessId: f.business.id, operationType: "PAYMENT_REFUND" } }), 1);
    const account = await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(account.paidBalance.toFixed(2), "1000.00"); assert.equal(account.bonusBalance.toFixed(2), "100.00");
  } finally { await h.close(); }
});
