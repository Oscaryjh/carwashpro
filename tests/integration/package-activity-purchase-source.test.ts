import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { captureCustomerPackageActivityBefore, appendCustomerPackageActivity } from "../../src/lib/packages/activity";
import type { InvoiceItemKind } from "@prisma/client";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function fixture(kind: InvoiceItemKind | null, primary = false) {
  const f = await walletFixture(db);
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Not used for identity", price: 5, totalUses: 2 } });
  const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id, purchasePrice: 5, totalUses: 2, remainingUses: 0, status: "PENDING_PAYMENT" } });
  const invoice = await db.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, customerPackageId: primary ? cp.id : null,
    invoiceNumber: randomUUID(), subtotal: 5, total: 5, paidAmount: 5, balance: 0, status: "PAID" } });
  const item = await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: invoice.id, customerPackageId: cp.id,
    kind, name: "Unrelated display name", quantity: 1, unitPrice: 5, lineTotal: 5 } });
  const payment = await db.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: invoice.id, customerPackageId: cp.id, method: "CASH", amount: 5 } });
  const op = await db.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "PACKAGE_PURCHASE", operationKey: randomUUID(), requestFingerprint: "a".repeat(64) } });
  return { ...f, cp, invoice, item, payment, op };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
for (const failInsert of [false, true]) test(`legacy POS without line identity: formal refund, insert failure=${failInsert}`, async () => {
  const f = await fixture(null, true);
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { customerPackageId: null } });
  await db.customerPackage.update({ where: { id: f.cp.id }, data: { status: "ACTIVE", remainingUses: 2 } });
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
  const h = await checkoutHarness(db);
  try {
    await h.login(db, f);
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), invoiceId: f.invoice.id,
      paymentId: f.payment.id, amount: "5", method: "CASH", reason: "Legacy POS refund compatibility",
      reference: "", modeAtConfirmation: "ON", shiftId: f.shift.id })) form.set(key, value);
    if (failInsert) h.failAfter("customerPackageActivity", "create", 1);
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form);
    if (result.status === "error") {
      assert.equal(await db.paymentRefund.count({ where: { invoiceId: f.invoice.id } }), 0);
      assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).status, "ACTIVE");
      assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, null);
    }
    if (failInsert) {
      assert.equal(result.status, "error"); assert.equal(h.injections(), 1);
      assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
      assert.equal(await db.creditNote.count({ where: { invoiceId: f.invoice.id } }), 0);
      return;
    }
    assert.equal(result.status, "success", result.message);
    const event = await db.customerPackageActivity.findFirstOrThrow({ where: { customerPackageId: f.cp.id, eventType: "CANCELLED" } });
    assert.equal(event.invoiceItemId, null); assert.equal(event.paymentId, f.payment.id);
    assert.equal(event.invoiceId, f.invoice.id); assert.equal(event.usesDelta, -2);
    assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, null);
    assert.equal((await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form)).status, "success");
    assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 1);
  } finally { await h.close(); }
});
const mapping = (f: Fixture) => ({ customerPackageId: f.cp.id, invoiceId: f.invoice.id, invoiceItemId: f.item.id });
async function activate(f: Fixture, proof?: ReturnType<typeof mapping>) {
  return db.$transaction(async tx => {
    const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: f.cp.id });
    await tx.customerPackage.update({ where: { id: f.cp.id }, data: { status: "ACTIVE", remainingUses: 2 } });
    const input = { eventType: "PURCHASED" as const, sourceType: "CHECKOUT" as const, financialOperationId: f.op.id,
      actorUserId: f.actor.id, invoiceId: f.invoice.id, paymentId: f.payment.id, ...(proof ? { purchaseSourceMapping: proof } : {}) };
    const result = await appendCustomerPackageActivity(tx, before, input);
    assert.deepEqual(await appendCustomerPackageActivity(tx, before, input), result, "same capture exact replay");
    return result;
  });
}
for (const primary of [false, true]) for (const kind of [null, "PACKAGE_PURCHASE"] as const) test(`exact purchase mapping accepts ${kind} primary=${primary}, without kind backfill`, async () => {
  const f = await fixture(kind, primary);
  const result = await activate(f, mapping(f));
  assert.equal(result.customerPackageId, f.cp.id); assert.equal(result.invoiceItemId, f.item.id);
  assert.equal(result.usesDelta, 2); assert.equal(result.sequence, 1);
  assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, kind);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 1);
});
test("modern exact item relation remains valid without legacy evidence", async () => {
  const f = await fixture("PACKAGE_PURCHASE"); await activate(f);
});
for (const kind of [null, "SERVICE", "PRODUCT", "OTHER"] as const) test(`no mapping cannot infer purchase from primary CP and ${kind}`, async () => {
  const f = await fixture(kind, true); await assert.rejects(activate(f), /purchase|source|identity/i);
  assert.equal(await db.customerPackageActivity.count({ where: { customerPackageId: f.cp.id } }), 0);
});
for (const kind of ["SERVICE", "PRODUCT", "OTHER"] as const) test(`explicit ${kind} rejects even a matching mapping`, async () => {
  const f = await fixture(kind, true); await assert.rejects(activate(f, mapping(f)), /purchase|source|kind/i);
});
for (const wrong of ["customerPackageId", "invoiceId", "invoiceItemId"] as const) test(`mapping rejects wrong ${wrong}`, async () => {
  const f = await fixture(null), other = await fixture(null);
  await assert.rejects(activate(f, { ...mapping(f), [wrong]: mapping(other)[wrong] }), /purchase|source|mapping|invoice/i);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.cp.id } })).remainingUses, 0);
});
test("same Business unrelated invoice item cannot be used as purchase evidence", async () => {
  const f = await fixture(null);
  const unrelated = await db.invoiceItem.create({ data: { businessId: f.business.id, invoiceId: f.invoice.id, kind: null, name: f.item.name, quantity: 1, unitPrice: 5, lineTotal: 5 } });
  await assert.rejects(activate(f, { ...mapping(f), invoiceItemId: unrelated.id }), /entitlement mismatch/);
});
test("a foreign-Business row on the same invoice still fails closed", async () => {
  const f = await fixture(null), other = await fixture(null);
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { businessId: other.business.id } });
  await assert.rejects(activate(f, mapping(f)), /foreign/);
});
test("legacy primary without item CP requires an independent exact purchase Payment relation", async () => {
  const f = await fixture(null, true);
  await db.invoiceItem.update({ where: { id: f.item.id }, data: { customerPackageId: null } });
  await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageId: null } });
  await assert.rejects(activate(f, mapping(f)), /entitlement mismatch/);
  await db.payment.update({ where: { id: f.payment.id }, data: { customerPackageId: f.cp.id } });
  const row = await activate(f, mapping(f));
  assert.equal(row.invoiceItemId, f.item.id);
  assert.equal((await db.invoiceItem.findUniqueOrThrow({ where: { id: f.item.id } })).kind, null);
});
test("two legacy entitlements in one invoice preserve identities and exactly one purchase each", async () => {
  const a = await fixture(null, true);
  const cp = await db.customerPackage.create({ data: { businessId: a.business.id, customerId: a.customer.id, packageId: a.cp.packageId, purchasePrice: 5, totalUses: 2, remainingUses: 0, status: "PENDING_PAYMENT" } });
  const item = await db.invoiceItem.create({ data: { businessId: a.business.id, invoiceId: a.invoice.id, customerPackageId: cp.id, kind: null, name: a.item.name, quantity: 1, unitPrice: 5, lineTotal: 5 } });
  const b = { ...a, cp, item };
  await activate(a, mapping(a)); await activate(b, mapping(b));
  const rows = await db.customerPackageActivity.findMany({ where: { invoiceId: a.invoice.id }, orderBy: { customerPackageId: "asc" } });
  assert.equal(rows.length, 2);
  assert.deepEqual(new Set(rows.map(row => `${row.customerPackageId}:${row.invoiceItemId}`)), new Set([`${a.cp.id}:${a.item.id}`, `${cp.id}:${item.id}`]));
});

for (const scenario of ["success", "insert failure", "used package"] as const) test(`official legacy multi-package refund: ${scenario}`, async () => {
  const a = await fixture(null, true);
  const cp = await db.customerPackage.create({ data: { businessId: a.business.id, customerId: a.customer.id, packageId: a.cp.packageId, purchasePrice: 5, totalUses: 2, remainingUses: 0, status: "PENDING_PAYMENT" } });
  const item = await db.invoiceItem.create({ data: { businessId: a.business.id, invoiceId: a.invoice.id, customerPackageId: cp.id, kind: null, name: "Second legacy purchase", quantity: 1, unitPrice: 5, lineTotal: 5 } });
  await db.invoice.update({ where: { id: a.invoice.id }, data: { subtotal: 10, total: 10, paidAmount: 10 } });
  await db.payment.update({ where: { id: a.payment.id }, data: { amount: 10 } });
  const b = { ...a, cp, item };
  await activate(a, mapping(a)); await activate(b, mapping(b));
  const h = await checkoutHarness(db);
  try {
    await h.login(db, a);
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), invoiceId: a.invoice.id, paymentId: a.payment.id, amount: "10", method: "CASH",
      reason: "Disposable legacy package cancellation", reference: "", modeAtConfirmation: "ON", shiftId: a.shift.id })) form.set(key, value);
    if (scenario === "insert failure") h.failAfter("customerPackageActivity", "create", 2);
    if (scenario === "used package") await db.customerPackage.update({ where: { id: cp.id }, data: { remainingUses: 1 } });
    const result = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form);
    if (scenario !== "success") {
      assert.equal(result.status, "error");
      if (scenario === "used package") assert.match(result.message, /unused/);
      assert.equal(await db.paymentRefund.count({ where: { invoiceId: a.invoice.id } }), 0);
      assert.equal(await db.creditNote.count({ where: { invoiceId: a.invoice.id } }), 0);
      assert.equal(await db.customerPackageActivity.count({ where: { invoiceId: a.invoice.id, eventType: "CANCELLED" } }), 0);
      assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: a.cp.id } })).remainingUses, 2);
      const afterB = await db.customerPackage.findUniqueOrThrow({ where: { id: cp.id } });
      assert.equal(afterB.status, "ACTIVE"); assert.equal(afterB.remainingUses, scenario === "used package" ? 1 : 2);
      assert.equal((await db.invoice.findUniqueOrThrow({ where: { id: a.invoice.id } })).status, "PAID");
      return;
    }
    assert.equal(result.status, "success", result.message);
    const packages = await db.customerPackage.findMany({ where: { id: { in: [a.cp.id, b.cp.id] } } });
    assert.ok(packages.every(row => row.status === "CANCELLED" && row.remainingUses === 0));
    const refund = await db.paymentRefund.findFirstOrThrow({ where: { paymentId: a.payment.id } });
    assert.equal(refund.amount.toFixed(2), "10.00");
    assert.equal((await h.invoices.refundPaymentAction({ status: "idle", message: "" }, form)).status, "success");
    const events = await db.customerPackageActivity.findMany({ where: { invoiceId: a.invoice.id, eventType: "CANCELLED" } });
    assert.equal(events.length, 2);
    assert.deepEqual(new Set(events.map(row => `${row.customerPackageId}:${row.invoiceItemId}`)), new Set([`${a.cp.id}:${a.item.id}`, `${b.cp.id}:${b.item.id}`]));
    assert.ok(events.every(row => row.remainingBefore === 2 && row.remainingAfter === 0 && row.usesDelta === -2 && row.paymentRefundId === refund.id));
    assert.equal(await db.invoiceItem.count({ where: { invoiceId: a.invoice.id, kind: null } }), 2);
  } finally { await h.close(); }
});
