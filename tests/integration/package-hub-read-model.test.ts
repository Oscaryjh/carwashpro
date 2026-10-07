import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { walletTestDatabase, walletFixture } from "../helpers/wallet-fixture";
import { checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { captureCustomerPackageActivityBefore, appendCustomerPackageActivity } from "../../src/lib/packages/activity";
import { resolvePackageHubScope } from "../../src/lib/packages/hub-scope";
import { readPackageHubOverview, readPackageHubActivity, readPackageHubSales, readPackageHubCustomerPackages } from "../../src/lib/packages/hub-read-model";

const db = walletTestDatabase();
after(() => db.$disconnect());
const window = { fromDate: new Date("2000-01-01"), toDateExclusive: new Date("2100-01-01") };
async function fixture() {
  const f = await walletFixture(db);
  const pkg = await db.package.create({ data: { businessId: f.business.id, name: "Hub package", price: 2, totalUses: 3 } });
  const legacy = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: pkg.id,
    purchasePrice: 1, totalUses: 3, remainingUses: 2, status: "ACTIVE", branchId: null } });
  const ctx = { businessId: f.business.id, user: { userId: f.actor.id } };
  return { ...f, pkg, legacy, ctx, authFixture: f };
}
test("Owner POS scope allows inactive history and rejects staff, wrong Business, invalid branch and disabled POS", async () => {
  const f = await fixture(), foreign = await fixture();
  assert.equal((await resolvePackageHubScope(f.ctx, db)).businessId, f.business.id);
  await db.branch.update({ where: { id: f.branch.id }, data: { status: "INACTIVE" } });
  assert.equal((await resolvePackageHubScope({ ...f.ctx, branchId: f.branch.id }, db)).branchId, f.branch.id);
  for (const branchId of ["tampered", foreign.branch.id, randomUUID()]) {
    await assert.rejects(readPackageHubActivity({ ...f.ctx, branchId }, window, db));
    await assert.rejects(readPackageHubOverview({ ...f.ctx, branchId }, window, db));
  }
  await assert.rejects(readPackageHubOverview({ ...f.ctx, businessId: foreign.business.id }, window, db));
  await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["ALL_BRANCHES"] } });
  await assert.rejects(readPackageHubOverview(f.ctx, window, db));
  await db.user.update({ where: { id: f.actor.id }, data: { role: "BUSINESS_OWNER" } });
  await db.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id, moduleKey: "POS" }, data: { status: "DISABLED", revision: { increment: 1 } } });
  await assert.rejects(readPackageHubOverview(f.ctx, window, db));
});
test("legacy zero-history current state is visible; period does not change current totals; pending/cancelled remain filterable", async () => {
  const f = await fixture();
  for (const status of ["PENDING_PAYMENT", "CANCELLED", "USED_UP"] as const) await db.customerPackage.create({ data: {
    businessId: f.business.id, customerId: f.customer.id, packageId: f.pkg.id, purchasePrice: 1, totalUses: 3, remainingUses: 0, status,
  } });
  const current = await readPackageHubCustomerPackages(f.ctx, {}, db);
  assert.equal(current.rows.length, 4); assert.ok(current.rows.every(row => row.historyMayBeIncomplete));
  assert.equal(current.rows.find(row => row.customerPackageId === f.legacy.id)?.remainingUses, 2);
  const all = await readPackageHubOverview(f.ctx, window, db);
  assert.equal(all.current.activePackages, 1); assert.equal(all.current.currentlyUsedUp, 1);
  assert.deepEqual(all.period, { packagesSold: 0, packageUses: 0, restoredUses: 0 });
  const empty = await readPackageHubOverview(f.ctx, { fromDate: new Date("1900-01-01"), toDateExclusive: new Date("1900-02-01") }, db);
  assert.deepEqual(empty.current, all.current);
  assert.equal((await readPackageHubCustomerPackages(f.ctx, { status: "CANCELLED" }, db)).rows.length, 1);
  assert.equal((await readPackageHubCustomerPackages({ ...f.ctx, branchId: f.branch.id }, {}, db)).rows.length, 0);
});

test("Overview Uses Left is zero without current entitlements", async () => {
  const f = await walletFixture(db);
  const result = await readPackageHubOverview({ businessId: f.business.id, user: { userId: f.actor.id } }, window, db);
  assert.deepEqual(result.current, { activePackages: 0, usesLeft: 0, currentlyUsedUp: 0 });
});

test("Overview aggregates authoritative ACTIVE/USED_UP balances, independently of period and legacy history", async () => {
  const f = await fixture(), foreign = await fixture();
  const secondBranch = await db.branch.create({ data: { businessId: f.business.id, name: "Second branch", status: "INACTIVE" } });
  for (const [status, remainingUses, branchId] of [
    ["ACTIVE", 3, f.branch.id], ["ACTIVE", 4, secondBranch.id],
    ["USED_UP", 0, f.branch.id], ["PENDING_PAYMENT", 5, f.branch.id], ["CANCELLED", 6, f.branch.id],
  ] as const) await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id,
    packageId: f.pkg.id, purchasePrice: 1, totalUses: 10, remainingUses, status, branchId } });
  const service = await db.service.create({ data: { businessId: f.business.id, name: "Legacy service", price: 1 } });
  await db.customerPackageServiceBalance.create({ data: { businessId: f.business.id, customerPackageId: f.legacy.id, serviceId: service.id, totalUses: 99, remainingUses: 99 } });
  await db.package.update({ where: { id: f.pkg.id }, data: { totalUses: 999 } });
  assert.equal(await db.customerPackageActivity.count({ where: { businessId: f.business.id } }), 0);
  for (const [from, to] of [["2026-10-07", "2026-10-08"], ["2026-10-01", "2026-11-01"],
    ["2026-09-01", "2026-10-01"], ["1999-01-03", "1999-04-09"]]) {
    const result = await readPackageHubOverview(f.ctx, { fromDate: new Date(from), toDateExclusive: new Date(to) }, db);
    assert.deepEqual(result.current, { activePackages: 3, usesLeft: 9, currentlyUsedUp: 1 });
    assert.deepEqual(result.period, { packagesSold: 0, packageUses: 0, restoredUses: 0 });
  }
  assert.deepEqual((await readPackageHubOverview({ ...f.ctx, branchId: f.branch.id }, window, db)).current,
    { activePackages: 1, usesLeft: 3, currentlyUsedUp: 1 });
  assert.deepEqual((await readPackageHubOverview({ ...f.ctx, branchId: secondBranch.id }, window, db)).current,
    { activePackages: 1, usesLeft: 4, currentlyUsedUp: 0 });
  assert.equal((await readPackageHubOverview(foreign.ctx, window, db)).current.usesLeft, 2);
  assert.equal((await db.customerPackage.findUniqueOrThrow({ where: { id: f.legacy.id } })).remainingUses, 2);
});

test("Overview rejects a negative current balance even when another positive balance masks its sum", async () => {
  const f = await fixture();
  await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id,
    packageId: f.pkg.id, purchasePrice: 1, totalUses: 3, remainingUses: -1, status: "ACTIVE" } });
  await assert.rejects(readPackageHubOverview(f.ctx, window, db), /remaining uses/i);
});

test("business-subset Group Manager cannot inherit Owner-only Package Hub access", async () => {
  const f = await fixture(), home = await fixture();
  const group = await db.businessGroup.create({ data: { name: "Package scope fixture", code: randomUUID() } });
  await db.businessGroupMember.create({ data: { groupId: group.id, businessId: f.business.id } });
  const grant = await db.businessGroupUser.create({ data: { groupId: group.id, userId: home.actor.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES" } });
  await db.businessGroupUserBusinessAccess.create({ data: { groupUserId: grant.id, businessId: f.business.id } });
  await assert.rejects(readPackageHubOverview({ businessId: f.business.id, user: { userId: home.actor.id } }, window, db));
});
test("real purchases and cancellation supply activity/sales facts; historical price and all source refs survive", async () => {
  const f = await fixture(), h = await checkoutHarness(db);
  try {
    await h.login(db, f.authFixture);
    const sale = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), modeAtConfirmation: "ON", shiftId: f.shift.id,
      branchId: f.branch.id, customerId: f.customer.id, method: "CASH", paymentMethodCode: "BUILTIN_CASH", walletAmount: "0", packageId: f.pkg.id, packageQuantity: "2" })) sale.set(key, value);
    const result = await h.action.completeCashierSaleAction(sale); assert.equal(result.status, "success", result.message);
    const invoiceId = result.invoice!.id;
    await db.package.update({ where: { id: f.pkg.id }, data: { price: 999 } });
    let overview = await readPackageHubOverview(f.ctx, window, db);
    assert.equal(overview.period.packagesSold, 2);
    const sales = await readPackageHubSales(f.ctx, window, db);
    assert.equal(sales.rows.length, 2); assert.ok(sales.rows.every(row => row.purchasePrice === "2.00" && !row.historyMayBeIncomplete));
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId } });
    const refund = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), modeAtConfirmation: "ON", shiftId: f.shift.id,
      invoiceId, paymentId: payment.id, amount: "4", method: "CASH", reason: "Hub lifecycle", reference: "" })) refund.set(key, value);
    const response = await h.invoices.refundPaymentAction({ status: "idle", message: "" }, refund); assert.equal(response.status, "success", response.message);
    overview = await readPackageHubOverview(f.ctx, window, db);
    assert.equal(overview.period.packagesSold, 2); assert.equal(overview.current.activePackages, 1);
    const activity = await readPackageHubActivity(f.ctx, { ...window, eventType: "CANCELLED", packageId: f.pkg.id, search: "Synthetic" }, db);
    assert.equal(activity.rows.length, 2); assert.ok(activity.rows.every(row => row.usesChanged === -3 && row.paymentRefundId && !row.historyMayBeIncomplete));
    assert.equal((await readPackageHubActivity(f.ctx, { ...window, search: "absent" }, db)).rows.length, 0);
    assert.equal((await readPackageHubSales(f.ctx, window, db)).rows[0].status, "CANCELLED");
  } finally { await h.close(); }
});
test("Customer Packages uses stable 20-row keyset and bounded batch queries", async () => {
  const f = await fixture();
  await db.customerPackage.createMany({ data: Array.from({ length: 24 }, () => ({ businessId: f.business.id,
    customerId: f.customer.id, packageId: f.pkg.id, purchasePrice: 1, totalUses: 3, remainingUses: 3, status: "ACTIVE" as const, purchasedAt: new Date("2020-01-01") })) });
  let queries = 0;
  const measured = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  measured.$on("query", () => queries++);
  try {
    const first = await readPackageHubCustomerPackages(f.ctx, {}, measured);
    const firstQueries = queries; assert.equal(first.rows.length, 20); assert.ok(first.nextCursor); assert.ok(firstQueries < 25, `queries=${firstQueries}`);
    const next = await readPackageHubCustomerPackages(f.ctx, { cursor: first.nextCursor }, measured);
    assert.equal(next.rows.length, 5); assert.equal(next.nextCursor, null);
    assert.equal(new Set([...first.rows, ...next.rows].map(row => row.customerPackageId)).size, 25);
    assert.ok(queries - firstQueries <= firstQueries + 2);
    await assert.rejects(readPackageHubCustomerPackages(f.ctx, { cursor: "tampered" }, measured));
  } finally { await measured.$disconnect(); }
});

for (const discontinuity of ["none", "balance", "status"] as const) test(`lifecycle actual deltas and history continuity: ${discontinuity}`, async () => {
  const gap = discontinuity === "balance", incomplete = discontinuity !== "none";
  const f = await fixture();
  const cp = await db.customerPackage.create({ data: { businessId: f.business.id, customerId: f.customer.id, packageId: f.pkg.id,
    purchasePrice: 2, totalUses: 3, remainingUses: 0, status: "PENDING_PAYMENT", branchId: null } });
  const invoice = await db.invoice.create({ data: { businessId: f.business.id, customerId: f.customer.id, invoiceNumber: randomUUID(),
    subtotal: 2, total: 2, paidAmount: 2, balance: 0, status: "PAID",
    items: { create: { businessId: f.business.id, customerPackageId: cp.id, kind: "PACKAGE_PURCHASE", name: "Purchase", quantity: 1, unitPrice: 2, lineTotal: 2 } },
  }, include: { items: true } });
  const purchasePayment = await db.payment.create({ data: { businessId: f.business.id, invoiceId: invoice.id, amount: 2, method: "CASH", customerPackageId: cp.id } });
  let originalUseActivityId: string | undefined;
  for (const [eventType, remainingUses, requested] of [["PURCHASED", 3, 0], ["USED", 1, gap ? 1 : 2], ["RESTORED", 3, 2], ["RESTORED", 3, 1], ["CANCELLED", 0, 0]] as const) {
    await db.$transaction(async tx => {
      const restoring = eventType === "RESTORED", cancelling = eventType === "CANCELLED";
      const op = await tx.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id,
        operationType: restoring || cancelling ? "PAYMENT_REFUND" : "CASHIER_CHECKOUT", operationKey: randomUUID(), requestFingerprint: "a".repeat(64) } });
      const payment = eventType === "PURCHASED" || cancelling ? purchasePayment : await tx.payment.create({ data: {
        businessId: f.business.id, invoiceId: invoice.id, customerPackageId: cp.id, method: "PACKAGE", packageUses: requested, amount: 1,
      } });
      const refund = restoring || cancelling ? await tx.paymentRefund.create({ data: { businessId: f.business.id, invoiceId: invoice.id,
        paymentId: payment.id, method: cancelling ? "CASH" : "PACKAGE", amount: cancelling ? 2 : 1, packageUsesRestored: requested, reason: "Read-model fixture" } }) : null;
      // Simulate legacy mutations lacking Activity, not tampering with immutable facts.
      // 0->3, 2->1, 2->3 has the same sum/final value as a continuous chain.
      if (gap && (eventType === "USED" || (restoring && requested === 2))) {
        await tx.customerPackage.update({ where: { id: cp.id }, data: { remainingUses: 2 } });
      }
      if (discontinuity === "status" && restoring && requested === 2) {
        await tx.customerPackage.update({ where: { id: cp.id }, data: { status: "USED_UP" } });
      }
      const before = await captureCustomerPackageActivityBefore(tx, { businessId: f.business.id, customerPackageId: cp.id });
      await tx.customerPackage.update({ where: { id: cp.id }, data: { remainingUses, status: cancelling ? "CANCELLED" : "ACTIVE" } });
      const event = await appendCustomerPackageActivity(tx, before, { eventType, sourceType: restoring || cancelling ? "PAYMENT_REFUND" : "CHECKOUT",
        financialOperationId: op.id, actorUserId: f.actor.id, branchId: f.branch.id, invoiceId: invoice.id, paymentId: payment.id,
        paymentRefundId: refund?.id, requestedUses: restoring ? requested : undefined,
        purchaseSourceMapping: eventType === "PURCHASED" ? { customerPackageId: cp.id, invoiceId: invoice.id, invoiceItemId: invoice.items[0].id } : undefined });
      if (eventType === "USED") originalUseActivityId = event.id;
      await tx.financialOperation.update({ where: { id: op.id }, data: { state: "COMPLETED", completedAt: new Date(), resultJson: { activityId: event.id } } });
    });
  }
  assert.ok(originalUseActivityId);
  const overview = await readPackageHubOverview({ ...f.ctx, branchId: f.branch.id }, window, db);
  assert.deepEqual(overview.period, { packagesSold: 1, packageUses: gap ? 1 : 2, restoredUses: gap ? 1 : 2 });
  assert.equal(overview.current.activePackages, 0, "event branch must not substitute entitlement branch");
  const events = await readPackageHubActivity(f.ctx, window, db);
  assert.equal(events.rows.length, 5); assert.ok(events.rows.some(row => row.eventType === "RESTORED" && row.usesChanged === 0));
  assert.ok(events.rows.every(row => row.historyMayBeIncomplete === incomplete));
  const sales = await readPackageHubSales(f.ctx, window, db);
  assert.equal(sales.rows[0].historyMayBeIncomplete, incomplete);
  const current = await readPackageHubCustomerPackages(f.ctx, {}, db);
  assert.equal(current.rows.find(row => row.customerPackageId === cp.id)?.historyMayBeIncomplete, incomplete);
});

test("Activity and Sales keyset pages contain every canonical row exactly once", async () => {
  const f = await fixture(), h = await checkoutHarness(db);
  try {
    await h.login(db, f.authFixture);
    const form = new FormData();
    for (const [key, value] of Object.entries({ operationId: randomUUID(), modeAtConfirmation: "ON", shiftId: f.shift.id, branchId: f.branch.id,
      customerId: f.customer.id, method: "CASH", paymentMethodCode: "BUILTIN_CASH", walletAmount: "0", packageId: f.pkg.id, packageQuantity: "22" })) form.set(key, value);
    const result = await h.action.completeCashierSaleAction(form); assert.equal(result.status, "success", result.message);
    for (const read of [readPackageHubActivity, readPackageHubSales]) {
      const first = await read(f.ctx, window, db); assert.equal(first.rows.length, 20); assert.ok(first.nextCursor);
      const second = await read(f.ctx, { ...window, cursor: first.nextCursor }, db);
      assert.equal(second.rows.length, 2); assert.equal(second.nextCursor, null);
      assert.equal(new Set([...first.rows, ...second.rows].map(row => row.activityId)).size, 22);
    }
  } finally { await h.close(); }
});
