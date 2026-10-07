import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { captureCustomerPackageActivityBefore, appendCustomerPackageActivity } from "../../src/lib/packages/activity";
import type { ActivityInput } from "../../src/lib/packages/activity-types";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function fixture(remaining = 10, pending = false, operationType: "CASHIER_CHECKOUT" | "PAYMENT_REFUND" | "INVOICE_VOID" = "CASHIER_CHECKOUT") {
  const f = await walletFixture(db);
  const staff = await db.user.create({ data: { businessId: f.business.id, name: "Service employee", role: "STAFF" } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Foundation service", price: 10 } });
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Foundation package", totalUses: 10, price: 100, serviceId: service.id } });
  const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id, totalUses: 10, remainingUses: remaining, purchasePrice: 100, status: pending ? "PENDING_PAYMENT" : remaining ? "ACTIVE" : "USED_UP" } });
  const balance = await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id, customerPackageId: cp.id, serviceId: service.id, totalUses: 10, remainingUses: remaining } });
  const appointment = await db.appointment.create({ data: { businessId: f.business.id, customerId: f.customer.id, branchId: f.branch.id, assignedStaffId: staff.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date() } });
  const invoice = await db.invoice.create({ data: { businessId: f.business.id, customerId: f.customer.id, branchId: f.branch.id, appointmentId: appointment.id, invoiceNumber: randomUUID(), subtotal: 100, total: 100, paidAmount: 100, balance: 0, status: "PAID" } });
  const item = await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: invoice.id, customerPackageId: cp.id, serviceId: service.id, kind: pending ? "PACKAGE_PURCHASE" : "SERVICE", name: "Foundation line", quantity: 2, unitPrice: 10, lineTotal: 20 } });
  const payment = await db.payment.create({ data: { businessId: f.business.id, invoiceId: invoice.id, appointmentId: appointment.id, branchId: f.branch.id, cashierId: f.actor.id, customerPackageId: cp.id, customerPackageServiceBalanceId: pending ? null : balance.id, method: pending ? "CASH" : "PACKAGE", packageUses: pending ? 0 : 1, amount: 10 } });
  const operation = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType, operationKey: randomUUID(), requestFingerprint: "a".repeat(64) } });
  const input: ActivityInput = { eventType: pending ? "PURCHASED" : "USED", sourceType: "CHECKOUT", financialOperationId: operation.id, actorUserId: f.actor.id, invoiceId: invoice.id, invoiceItemId: item.id, paymentId: payment.id, appointmentId: appointment.id, assignedStaffId: staff.id, branchId: f.branch.id, ...(pending ? {} : { customerPackageServiceBalanceId: balance.id, serviceId: service.id }) };
  return { ...f, staff, service, pkg, cp, balance, appointment, invoice, item, payment, operation, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function change(f: Fixture, remaining: number, input = f.input, status: "ACTIVE" | "USED_UP" | "CANCELLED" = remaining ? "ACTIVE" : "USED_UP") {
  return db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: remaining, status } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: remaining } });
    return appendCustomerPackageActivity(tx, before, input);
  });
}
test("purchase activation captures all initial balances; existing packages are not backfilled", async () => {
  const f = await fixture(0, true);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
  const row = await change(f, 10);
  assert.equal(row.eventType, "PURCHASED"); assert.equal(row.usesDelta, 10); assert.equal(row.statusBefore, "PENDING_PAYMENT"); assert.equal(row.statusAfter, "ACTIVE"); assert.equal(row.sequence, 1);
  assert.deepEqual(row.serviceChanges, [{ balanceId: f.balance.id, serviceId: f.service.id, totalUses: 10, remainingBefore: 0, remainingAfter: 10, usesDelta: 10 }]);
});
test("consumption captures actual state, distinct actor/staff and event branch without binding entitlement", async () => {
  const f = await fixture(); const row = await change(f, 9);
  assert.equal(row.remainingBefore, 10); assert.equal(row.remainingAfter, 9); assert.equal(row.usesDelta, -1);
  assert.equal(row.actorUserId, f.actor.id); assert.equal(row.assignedStaffId, f.staff.id); assert.equal(row.branchId, f.branch.id);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).branchId, null);
});
for (const [remaining, requested, expected] of [[9, 2, 1], [10, 1, 0], [0, 1, 1]] as const) test(`restore actual delta from ${remaining}, requested ${requested}`, async () => {
  const f = await fixture(remaining, false, "PAYMENT_REFUND");
  const refund = await db.paymentRefund.create({ data: { businessId: f.business.id, paymentId: f.payment.id, invoiceId: f.invoice.id, amount: 10, method: "PACKAGE", reason: "Foundation refund", packageUsesRestored: requested, processedById: f.actor.id } });
  await db.payment.update({ where: { id: f.payment.id }, data: { packageUses: requested } });
  const row = await change(f, Math.min(10, remaining + requested), { ...f.input, eventType: "RESTORED", sourceType: "PAYMENT_REFUND", paymentRefundId: refund.id, requestedUses: requested });
  assert.equal(row.usesDelta, expected); assert.equal(row.requestedUses, requested); assert.equal(row.originalUseActivityId, null); assert.equal(row.statusAfter, "ACTIVE");
});
test("cancel retains full balances and purchase refund provenance", async () => {
  const f = await fixture(10, false, "PAYMENT_REFUND");
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { kind: "PACKAGE_PURCHASE" } });
  await db.payment.update({ where: { id: f.payment.id }, data: { method: "CASH", packageUses: 0, customerPackageServiceBalanceId: null } });
  const refund = await db.paymentRefund.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, paymentId: f.payment.id, amount: 10, method: "CASH", reason: "Purchase refund" } });
  const row = await change(f, 0, { ...f.input, eventType: "CANCELLED", sourceType: "PAYMENT_REFUND", paymentRefundId: refund.id, serviceId: null, customerPackageServiceBalanceId: null }, "CANCELLED");
  assert.equal(row.usesDelta, -10); assert.equal(row.statusAfter, "CANCELLED"); assert.equal((row.serviceChanges as unknown[]).length, 1);
});
test("multi-service use excludes unchanged balances", async () => {
  const f = await fixture(8);
  await db.customerPackage.update({ where: { id: f.cp.id }, data: { totalUses: 8 } });
  await db.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { totalUses: 5, remainingUses: 5 } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Other service", price: 10 } });
  await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id, customerPackageId: f.cp.id, serviceId: service.id, totalUses: 3, remainingUses: 3 } });
  const row = await db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 7 } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: 4 } });
    return appendCustomerPackageActivity(tx, before, f.input);
  });
  assert.equal(row.usesDelta, -1); assert.deepEqual(row.serviceChanges, [{ balanceId: f.balance.id, serviceId: f.service.id, totalUses: 5, remainingBefore: 5, remainingAfter: 4, usesDelta: -1 }]);
});
test("same transaction captures fresh state for successive mutations and supports exact replay", async () => {
  const f = await fixture();
  const other = await db.payment.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, customerPackageId: f.cp.id, customerPackageServiceBalanceId: f.balance.id, method: "PACKAGE", packageUses: 1, amount: 10 } });
  const rows = await db.$transaction(async tx => {
    const first = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 9 } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: 9 } });
    const a = await appendCustomerPackageActivity(tx, first, f.input);
    assert.equal((await appendCustomerPackageActivity(tx, first, f.input)).id, a.id);
    await assert.rejects(appendCustomerPackageActivity(tx, first, { ...f.input, reason: "conflicting payload" }));
    const second = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 8 } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: 8 } });
    const b = await appendCustomerPackageActivity(tx, second, { ...f.input, paymentId: other.id });
    return [a, b];
  });
  assert.deepEqual(rows.map(r => [r.sequence, r.remainingBefore, r.remainingAfter]), [[1, 10, 9], [2, 9, 8]]);
});
test("concurrent real transactions serialize same entitlement sequence and balance", async () => {
  const f = await fixture();
  const payments = [f.payment, await db.payment.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, customerPackageId: f.cp.id, customerPackageServiceBalanceId: f.balance.id, method: "PACKAGE", packageUses: 1, amount: 10 } })];
  const rows = await Promise.all(payments.map(payment => db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: { decrement: 1 } } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: { decrement: 1 } } });
    return appendCustomerPackageActivity(tx, before, { ...f.input, paymentId: payment.id });
  }, { timeout: 15000 })));
  assert.deepEqual(rows.map(r => r.sequence).sort(), [1, 2]);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 8);
});
test("database rejects update/delete and source duplication under another operation", async () => {
  const f = await fixture(); const row = await change(f, 9);
  await assert.rejects(db.customerPackageActivity.update({ where: { id: row.id }, data: { reason: "rewrite" } }));
  await assert.rejects(db.customerPackageActivity.delete({ where: { id: row.id } }));
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "CASHIER_CHECKOUT", operationKey: randomUUID(), requestFingerprint: "b".repeat(64) } });
  await assert.rejects(db.customerPackageActivity.create({ data: { ...row, id: randomUUID(), serviceChanges: row.serviceChanges!, additionalSourceRefs: undefined, sequence: 2, financialOperationId: op.id } }), { code: "P2002" });
});
test("transaction failure rolls back both fact and balances", async () => {
  const f = await fixture();
  await assert.rejects(db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 9 } });
    await tx.customerPackageServiceBalance.update({ where: { id: f.balance.id }, data: { remainingUses: 9 } });
    await appendCustomerPackageActivity(tx, before, f.input);
    throw new Error("forced rollback");
  }), /forced rollback/);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 10);
});
for (const field of ["invoiceId", "invoiceItemId", "paymentId", "branchId", "actorUserId", "assignedStaffId", "appointmentId", "financialOperationId", "customerPackageServiceBalanceId", "serviceId"] as const) test(`cross-business ${field} fails closed and rolls back`, async () => {
  const f = await fixture(), other = await fixture();
  const ids = { invoiceId: other.invoice.id, invoiceItemId: other.item.id, paymentId: other.payment.id, branchId: other.branch.id, actorUserId: other.actor.id, assignedStaffId: other.staff.id, appointmentId: other.appointment.id, financialOperationId: other.operation.id, customerPackageServiceBalanceId: other.balance.id, serviceId: other.service.id };
  await assert.rejects(change(f, 9, { ...f.input, [field]: ids[field] }));
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 10);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
});
test("legacy total-only use permits missing service/staff without inferring them", async () => {
  const f = await fixture();
  await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageServiceBalanceId: null } });
  const row = await db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 9 } });
    return appendCustomerPackageActivity(tx, before, { ...f.input, customerPackageServiceBalanceId: null, serviceId: null, assignedStaffId: null });
  });
  assert.deepEqual(row.serviceChanges, []); assert.equal(row.assignedStaffId, null); assert.equal(row.serviceId, null);
});

test("two packages can cover the same invoice item without source collision", async () => {
  const f = await fixture();
  const cp2 = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: f.pkg.id, purchasePrice: 100, totalUses: 10, remainingUses: 10, status: "ACTIVE" } });
  const b2 = await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id, customerPackageId: cp2.id, serviceId: f.service.id, totalUses: 10, remainingUses: 10 } });
  const p2 = await db.payment.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, customerPackageId: cp2.id, customerPackageServiceBalanceId: b2.id, method: "PACKAGE", packageUses: 1, amount: 10 } });
  await change(f, 9);
  const other = { ...f, cp: cp2, balance: b2, payment: p2, input: { ...f.input, paymentId: p2.id, customerPackageServiceBalanceId: b2.id } };
  await change(other, 9);
  const rows = await db.customerPackageActivity.findMany({ where: { invoiceItemId: f.item.id } });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map(r => r.customerPackageId)), new Set([f.cp.id, cp2.id]));
  assert.equal(rows.reduce((n, r) => n - r.usesDelta, 0), 2);
});
test("activity insert uniqueness failure rolls back attempted second consumption", async () => {
  const f = await fixture(); await change(f, 9);
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "CASHIER_CHECKOUT", operationKey: randomUUID(), requestFingerprint: "b".repeat(64) } });
  await assert.rejects(change(f, 8, { ...f.input, financialOperationId: op.id }), { code: "P2002" });
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 9);
  assert.equal((await db.customerPackageServiceBalance.findUniqueOrThrow({ where: { id: f.balance.id } })).remainingUses, 9);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 1);
});
test("VOID restoration links real original use, preserving full identity", async () => {
  const f = await fixture(); const used = await change(f, 9);
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "INVOICE_VOID", operationKey: randomUUID(), requestFingerprint: "c".repeat(64) } });
  await db.payment.update({ where: { id: f.payment.id }, data: { status: "VOID" } });
  const restored = await change(f, 10, { ...f.input, eventType: "RESTORED", sourceType: "INVOICE_VOID", financialOperationId: op.id, originalUseActivityId: used.id, requestedUses: 1 });
  assert.equal(restored.originalUseActivityId, used.id);
  assert.equal(restored.usesDelta, 1); assert.equal(restored.sequence, 2);
  assert.equal(restored.entryKey, `void-restore:${f.payment.id}`);
});
test("same-business payment for a different entitlement is rejected", async () => {
  const f = await fixture();
  const other = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: f.pkg.id, totalUses: 10, remainingUses: 10, purchasePrice: 100, status: "ACTIVE" } });
  await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageId: other.id } });
  await assert.rejects(change(f, 9), /payment entitlement mismatch/);
});
test("capture is transaction-bound and cannot be forged or reused from another transaction", async () => {
  const f = await fixture();
  await assert.rejects(captureCustomerPackageActivityBefore(db, { businessId: f.business.id, customerPackageId: f.cp.id }), /transaction client/);
  await assert.rejects(db.$transaction(tx => appendCustomerPackageActivity(tx, { businessId: f.business.id, customerPackageId: f.cp.id }, f.input)), /capture must belong/);
  const token = await db.$transaction(tx => captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id }));
  await assert.rejects(db.$transaction(tx => appendCustomerPackageActivity(tx, token, f.input)), /capture must belong/);
  const other = await fixture();
  await assert.rejects(db.$transaction(tx => captureCustomerPackageActivityBefore(tx, { businessId: other.business.id, customerPackageId: f.cp.id })), /entitlement not in Business/);
});
test("cashier is not silently accepted as assigned service staff", async () => {
  const f = await fixture();
  await assert.rejects(change(f, 9, { ...f.input, assignedStaffId: f.actor.id }), /assigned staff lacks service source/);
});
test("purchase can retain exact multiple payment source IDs and rejects unrelated extra sources", async () => {
  const f = await fixture(0, true);
  const p2 = await db.payment.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, method: "CASH", amount: 50 } });
  const row = await change(f, 10, { ...f.input, additionalSourceRefs: { paymentIds: [p2.id], refundIds: [] } });
  assert.deepEqual(row.additionalSourceRefs, { paymentIds: [p2.id], refundIds: [] });
  const other = await fixture(0, true);
  await assert.rejects(change(other, 10, { ...other.input, additionalSourceRefs: { paymentIds: [p2.id], refundIds: [] } }), /payment tenant mismatch/);
});
for (const event of ["PURCHASED", "CANCELLED", "REFUND", "VOID"] as const) test(`database source uniqueness protects ${event} across operation keys`, async () => {
  const f = await fixture(event === "PURCHASED" ? 0 : 10, event === "PURCHASED");
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: event === "VOID" ? "INVOICE_VOID" : "PAYMENT_REFUND", operationKey: randomUUID(), requestFingerprint: "d".repeat(64) } });
  const refund = await db.paymentRefund.create({ data: { businessId: f.business.id, paymentId: f.payment.id, invoiceId: f.invoice.id, amount: 10, method: "PACKAGE", packageUsesRestored: 1, reason: "DB source constraint fixture" } });
  const type = event === "PURCHASED" ? "PURCHASED" : event === "CANCELLED" ? "CANCELLED" : "RESTORED";
  const data = {
    businessId: f.business.id, customerPackageId: f.cp.id, sequence: 1, eventType: type as "PURCHASED" | "CANCELLED" | "RESTORED", sourceType: event === "PURCHASED" ? "CHECKOUT" as const : event === "VOID" ? "INVOICE_VOID" as const : "PAYMENT_REFUND" as const,
    totalUsesSnapshot: 10, remainingBefore: event === "PURCHASED" ? 0 : 10, remainingAfter: event === "CANCELLED" ? 0 : 10,
    usesDelta: event === "PURCHASED" ? 10 : event === "CANCELLED" ? -10 : 0, statusBefore: "ACTIVE" as const, statusAfter: "ACTIVE" as const,
    serviceChanges: [], financialOperationId: f.operation.id, entryKey: "db-source-first", actorUserId: f.actor.id,
    invoiceId: f.invoice.id, paymentId: f.payment.id, paymentRefundId: event === "REFUND" ? refund.id : null, occurredAt: new Date(),
  };
  await db.customerPackageActivity.create({ data });
  await assert.rejects(db.customerPackageActivity.create({ data: { ...data, sequence: 2, financialOperationId: op.id, entryKey: "db-source-second" } }), { code: "P2002" });
});
test("database enforces arithmetic, sign, nonnegative bounds and non-null source identity", async () => {
  const f = await fixture();
  const base = { businessId: f.business.id, customerPackageId: f.cp.id, sequence: 1, eventType: "USED" as const, sourceType: "CHECKOUT" as const, totalUsesSnapshot: 10, remainingBefore: 10, remainingAfter: 9, usesDelta: -1, statusBefore: "ACTIVE" as const, statusAfter: "ACTIVE" as const, serviceChanges: [], financialOperationId: f.operation.id, entryKey: "db-check", actorUserId: f.actor.id, invoiceId: f.invoice.id, paymentId: f.payment.id, occurredAt: new Date() };
  for (const bad of [{ usesDelta: -2 }, { remainingAfter: -1, usesDelta: -11 }, { remainingBefore: 11, remainingAfter: 10 }, { remainingBefore: 9, remainingAfter: 10, usesDelta: 1 }, { paymentId: null }]) await assert.rejects(db.customerPackageActivity.create({ data: { ...base, ...bad } }));
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
});
test("null-customer legacy invoice still validates its linked appointment customer", async () => {
  const f = await fixture();
  const customer = await db.customer.create({ data: { businessId: f.business.id, name: "Wrong customer", phone: randomUUID() } });
  await db.invoice.update({ where: { id: f.invoice.id }, data: { customerId: null } });
  await db.appointment.update({ where: { id: f.appointment.id }, data: { customerId: customer.id } });
  await assert.rejects(change(f, 9, { ...f.input, appointmentId: null, assignedStaffId: null }), /customer mismatch/);
});
test("invoice item must itself belong to the Business, even when attached to this invoice", async () => {
  const f = await fixture(), other = await fixture();
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { businessId: other.business.id } });
  await assert.rejects(change(f, 9), /invoice item tenant mismatch/);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 10);
});
for (const kind of ["PRODUCT", "PACKAGE_PURCHASE"] as const) test(`legacy total-only use cannot claim a known ${kind} invoice item`, async () => {
  const f = await fixture();
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { kind } });
  await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageServiceBalanceId: null } });
  await assert.rejects(db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { remainingUses: 9 } });
    return appendCustomerPackageActivity(tx, before, { ...f.input, customerPackageServiceBalanceId: null, serviceId: null });
  }), /service item mismatch/);
});
