import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { walletTestDatabase, walletFixture, setWalletModule } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { refundWalletSale } from "../../src/lib/wallet/refunds";
import { resolveWalletHubScope } from "../../src/lib/wallet/hub-scope";
import { readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances } from "../../src/lib/wallet/hub-read-model";

const db = walletTestDatabase();
after(() => db.$disconnect());
const window = { fromDate: new Date("2000-01-01Z"), toDateExclusive: new Date("2100-01-01Z") };
const denied = (error: unknown) => error instanceof Error && /denied|enabled/i.test(error.message);

async function historicalReversal(f: Awaited<ReturnType<typeof walletFixture>>, topUpId: string, branchId: string | null, refundedAt = new Date()) {
  // Disposable-only history fixture. Build the complete graph with canonical
  // constraints ON, without depending on the unshipped reversal UX/helper.
  await db.$transaction(async tx => {
    const originals = await tx.walletTransaction.findMany({ where: { topUpId }, orderBy: { sequence: "asc" } });
    const source = await tx.walletTopUp.findUniqueOrThrow({ where: { id: topUpId } });
    const op = await tx.financialOperation.create({ data: { businessId: f.business.id, branchId, actorUserId: f.actor.id,
      operationType: "WALLET_TOP_UP_REVERSAL", operationKey: randomUUID(), requestFingerprint: "0".repeat(64), state: "COMPLETED", completedAt: new Date(), resultJson: {} } });
    const refund = await tx.paymentRefund.create({ data: { businessId: f.business.id, branchId,
      paymentId: source.externalPaymentId, amount: source.paidAmount, method: "CASH", reason: "Synthetic historical reversal", processedById: f.actor.id, refundedAt } });
    await tx.walletTopUpReversal.create({ data: { businessId: f.business.id, topUpId, externalRefundId: refund.id,
      financialOperationId: op.id, actorUserId: f.actor.id, reason: "Synthetic historical reversal" } });
    for (const original of originals) {
      const account = await tx.walletAccount.update({ where: { id: original.walletAccountId }, data: {
        paidBalance: { decrement: original.paidDelta }, bonusBalance: { decrement: original.bonusDelta }, version: { increment: 1 } } });
      await tx.walletTransaction.create({ data: { businessId: f.business.id, walletAccountId: account.id, sequence: account.version,
        type: "REVERSAL", paidDelta: original.paidDelta.negated(), bonusDelta: original.bonusDelta.negated(), paidBalanceAfter: account.paidBalance, bonusBalanceAfter: account.bonusBalance,
        financialOperationId: op.id, entryKey: `reverse:${original.id}`, originalTransactionId: original.id,
        policyVersion: "WALLET_P1_FULL_REVERSAL_V1", actorUserId: f.actor.id, branchId } });
    }
  });
}

test("Hub accepts only fresh effective Owner access, never CRM/Reports/ALL_BRANCHES Staff", async () => {
  const f = await walletFixture(db), foreign = await walletFixture(db);
  await postWalletTopUp(foreign.ctx, foreign.input, db);
  assert.deepEqual(await resolveWalletHubScope(f.ctx, db), { businessId: f.business.id, branchId: f.branch.id });
  assert.equal((await resolveWalletHubScope({ ...f.ctx, branchId: undefined }, db)).branchId, null);
  await assert.rejects(resolveWalletHubScope({ ...f.ctx, businessId: foreign.business.id }, db), denied);
  for (const read of [readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances]) {
    await assert.rejects(read({ ...f.ctx, businessId: foreign.business.id }, window, db), denied);
  }
  assert.equal((await readWalletHubOverview(f.ctx, window, db)).currentBalance.total, "0.00");
  assert.equal((await readWalletHubTransactions(f.ctx, window, db)).rows.length, 0);
  assert.equal((await readWalletHubTopUps(f.ctx, window, db)).rows.length, 0);
  assert.equal((await readWalletHubCustomerBalances(f.ctx, {}, db)).rows.length, 0);
  for (const permissions of [[], ["CRM", "REPORTS", "POS", "ALL_BRANCHES"]]) {
    await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions } });
    for (const read of [readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances]) {
      await assert.rejects(read(f.ctx, window, db), denied);
    }
  }
  await db.user.update({ where: { id: f.actor.id }, data: { role: "BUSINESS_OWNER" } });
  await db.user.update({ where: { id: f.actor.id }, data: { role: "PLATFORM_ADMIN" } });
  await assert.rejects(resolveWalletHubScope(f.ctx, db), denied);
  await db.user.update({ where: { id: f.actor.id }, data: { role: "BUSINESS_OWNER" } });
  await setWalletModule(db, f.business.id, false);
  await assert.rejects(resolveWalletHubScope(f.ctx, db), denied);
});

test("Group Owner uses selected Business grant; Group Manager and revoked grants remain denied", async () => {
  const f = await walletFixture(db), home = await walletFixture(db);
  const group = await db.businessGroup.create({ data: { name: "Hub synthetic group", code: randomUUID() } });
  await db.businessGroupMember.create({ data: { groupId: group.id, businessId: f.business.id } });
  const grant = await db.businessGroupUser.create({ data: { groupId: group.id, userId: home.actor.id, role: "GROUP_OWNER" } });
  const ctx = { businessId: f.business.id, user: { userId: home.actor.id } };
  assert.equal((await resolveWalletHubScope(ctx, db)).businessId, f.business.id);
  await db.businessGroupUser.update({ where: { id: grant.id }, data: { role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES" } });
  await db.businessGroupUserBusinessAccess.create({ data: { groupUserId: grant.id, businessId: f.business.id } });
  await assert.rejects(resolveWalletHubScope(ctx, db), denied);
  await db.businessGroupUser.update({ where: { id: grant.id }, data: { role: "GROUP_OWNER", status: "REVOKED" } });
  await assert.rejects(resolveWalletHubScope(ctx, db), denied);
});

test("explicit unknown/foreign Branch fails closed; inactive historical Branch remains readable", async () => {
  const f = await walletFixture(db), foreign = await walletFixture(db);
  for (const branchId of [randomUUID(), foreign.branch.id]) {
    await assert.rejects(readWalletHubTransactions({ ...f.ctx, branchId }, window, db), denied);
  }
  await db.branch.update({ where: { id: f.branch.id }, data: { status: "INACTIVE" } });
  assert.equal((await resolveWalletHubScope(f.ctx, db)).branchId, f.branch.id);
});

test("current Paid80+Bonus20=100 ignores date/Branch; event dates are half-open, and reads do not create accounts", async () => {
  const f = await walletFixture(db, "80", "20");
  await postWalletTopUp(f.ctx, f.input, db);
  const payment = await db.payment.findFirstOrThrow({ where: { businessId: f.business.id, purpose: "WALLET_TOP_UP" } });
  const eventAt = new Date("2026-10-01T00:00:00Z");
  await db.payment.update({ where: { id: payment.id }, data: { paidAt: eventAt } });
  const other = await db.branch.create({ data: { businessId: f.business.id, name: "Other synthetic branch" } });
  const emptyCustomer = await db.customer.create({ data: { businessId: f.business.id, name: "No account", phone: randomUUID() } });
  for (const [branchId, fromDate, toDateExclusive, expected] of [
    [undefined, eventAt, new Date("2026-11-01Z"), "80.00"],
    [undefined, new Date("2026-09-01Z"), eventAt, "0.00"],
    [other.id, eventAt, new Date("2026-11-01Z"), "0.00"],
  ] as const) {
    const result = await readWalletHubOverview({ ...f.ctx, branchId }, { fromDate, toDateExclusive }, db);
    assert.deepEqual(result.currentBalance, { paid: "80.00", bonus: "20.00", total: "100.00" });
    assert.equal(result.period.topUps, expected);
    assert.equal(result.period.topUpBonus, expected === "80.00" ? "20.00" : "0.00");
    const transactions = await readWalletHubTransactions({ ...f.ctx, branchId }, { fromDate, toDateExclusive }, db);
    assert.equal(transactions.rows.length, expected === "80.00" ? 1 : 0);
  }
  const balances = await readWalletHubCustomerBalances(f.ctx, {}, db);
  assert.equal(balances.rows.length, 1);
  assert.equal(balances.rows[0].totalBalance, "100.00");
  assert.equal(await db.walletAccount.count({ where: { customerId: emptyCustomer.id } }), 0);
});

test("activity-first cursor pagination keeps Paid+Bonus together with deterministic same-date order, exact decimals and last snapshots", async () => {
  const f = await walletFixture(db, "0.10", "0.20");
  for (let i = 0; i < 22; i++) await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
  await db.payment.updateMany({ where: { businessId: f.business.id }, data: { paidAt: new Date("2026-10-03Z") } });
  const ctx = { ...f.ctx, branchId: undefined };
  const first = await readWalletHubTransactions(ctx, window, db);
  assert.equal(first.rows.length, 20); assert.ok(first.nextCursor);
  const second = await readWalletHubTransactions(ctx, { ...window, cursor: first.nextCursor }, db);
  assert.equal(second.rows.length, 2); assert.equal(second.nextCursor, null);
  const all = [...first.rows, ...second.rows];
  assert.equal(new Set(all.map(row => row.id)).size, 22);
  assert.deepEqual(all.map(row => row.id), all.map(row => row.id).sort().reverse());
  for (const row of all) {
    assert.equal(row.type, "TOP_UP"); assert.equal(row.amount, "0.30");
    assert.equal(row.paidAmount, "0.10"); assert.equal(row.bonusAmount, "0.20");
    assert.equal(row.paymentMethod, "CASH"); assert.equal(row.invoiceId, null);
  }
  const ledger = await db.walletTransaction.findMany({ where: { businessId: f.business.id }, orderBy: { sequence: "desc" } });
  for (const row of all) {
    const last = ledger.find(entry => row.id === `${entry.walletAccountId}:${entry.financialOperationId}`)!;
    assert.equal(row.balanceAfterPaid, last.paidBalanceAfter.toFixed(2));
    assert.equal(row.balanceAfterBonus, last.bonusBalanceAfter.toFixed(2));
  }
  assert.equal((await readWalletHubOverview(ctx, window, db)).currentBalance.total, "6.60");
  assert.equal((await readWalletHubTransactions(ctx, { ...window, type: "WALLET_USED" }, db)).rows.length, 0);
  assert.equal((await readWalletHubTransactions(ctx, { ...window, search: "no matching customer" }, db)).rows.length, 0);
  assert.equal((await readWalletHubTransactions(ctx, { ...window, pageSize: 50 }, db)).rows.length, 22);
  const topUps = await readWalletHubTopUps(ctx, window, db);
  assert.equal(topUps.rows.length, 20); assert.ok(topUps.nextCursor);
  const remaining = await readWalletHubTopUps(ctx, { ...window, cursor: topUps.nextCursor }, db);
  assert.equal(remaining.rows.length, 2);
  assert.equal(new Set([...topUps.rows, ...remaining.rows].map(row => row.topUpId)).size, 22);
});

test("Top-ups derive Posted/Reversed from real relations and period reversal is separate", async () => {
  const f = await walletFixture(db, "10", "2");
  const first = await postWalletTopUp(f.ctx, f.input, db);
  const refundedAt = new Date("2026-10-10T00:00:00Z");
  await historicalReversal(f, first.topUpId, f.branch.id, refundedAt);
  await postWalletTopUp(f.ctx, { ...f.input, operationKey: randomUUID() }, db);
  const result = await readWalletHubTopUps(f.ctx, window, db);
  assert.deepEqual(result.rows.map(row => row.status).sort(), ["Posted", "Reversed"]);
  assert.ok(result.rows.every(row => row.paidAmount === "10.00" && row.bonusAmount === "2.00" && row.totalAdded === "12.00"));
  const activity = await readWalletHubTransactions(f.ctx, { ...window, type: "TOP_UP_REVERSAL" }, db);
  assert.equal(activity.rows.length, 1); assert.equal(activity.rows[0].amount, "-12.00");
  const overview = await readWalletHubOverview(f.ctx, window, db);
  assert.equal(overview.period.topUps, "20.00"); assert.equal(overview.period.topUpReversals, "12.00");
  const page = await readWalletHubTopUps(f.ctx, { ...window, pageSize: 20 }, db);
  assert.equal(page.rows[0].paymentMethod, "CASH");
  const narrow = { fromDate: refundedAt, toDateExclusive: new Date(refundedAt.getTime() + 1) };
  assert.equal((await readWalletHubTransactions(f.ctx, { ...narrow, type: "TOP_UP_REVERSAL" }, db)).rows[0].date.toISOString(), refundedAt.toISOString());
  assert.equal((await readWalletHubOverview(f.ctx, narrow, db)).period.topUpReversals, "12.00");
  assert.equal((await readWalletHubTransactions(f.ctx, { fromDate: new Date(refundedAt.getTime() - 1), toDateExclusive: refundedAt, type: "TOP_UP_REVERSAL" }, db)).rows.length, 0);
});

test("Customer balances batch last activity, search and cursor order; read-only transaction forbids hidden writes", async () => {
  const f = await walletFixture(db, "1", "0");
  for (let i = 0; i < 21; i++) {
    const customer = await db.customer.create({ data: { businessId: f.business.id, name: "Hub customer", phone: randomUUID() } });
    await postWalletTopUp(f.ctx, { ...f.input, customerId: customer.id, operationKey: randomUUID() }, db);
  }
  const first = await readWalletHubCustomerBalances(f.ctx, { search: "Hub customer" }, db);
  assert.equal(first.rows.length, 20); assert.ok(first.nextCursor);
  const second = await readWalletHubCustomerBalances(f.ctx, { search: "Hub customer", cursor: first.nextCursor }, db);
  assert.equal(second.rows.length, 1);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.customerId)).size, 21);
  const last = await db.walletTransaction.groupBy({ by: ["walletAccountId"], where: { businessId: f.business.id }, _max: { createdAt: true } });
  const accounts = await db.walletAccount.findMany({ where: { businessId: f.business.id } });
  for (const row of first.rows) {
    const account = accounts.find(account => account.customerId === row.customerId)!;
    assert.equal(row.lastActivityAt?.toISOString(), last.find(entry => entry.walletAccountId === account.id)!._max.createdAt!.toISOString());
  }
  let queries = 0;
  const measured = db.$extends({ query: { walletTransaction: { async groupBy({ args, query }) { queries++; return query(args); } } } });
  // Extension retains Prisma's public reader contract; no per-customer aggregate is allowed.
  await readWalletHubCustomerBalances(f.ctx, {}, measured as unknown as typeof db);
  assert.equal(queries, 1);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const adapter = new Proxy(db, { get(target, key) { return key === "$transaction" ? async (run: (client: Prisma.TransactionClient) => unknown) => run(tx) : Reflect.get(target, key); } });
    await readWalletHubOverview(f.ctx, window, adapter);
    await readWalletHubTransactions(f.ctx, window, adapter);
    await readWalletHubTopUps(f.ctx, window, adapter);
    await readWalletHubCustomerBalances(f.ctx, {}, adapter);
  });
});

test("normal refund differs from VOID restore", async () => {
  const h = await checkoutHarness();
  try {
    const f = await checkoutFixture(db); await h.login(db, f);
    const sale = await h.action.completeCashierSaleAction(f.form); assert.equal(sale.status, "success", sale.message);
    const payment = await db.payment.findFirstOrThrow({ where: { invoiceId: sale.invoice!.id } });
    await refundWalletSale(f.ctx, { operationKey: randomUUID(), invoiceId: sale.invoice!.id, reason: "Hub synthetic refund", stockLines: [], legs: [{ paymentId: payment.id, method: "MEMBER_WALLET", amountCents: 1000 }] }, db);
    const ctx = { ...f.ctx, branchId: undefined };
    assert.equal((await readWalletHubTransactions(ctx, { ...window, type: "WALLET_REFUND" }, db)).rows[0].amount, "10.00");
    const service = await db.service.create({ data: { businessId: f.business.id, name: "Hub synthetic service", price: 5, taxable: false } });
    const visit = await db.appointment.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, assignedStaffId: f.actor.id, serviceId: service.id, serviceIds: [service.id], scheduledAt: new Date(), status: "COMPLETED" } });
    f.form.delete("productId"); f.form.delete("productQuantity");
    for (const [key, value] of Object.entries({ operationId: randomUUID(), serviceId: service.id, serviceQuantity: "1", appointmentId: visit.id, assignedStaffId: f.actor.id, walletAmount: "5" })) f.form.set(key, value);
    const serviceSale = await h.action.completeCashierSaleAction(f.form); assert.equal(serviceSale.status, "success", serviceSale.message);
    const form = new FormData(); form.set("invoiceId", serviceSale.invoice!.id); form.set("operationId", randomUUID()); form.set("voidReason", "Hub synthetic correction");
    assert.equal((await h.invoices.voidInvoiceAction({ status: "idle", message: "" }, form)).status, "success");
    const restore = (await readWalletHubTransactions(ctx, { ...window, type: "VOID_RESTORE" }, db)).rows;
    assert.equal(restore.length, 1); assert.equal(restore[0].amount, "5.00");
    const summary = await readWalletHubOverview(ctx, window, db);
    assert.equal(summary.period.walletUsed, "45.00"); assert.equal(summary.period.walletRefunds, "10.00"); assert.equal(summary.period.voidRestores, "5.00");
    const refund = await db.paymentRefund.findFirstOrThrow({ where: { paymentId: payment.id } });
    const refundedAt = refund.refundedAt;
    assert.equal((await readWalletHubTransactions(ctx, { fromDate: refundedAt, toDateExclusive: new Date(refundedAt.getTime() + 1), type: "WALLET_REFUND" }, db)).rows[0].date.toISOString(), refundedAt.toISOString());
    assert.equal((await readWalletHubTransactions(ctx, { fromDate: new Date(refundedAt.getTime() - 1), toDateExclusive: refundedAt, type: "WALLET_REFUND" }, db)).rows.length, 0);
    const restoredAt = restore[0].date;
    assert.equal((await readWalletHubTransactions(ctx, { fromDate: restoredAt, toDateExclusive: new Date(restoredAt.getTime() + 1), type: "VOID_RESTORE" }, db)).rows.length, 1);
    assert.equal((await readWalletHubTransactions(ctx, { fromDate: new Date(restoredAt.getTime() - 1), toDateExclusive: restoredAt, type: "VOID_RESTORE" }, db)).rows.length, 0);
  } finally { await h.close(); }
});

test("schema-valid historical null-Branch activity is included business-wide and excluded by explicit Branch", async () => {
  const f = await walletFixture(db, "1", "0");
  const top = await postWalletTopUp(f.ctx, f.input, db);
  await historicalReversal(f, top.topUpId, null);
  const all = await readWalletHubTransactions({ ...f.ctx, branchId: undefined }, { ...window, type: "TOP_UP_REVERSAL" }, db);
  assert.equal(all.rows.length, 1); assert.equal(all.rows[0].branchId, null); assert.equal(all.rows[0].branchName, null);
  assert.equal((await readWalletHubTransactions(f.ctx, { ...window, type: "TOP_UP_REVERSAL" }, db)).rows.length, 0);
  assert.equal((await readWalletHubOverview({ ...f.ctx, branchId: undefined }, window, db)).period.topUpReversals, "1.00");
  assert.equal((await readWalletHubOverview(f.ctx, window, db)).period.topUpReversals, "0.00");
});

test("multiple accounts with identical sequence/time retain independent snapshots and stable global pagination", async () => {
  const f = await walletFixture(db, "0.10", "0.20");
  for (let i = 0; i < 21; i++) {
    const customer = await db.customer.create({ data: { businessId: f.business.id, name: `Hub account ${i}`, phone: randomUUID() } });
    await postWalletTopUp(f.ctx, { ...f.input, customerId: customer.id, operationKey: randomUUID() }, db);
  }
  await db.payment.updateMany({ where: { businessId: f.business.id }, data: { paidAt: new Date("2026-10-04Z") } });
  const first = await readWalletHubTransactions(f.ctx, window, db); assert.equal(first.rows.length, 20); assert.ok(first.nextCursor);
  const second = await readWalletHubTransactions(f.ctx, { ...window, cursor: first.nextCursor }, db); assert.equal(second.rows.length, 1);
  const all = [...first.rows, ...second.rows];
  assert.equal(new Set(all.map(row => row.customerId)).size, 21);
  assert.deepEqual(all.map(row => row.id), all.map(row => row.id).sort().reverse());
  assert.ok(all.every(row => row.balanceAfterPaid === "0.10" && row.balanceAfterBonus === "0.20" && row.balanceAfterTotal === "0.30"));
});
