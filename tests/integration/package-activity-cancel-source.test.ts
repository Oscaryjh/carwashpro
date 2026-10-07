import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { InvoiceItemKind } from "@prisma/client";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { captureCustomerPackageActivityBefore, appendCustomerPackageActivity } from "../../src/lib/packages/activity";
import type { ActivityInput } from "../../src/lib/packages/activity-types";
const db = walletTestDatabase();
after(() => db.$disconnect());
async function fixture(kind: InvoiceItemKind | null = null, purchased = true, primary = false) {
  const f = await walletFixture(db);
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Source test", price: 5, totalUses: 2 } });
  const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id, purchasePrice: 5, totalUses: 2, remainingUses: 0, status: "PENDING_PAYMENT" } });
  const invoice = await db.invoice.create({ data: { businessId: f.business.id, customerId: f.customer.id, customerPackageId: primary ? cp.id : null, invoiceNumber: randomUUID(), subtotal: 5, total: 5, paidAmount: 5, balance: 0, status: "PAID" } });
  const item = await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: invoice.id, customerPackageId: cp.id, kind: null, name: "Not identity", quantity: 1, unitPrice: 5, lineTotal: 5 } });
  const payment = await db.payment.create({ data: { businessId: f.business.id, invoiceId: invoice.id, customerPackageId: cp.id, method: "CASH", amount: 5 } });
  const mapping = { customerPackageId: cp.id, invoiceId: invoice.id, invoiceItemId: item.id };
  await db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: cp.id });
    await tx.customerPackage.update({ where: { id: cp.id }, data: { remainingUses: 2, status: "ACTIVE" } });
    if (purchased) {
      const op = await tx.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "PACKAGE_PURCHASE", operationKey: randomUUID(), requestFingerprint: "a".repeat(64) } });
      await appendCustomerPackageActivity(tx, before, { eventType: "PURCHASED", sourceType: "CHECKOUT", financialOperationId: op.id, actorUserId: f.actor.id, invoiceId: invoice.id, paymentId: payment.id, purchaseSourceMapping: mapping });
    }
  });
  await db.invoiceItem.update({ where: { id: item.id }, data: { kind } });
  const refund = await db.paymentRefund.create({ data: { businessId: f.business.id, invoiceId: invoice.id, paymentId: payment.id, amount: 5, method: "CASH", reason: "Cancel source probe" } });
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "PAYMENT_REFUND", operationKey: randomUUID(), requestFingerprint: "b".repeat(64) } });
  const input: ActivityInput = { eventType: "CANCELLED", sourceType: "PAYMENT_REFUND", financialOperationId: op.id, actorUserId: f.actor.id, invoiceId: invoice.id, paymentId: payment.id, paymentRefundId: refund.id };
  return { ...f, cp, item, invoice, payment, refund, mapping, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function cancel(f: Fixture, input = f.input) {
  return db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { status: "CANCELLED", remainingUses: 0 } });
    const row = await appendCustomerPackageActivity(tx, before, input);
    assert.deepEqual(await appendCustomerPackageActivity(tx, before, input), row);
    return row;
  });
}
for (const primary of [true, false]) test(`legacy cancel uses exact PURCHASED evidence primary=${primary}`, async () => {
  const f = await fixture(null, true, primary), row = await cancel(f);
  assert.equal(row.invoiceItemId, f.item.id); assert.equal(row.usesDelta, -2); assert.equal(row.entryKey, `cancel:${f.cp.id}`);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id, eventType: "CANCELLED" } }), 1);
  assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, null);
});
test("modern cancellation remains valid without PURCHASED history", async () => { await cancel(await fixture("PACKAGE_PURCHASE", false)); });
test("legacy without PURCHASED requires exact writer mapping", async () => {
  const f = await fixture(null, false); await assert.rejects(cancel(f), /purchase|evidence/i);
  await cancel(f, { ...f.input, purchaseSourceMapping: f.mapping });
});
for (const kind of ["SERVICE", "PRODUCT", "OTHER"] as const) test(`${kind} contradicts even PURCHASED or writer evidence`, async () => {
  const f = await fixture(kind, true, true); await assert.rejects(cancel(f), /kind|purchase/i);
  await assert.rejects(cancel(f, { ...f.input, purchaseSourceMapping: f.mapping }), /kind|purchase/i);
});
for (const wrong of ["customerPackageId", "invoiceId", "invoiceItemId"] as const) test(`reject cancellation mapping wrong ${wrong}`, async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(cancel(f, { ...f.input, purchaseSourceMapping: { ...f.mapping, [wrong]: other.mapping[wrong] } }), /mapping|invoice|purchase/i);
});
test("cross tenant invoice and item fail closed", async () => {
  const f = await fixture(), other = await fixture();
  await assert.rejects(cancel(f, { ...f.input, invoiceId: other.invoice.id }), /invoice/);
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { businessId: other.business.id } });
  await assert.rejects(cancel(f), /tenant|foreign|purchase/);
});
test("PURCHASED for a different invoice cannot establish cancellation identity", async () => {
  const f = await fixture();
  const other = await db.invoice.create({ data: { businessId: f.business.id, customerId: f.customer.id, invoiceNumber: randomUUID(), subtotal: 5, total: 5, balance: 0, paidAmount: 5, status: "PAID" } });
  const item = await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: other.id, customerPackageId: f.cp.id, kind: null, name: "Same looking", quantity: 1, unitPrice: 5, lineTotal: 5 } });
  await assert.rejects(cancel(f, { ...f.input, invoiceId: other.id, purchaseSourceMapping: { ...f.mapping, invoiceId: other.id, invoiceItemId: item.id } }), /purchase|invoice/);
});

test("legacy payment evidence keeps invoiceItemId null without primary or line inference", async () => {
  const f = await fixture(null, false, false);
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { customerPackageId: null } });
  const row = await cancel(f);
  assert.equal(row.invoiceItemId, null); assert.equal(row.paymentId, f.payment.id);
  assert.equal(row.customerPackageId, f.cp.id); assert.equal(row.invoiceId, f.invoice.id);
  assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, null);
});
for (const invalid of ["missing CP", "wrong CP", "wrong invoice", "foreign business", "usage method", "usage count", "void", "SERVICE", "PRODUCT", "OTHER"] as const)
test(`legacy payment fallback rejects ${invalid}`, async () => {
  const f = await fixture(null, false, true), other = await fixture();
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { customerPackageId: null } });
  if (invalid === "missing CP") await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageId: null } });
  if (invalid === "wrong CP") await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageId: other.cp.id } });
  if (invalid === "wrong invoice") await db.payment.update({ where: { id: f.payment.id }, data: { invoiceId: other.invoice.id } });
  if (invalid === "foreign business") await db.payment.update({ where: { id: f.payment.id }, data: { businessId: other.business.id } });
  if (invalid === "usage method") await db.payment.update({ where: { id: f.payment.id }, data: { method: "PACKAGE" } });
  if (invalid === "usage count") await db.payment.update({ where: { id: f.payment.id }, data: { packageUses: 1 } });
  if (invalid === "void") await db.payment.update({ where: { id: f.payment.id }, data: { status: "VOID" } });
  if (["SERVICE", "PRODUCT", "OTHER"].includes(invalid)) await db.invoiceItem.update({ where: { id: f.item.id }, data: { kind: invalid as InvoiceItemKind } });
  await assert.rejects(cancel(f), /purchase|evidence|source|kind/i);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).status, "ACTIVE");
});
test("each legacy entitlement needs its own Payment identity, never the invoice primary Payment", async () => {
  const a = await fixture(null, false, true);
  await db.invoiceItem.update({ where: { id: a.item.id }, data: { customerPackageId: null } });
  const cp = await db.customerPackage.create({ data: { businessId: a.business.id, customerId: a.customer.id, packageId: a.cp.packageId,
    purchasePrice: 5, totalUses: 2, remainingUses: 2, status: "ACTIVE" } });
  const b = { ...a, cp };
  await assert.rejects(cancel(b), /purchase|evidence/i);
  const payment = await db.payment.create({ data: { businessId: a.business.id, invoiceId: a.invoice.id, customerPackageId: cp.id, method: "CASH", amount: 5 } });
  const first = await cancel(a), second = await cancel(b);
  assert.equal(first.paymentId, a.payment.id); assert.equal(second.paymentId, payment.id);
  assert.equal(first.invoiceItemId, null); assert.equal(second.invoiceItemId, null);
  assert.equal(second.customerPackageId, cp.id);
  assert.equal(await db.customerPackageActivity.count({ where: { invoiceId: a.invoice.id } }), 2);
});
