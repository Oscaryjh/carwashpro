import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";

assert.equal(process.env.TETAMU_WALLET_LOCAL_TEST, "true", "Disposable runner required");
const db = walletTestDatabase();
after(() => db.$disconnect());
type Harness = Awaited<ReturnType<typeof checkoutHarness>>;
type Scenario = { name: string; remaining: number[]; balances: number[][]; payments: [number, number | null, number][]; want: number[]; wantBalances: number[][] };
const scenarios: Scenario[] = [
  { name: "same CP and same balance accumulate both payments", remaining: [5], balances: [[5]], payments: [[0, 0, 1], [0, 0, 1]], want: [7], wantBalances: [[7]] },
  { name: "single payment retains restore behavior", remaining: [5], balances: [[5]], payments: [[0, 0, 1]], want: [6], wantBalances: [[6]] },
  { name: "different CP payments restore independently", remaining: [5, 4], balances: [[5], [4]], payments: [[0, 0, 1], [1, 0, 2]], want: [6, 6], wantBalances: [[6], [6]] },
  { name: "same CP with different service balances accumulates total", remaining: [5], balances: [[2, 3]], payments: [[0, 0, 1], [0, 1, 1]], want: [7], wantBalances: [[3, 4]] },
  { name: "total and service caps remain ten", remaining: [9], balances: [[9]], payments: [[0, 0, 1], [0, 0, 1]], want: [10], wantBalances: [[10]] },
  { name: "used-up CP becomes active", remaining: [0], balances: [[0]], payments: [[0, 0, 1], [0, 0, 1]], want: [2], wantBalances: [[2]] },
  { name: "legacy total-only payments accumulate without service inference", remaining: [5], balances: [[]], payments: [[0, null, 1], [0, null, 1]], want: [7], wantBalances: [[]] },
  { name: "zero and negative uses retain no-restore behavior", remaining: [5], balances: [[5]], payments: [[0, 0, 0], [0, 0, -1]], want: [5], wantBalances: [[5]] },
];

async function fixture(h: Harness, s = scenarios[0]) {
  const f = await walletFixture(db);
  await h.login(db, f);
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Disposable VOID service", price: 10 } });
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Disposable ten uses", serviceId: service.id, price: 100, totalUses: 10 } });
  const packages = [];
  for (let i = 0; i < s.remaining.length; i++) {
    const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id, purchasePrice: 100, totalUses: 10, remainingUses: s.remaining[i], status: s.remaining[i] ? "ACTIVE" : "USED_UP", branchId: f.branch.id } });
    const balances = [];
    for (let j = 0; j < s.balances[i].length; j++) {
      const svc = j === 0 ? service : await db.service.create({ data: { businessId: f.business.id, name: "Other service", price: 10 } });
      balances.push(await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id, customerPackageId: cp.id, serviceId: svc.id, totalUses: 10, remainingUses: s.balances[i][j] } }));
    }
    packages.push({ cp, balances });
  }
  const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
  const invoice = await db.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, appointmentId: visit.id, invoiceNumber: randomUUID(), subtotal: 20, total: 20, paidAmount: 20, balance: 0, status: "PAID" } });
  await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: invoice.id, serviceId: service.id, kind: "SERVICE", name: service.name, quantity: 2, unitPrice: 10, lineTotal: 20 } });
  for (const [cpIndex, balanceIndex, uses] of s.payments) await db.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: invoice.id, appointmentId: visit.id, customerPackageId: packages[cpIndex].cp.id, customerPackageServiceBalanceId: balanceIndex === null ? null : packages[cpIndex].balances[balanceIndex].id, method: "PACKAGE", amount: 10, packageUses: uses, cashierId: f.actor.id, shiftId: f.shift.id } });
  const form = new FormData();
  form.set("invoiceId", invoice.id); form.set("operationId", randomUUID()); form.set("voidReason", "Disposable cumulative restore correction");
  return { ...f, invoice, packages, form };
}

async function snapshot(businessId: string) {
  const where = { businessId }, orderBy = { id: "asc" as const };
  return JSON.stringify(await Promise.all([
    db.customerPackage.findMany({ where, orderBy }), db.customerPackageServiceBalance.findMany({ where, orderBy }),
    db.invoice.findMany({ where, orderBy }), db.payment.findMany({ where, orderBy }), db.paymentRefund.findMany({ where, orderBy }),
    db.financialOperation.findMany({ where, orderBy }), db.auditLog.findMany({ where, orderBy }),
    db.walletTransaction.findMany({ where, orderBy }), db.customerPackageActivity.findMany({ where, orderBy }),
  ]));
}

for (const s of scenarios) test(`real VOID: ${s.name}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h, s);
    const result = await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, f.form);
    assert.equal(result.status, "success", result.message);
    assert.deepEqual(await Promise.all(f.packages.map(async p => (await db.customerPackage.findUniqueOrThrow({ where: { id: p.cp.id } })).remainingUses)), s.want, "CP restores must accumulate");
    assert.ok((await db.customerPackage.findMany({ where: { businessId: f.business.id } })).every(p => p.status === "ACTIVE"));
    assert.deepEqual(await Promise.all(f.packages.map(p => Promise.all(p.balances.map(async b => (await db.customerPackageServiceBalance.findUniqueOrThrow({ where: { id: b.id } })).remainingUses)))), s.wantBalances, "service restores must accumulate");
    const where = { businessId: f.business.id };
    assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: f.invoice.id } })).status, "VOID");
    const payments = await db.payment.findMany({ where: { invoiceId: f.invoice.id } });
    assert.ok(payments.every(p => p.status === "VOID" && p.voidedAt && p.voidReason === f.form.get("voidReason")));
    assert.deepEqual(payments.map(p => p.packageUses).sort(), s.payments.map(p => p[2]).sort());
    const events = await db.customerPackageActivity.findMany({ where, orderBy: [{ customerPackageId: "asc" }, { sequence: "asc" }] });
    assert.equal(events.length, s.payments.filter(p => p[2] > 0).length);
    for (const { cp } of f.packages) {
      const chain = events.filter(row => row.customerPackageId === cp.id);
      let remaining = cp.remainingUses;
      for (const row of chain) {
        assert.equal(row.eventType, "RESTORED"); assert.equal(row.sourceType, "INVOICE_VOID");
        assert.equal(row.remainingBefore, remaining); remaining = row.remainingAfter;
        assert.equal(row.originalUseActivityId, null);
        assert.equal(row.usesDelta, row.remainingAfter - row.remainingBefore);
      }
      assert.equal(remaining, (await db.customerPackage.findUniqueOrThrow({ where: { id: cp.id } })).remainingUses);
    }
    assert.equal(await db.paymentRefund.count({ where }), 0);
    assert.equal(await db.walletTransaction.count({ where }), 0);
    const operation = await db.financialOperation.findFirstOrThrow({ where });
    assert.equal(operation.operationType, "INVOICE_VOID"); assert.equal(operation.state, "COMPLETED");
    assert.equal(operation.operationKey, f.form.get("operationId"));
    const audit = await db.auditLog.findMany({ where: { ...where, action: "INVOICE_VOIDED" } });
    assert.equal(audit.length, 1); assert.equal(audit[0].actorUserId, f.actor.id);
    assert.equal((audit[0].metadata as { voidReason: string }).voidReason, f.form.get("voidReason"));
    const after = await snapshot(f.business.id);
    assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, f.form)).status, "success");
    assert.equal(await snapshot(f.business.id), after, "same operation replay must have zero effects");
    f.form.set("operationId", randomUUID());
    assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, f.form)).status, "error");
    assert.equal(await snapshot(f.business.id), after, "already VOID must not restore again");
  } finally { await h.close(); }
});

for (const model of ["customerPackage", "customerPackageServiceBalance", "customerPackageActivity"]) test(`real VOID rolls back first restore when second ${model} write fails`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h); const before = await snapshot(f.business.id);
    h.failAfter(model, model === "customerPackageActivity" ? "create" : "update", 2);
    const result = await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, f.form);
    assert.equal(result.status, "error"); assert.match(result.message, /P1C_INJECTED/); assert.equal(h.injections(), 1);
    assert.equal(await snapshot(f.business.id), before, "whole VOID transaction must roll back");
  } finally { await h.close(); }
});

test("real VOID retries a concurrent entitlement change using the existing financial transaction contract", async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h);
    let pendingVoid: ReturnType<typeof h.invoices.voidInvoiceAction> | undefined;
    await db.$transaction(async tx => {
      await tx.customerPackage.update({ where: { id: f.packages[0].cp.id }, data: { remainingUses: 4 } });
      await tx.customerPackageServiceBalance.update({ where: { id: f.packages[0].balances[0].id }, data: { remainingUses: 4 } });
      pendingVoid = h.invoices.voidInvoiceAction({ status: "idle", message: "" }, f.form);
      const deadline = Date.now() + 10000;
      while (true) {
        const [state] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query ILIKE '%customer_packages%'
        ) AS waiting`;
        if (state.waiting) break;
        assert.ok(Date.now() < deadline, "VOID must reach the contended package lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }, { timeout: 15000 });
    const result = await pendingVoid;
    assert.equal(result?.status, "success", result?.message);
    assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.packages[0].cp.id } })).remainingUses, 6);
    assert.equal((await db.customerPackageServiceBalance.findUniqueOrThrow({ where: { id: f.packages[0].balances[0].id } })).remainingUses, 6);
    assert.equal(await db.financialOperation.count({ where: { businessId: f.business.id, state: "COMPLETED" } }), 1);
    assert.equal(await db.auditLog.count({ where: { businessId: f.business.id, action: "INVOICE_VOIDED" } }), 1);
  } finally { await h.close(); }
});

for (const remaining of [0, 9, 10]) for (const fail of [false, true]) test(`formal package use refund remaining=${remaining} insert failure=${fail}`, async () => {
  const h = await checkoutHarness(db);
  try {
    const f = await fixture(h, { name: "Refund cap", remaining: [remaining], balances: [[remaining]], payments: [[0, 0, 2]], want: [], wantBalances: [] });
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: f.invoice.id } });
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), invoiceId: f.invoice.id, paymentId: payment.id,
      amount: "10", method: "PACKAGE", reference: "", reason: "Disposable use restore", modeAtConfirmation: "ON", shiftId: f.shift.id })) form.set(key, value);
    const before = await snapshot(f.business.id);
    if (fail) h.failAfter("customerPackageActivity", "create");
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form);
    if (fail) { assert.equal(result.status, "error"); assert.match(result.message, /P1C_INJECTED/); assert.equal(h.injections(), 1); assert.equal(await snapshot(f.business.id), before); return; }
    assert.equal(result.status, "success", result.message);
    const row = await db.customerPackageActivity.findFirstOrThrow({ where: { businessId: f.business.id, eventType: "RESTORED" } });
    assert.equal(row.remainingBefore, remaining); assert.equal(row.remainingAfter, Math.min(10, remaining + 2));
    assert.equal(row.requestedUses, 2); assert.equal(row.usesDelta, Math.min(10, remaining + 2) - remaining);
    assert.equal(row.originalUseActivityId, null);
    assert.equal((await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form)).status, "success");
    assert.equal(await db.customerPackageActivity.count({ where: { businessId: f.business.id } }), 1);
  } finally { await h.close(); }
});
