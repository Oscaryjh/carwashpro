import { setWalletModule } from "../helpers/wallet-fixture";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
const db = walletTestDatabase(); after(() => db.$disconnect());

test("unintegrated authenticated payment actions reject wallet injection before interpreting ordinary tender", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const beforePayments = await db.payment.count({ where: { businessId: f.business.id } });
    const form = new FormData(); form.set("walletAmount", "1"); form.set("method", "CASH");
    for (const invoke of [() => h.pos.recordPaymentAction(form), () => h.pos.recordPackagePurchasePaymentAction(form),
      () => h.pos.usePackagePaymentAction(form), () => h.products.sellProductAction(form), () => h.workOrders.purchasePackageFromCashierAction(form),
      () => h.appointments.recordSalonAppointmentPaymentAction({ status: "idle", message: "", invoiceId: null, invoice: null }, form)]) {
      await assert.rejects(invoke(), /Wallet.*only.*Cashier/i);
    }
    assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), beforePayments);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});

test("general void cannot erase a settled Wallet service payment when Local release gate is closed", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Synthetic void protection", price: 40, taxable: false } });
    const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
      assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    f.form.delete("productId"); f.form.delete("productQuantity"); f.form.set("serviceId", service.id); f.form.set("serviceQuantity", "1");
    f.form.set("appointmentId", visit.id); f.form.set("assignedStaffId", f.actor.id);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const form = new FormData(); form.set("operationId", randomUUID()); form.set("invoiceId", sale.invoice!.id); form.set("voidReason", "Synthetic guard check");
    const gate = process.env.TETAMU_WALLET_LOCAL_TEST;
    let result;
    try { await setWalletModule(db, f.business.id, false); result = await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form); }
    finally { await setWalletModule(db, f.business.id, true); }
    assert.equal(result.status, "error"); assert.match(result.message, /Member Wallet is not enabled for this business/);
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: sale.invoice!.id } })).status, "PAID");
    assert.equal(await db.payment.count({ where: { invoiceId: sale.invoice!.id, status: "ACTIVE" } }), 1);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id, type: "REDEMPTION" } }), 1);
  } finally { await h.close(); }
});

test("general refund rejects Wallet source without creating cash refund", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id, method: "MEMBER_WALLET" } });
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), invoiceId: sale.invoice!.id, paymentId: payment.id,
      amount: "1", method: "CASH", reference: "", reason: "Synthetic unsupported wallet refund" })) form.set(key, value);
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form);
    assert.equal(result.status, "error"); assert.match(result.message, /Wallet refunds.*not available/i);
    assert.equal(await db.paymentRefund.count({ where: { businessId: f.business.id } }), 0);
  } finally { await h.close(); }
});
