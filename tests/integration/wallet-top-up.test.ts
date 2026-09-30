import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletTestDatabase, walletFixture, assertNoWalletMoney } from "../helpers/wallet-fixture";

const db = walletTestDatabase();
after(() => db.$disconnect());
// Dynamic import keeps a missing P1B implementation an explicit RED assertion.
async function service() {
  const module = await import("../../src/lib/wallet/top-up").catch(() => null);
  assert.ok(module?.postWalletTopUp, "P1B postWalletTopUp must exist");
  return module.postWalletTopUp;
}
async function summary() { return (await import("../../src/lib/wallet/read-model")).getWalletSummary; }

for (const [paid, bonus, total, rows] of [["1000", "100", "1100.00", 2], ["5000", "1000", "6000.00", 2], ["100", "0", "100.00", 1]] as const) {
  test(`top-up ${paid}+${bonus}: exact payment, separate ledger and atomic audit, no invoice`, async () => {
    const post = await service();
    const f = await walletFixture(db, paid, bonus);
    const result = await post(f.ctx, { ...f.input, reference: "synthetic-ref" }, db);
    assert.equal(result.totalBalance, total);
    assert.equal(result.replayed, false);
    const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
    assert.equal(payment.amount.toString(), paid);
    assert.equal(payment.purpose, "WALLET_TOP_UP");
    assert.equal(payment.invoiceId, null);
    assert.equal(payment.reference, "synthetic-ref");
    assert.equal(payment.method, "CASH");
    assert.equal(payment.cashierId, f.actor.id);
    assert.equal(payment.shiftId, f.shift.id);
    assert.equal(await db.invoice.count({ where: { businessId: f.business.id } }), 0);
    const ledger = await db.walletTransaction.findMany({ where: { walletAccountId: result.walletAccountId }, orderBy: { sequence: "asc" } });
    assert.equal(ledger.length, rows);
    assert.equal(ledger[0].type, "TOP_UP_PAID");
    assert.equal(ledger[0].paidDelta.toString(), paid);
    assert.equal(ledger[0].bonusDelta.toString(), "0");
    if (rows === 2) {
      assert.equal(ledger[1].type, "TOP_UP_BONUS");
      assert.equal(ledger[1].paidDelta.toString(), "0");
      assert.equal(ledger[1].bonusDelta.toString(), bonus);
    }
    const account = await db.walletAccount.findUniqueOrThrow({ where: { id: result.walletAccountId } });
    assert.equal(account.version, rows);
    const audit = await db.auditLog.findFirstOrThrow({ where: { businessId: f.business.id } });
    assert.equal(audit.actorUserId, f.actor.id);
    assert.equal(audit.entityId, result.topUpId);
    assert.equal(audit.branchId, f.branch.id);
    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata.customerId, f.customer.id);
    assert.equal(metadata.paymentId, result.paymentId);
    assert.equal(metadata.operationKey, f.input.operationKey);
    assert.equal(metadata.totalCredited, total);
    await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { bonusAmount: 150, version: { increment: 1 }, name: "Changed offer" } });
    const snapshot = await db.walletTopUp.findUniqueOrThrow({ where: { id: result.topUpId } });
    assert.equal(snapshot.bonusAmount.toString(), bonus);
    assert.equal(snapshot.offerNameSnapshot, "Synthetic offer");
    assert.equal(snapshot.offerVersion, 0);
    assert.equal((await (await summary())(f.ctx, f.customer.id, db)).totalBalance, total);
  });
}

for (const kind of ["stale", "inactive", "foreign-offer", "foreign-customer", "no-shift", "foreign-shift", "foreign-branch", "other-cashier", "closed-shift", "old-shift", "inactive-branch", "inactive-user", "disabled-module"] as const) {
  test(`rejects ${kind} without partial money state`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    const other = await walletFixture(db);
    if (kind === "stale") await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { version: 1, bonusAmount: 150 } });
    if (kind === "inactive") await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { active: false } });
    if (kind === "foreign-offer") f.input.offerId = other.offer.id;
    if (kind === "foreign-customer") f.input.customerId = other.customer.id;
    if (kind === "no-shift") f.ctx.shiftId = randomUUID();
    if (kind === "foreign-shift") f.ctx.shiftId = other.shift.id;
    if (kind === "foreign-branch") f.ctx.branchId = other.branch.id;
    if (kind === "other-cashier") await db.cashierShift.update({ where: { id: f.shift.id }, data: { cashierId: other.actor.id } });
    if (kind === "closed-shift") await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
    if (kind === "old-shift") await db.cashierShift.update({ where: { id: f.shift.id }, data: { startedAt: new Date(0) } });
    if (kind === "inactive-branch") await db.branch.update({ where: { id: f.branch.id }, data: { status: "INACTIVE" } });
    if (kind === "inactive-user") await db.user.update({ where: { id: f.actor.id }, data: { loginEnabled: false } });
    if (kind === "disabled-module") await db.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id }, data: { status: "DISABLED", revision: { increment: 1 } } });
    if (kind === "stale") await assert.rejects(post(f.ctx, f.input, db), { code: "OFFER_CHANGED_RECONFIRM" });
    else await assert.rejects(post(f.ctx, f.input, db));
    await assertNoWalletMoney(db, f.business.id);
  });
}

for (const permissions of [[], ["CRM"], ["POS"], ["CRM", "JOBS"], ["CRM", "POS"]]) {
  test(`staff top-up rights ${JSON.stringify(permissions)}`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions } });
    if (permissions.includes("CRM") && permissions.includes("POS")) assert.equal((await post(f.ctx, f.input, db)).totalBalance, "1100.00");
    else { await assert.rejects(post(f.ctx, f.input, db), { code: "WALLET_ACCESS_DENIED" }); await assertNoWalletMoney(db, f.business.id); }
  });
}

for (const method of ["CASH", "CARD", "DUITNOW", "EWALLET", "BANK_TRANSFER"] as const) {
  test(`active MYR ${method} records only paid principal`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    const result = await post(f.ctx, { ...f.input, paymentMethodCode: `BUILTIN_${method}` }, db);
    assert.equal((await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } })).method, method);
  });
}
for (const code of ["MEMBER_WALLET", "PACKAGE", "FOREIGN_CURRENCY", "CRYPTO", "BUILTIN_TRAINING_COMPLIMENTARY", "inactive", "foreign-config", "non-myr"]) {
  test(`denies payment configuration ${code}`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    if (["inactive", "foreign-config", "non-myr"].includes(code)) {
      const businessId = code === "foreign-config" ? (await walletFixture(db)).business.id : f.business.id;
      await db.businessPaymentMethod.create({ data: { businessId, code, label: code, normalizedLabel: code, canonicalMethod: "CASH", active: code !== "inactive", settlementCurrency: code === "non-myr" ? "USD" : "MYR" } });
    }
    await assert.rejects(post(f.ctx, { ...f.input, paymentMethodCode: code }, db), { code: "WALLET_PAYMENT_METHOD_DENIED" });
    await assertNoWalletMoney(db, f.business.id);
  });
}

test("summary never creates an account and denies foreign customers and unprivileged staff", async () => {
  await service();
  const read = await summary();
  const f = await walletFixture(db);
  const other = await walletFixture(db);
  assert.deepEqual(await read(f.ctx, f.customer.id, db), { hasAccount: false, walletAccountId: null, paidBalance: "0.00", bonusBalance: "0.00", totalBalance: "0.00" });
  await assertNoWalletMoney(db, f.business.id);
  await assert.rejects(read(f.ctx, other.customer.id, db));
  for (const permissions of [[], ["CRM"], ["POS"]]) {
    await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions } });
    if (!permissions.length) await assert.rejects(read(f.ctx, f.customer.id, db));
    else assert.equal((await read(f.ctx, f.customer.id, db)).hasAccount, false);
  }
});

test("staff cannot use another same-business branch or escalate via supplied role", async () => {
  const post = await service();
  const f = await walletFixture(db);
  const branch = await db.branch.create({ data: { businessId: f.business.id, name: "Other branch" } });
  await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["CRM", "POS", "ALL_BRANCHES"] } });
  await assert.rejects(post({ ...f.ctx, branchId: branch.id, user: { userId: f.actor.id, role: "BUSINESS_OWNER" } } as typeof f.ctx, f.input, db), { code: "WALLET_ACCESS_DENIED" });
  await assertNoWalletMoney(db, f.business.id);
});

test("group read-only and platform admin do not gain top-up rights", async () => {
  const post = await service();
  const f = await walletFixture(db);
  const group = await db.businessGroup.create({ data: { name: "Synthetic group", code: randomUUID() } });
  await db.businessGroupMember.create({ data: { groupId: group.id, businessId: f.business.id } });
  const manager = await db.user.create({ data: { name: "Synthetic group manager", role: "STAFF", permissions: ["CRM", "POS"] } });
  await db.businessGroupUser.create({ data: { groupId: group.id, userId: manager.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES", businessAccesses: { create: { businessId: f.business.id } } } });
  await assert.rejects(post({ ...f.ctx, user: { userId: manager.id } }, f.input, db), { code: "WALLET_ACCESS_DENIED" });
  await db.user.update({ where: { id: manager.id }, data: { role: "PLATFORM_ADMIN" } });
  await assert.rejects(post({ ...f.ctx, user: { userId: manager.id } }, f.input, db), { code: "WALLET_ACCESS_DENIED" });
  await assertNoWalletMoney(db, f.business.id);
});

test("client cannot supply authoritative financial or scope fields", async () => {
  const post = await service();
  const f = await walletFixture(db);
  for (const field of ["paidAmount", "bonusAmount", "walletBalance", "businessId", "actorUserId"]) {
    await assert.rejects(post(f.ctx, { ...f.input, [field]: "spoof" }, db));
  }
  await assertNoWalletMoney(db, f.business.id);
});

test("persisted active MYR config is snapshotted; disabled builtin cannot fall back", async () => {
  const post = await service();
  const f = await walletFixture(db, "12.34", "0.01");
  const method = await db.businessPaymentMethod.create({ data: { businessId: f.business.id, code: "CUSTOM_CARD", label: "Terminal card", normalizedLabel: "terminal card", canonicalMethod: "CARD" } });
  const result = await post(f.ctx, { ...f.input, paymentMethodCode: method.code }, db);
  assert.equal(result.totalBalance, "12.35");
  const payment = await db.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
  assert.equal(payment.businessPaymentMethodId, method.id);
  assert.equal(payment.paymentMethodLabel, "Terminal card");
  assert.equal(payment.tenderAmount!.toString(), "12.34");
  await db.businessPaymentMethod.create({ data: { businessId: f.business.id, code: "BUILTIN_CASH", label: "Cash", normalizedLabel: "cash", canonicalMethod: "CASH", builtIn: true, active: false } });
  await assert.rejects(post(f.ctx, { ...f.input, operationKey: randomUUID() }, db), { code: "WALLET_PAYMENT_METHOD_DENIED" });
  assert.equal(await db.walletTopUp.count({ where: { businessId: f.business.id } }), 1);
});

for (const invalid of [
  { canonicalMethod: "MEMBER_WALLET", paymentKind: "LOCAL_TENDER" },
  { canonicalMethod: "PACKAGE", paymentKind: "LOCAL_TENDER" },
  { canonicalMethod: "FOREIGN_CURRENCY", paymentKind: "LOCAL_TENDER" },
  { canonicalMethod: "CRYPTO", paymentKind: "LOCAL_TENDER" },
  { canonicalMethod: "CASH", paymentKind: "FOREIGN_CURRENCY" },
  { canonicalMethod: "CARD", paymentKind: "CRYPTO_ASSET" },
] as const) {
  test(`persisted config rejects ${invalid.canonicalMethod}/${invalid.paymentKind} even with ordinary code and MYR`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    await db.businessPaymentMethod.create({ data: { businessId: f.business.id, code: "CUSTOM_TENDER", label: "Synthetic invalid tender", normalizedLabel: "synthetic invalid tender", ...invalid } });
    await assert.rejects(post(f.ctx, { ...f.input, paymentMethodCode: "CUSTOM_TENDER" }, db), { code: "WALLET_PAYMENT_METHOD_DENIED" });
    await assertNoWalletMoney(db, f.business.id);
  });
}
