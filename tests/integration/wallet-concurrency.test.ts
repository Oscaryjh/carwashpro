import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { walletFixture, walletTestDatabase, assertNoWalletMoney } from "../helpers/wallet-fixture";

const db = walletTestDatabase();
after(() => db.$disconnect());
async function service() {
  const module = await import("../../src/lib/wallet/top-up").catch(() => null);
  assert.ok(module?.postWalletTopUp, "P1B postWalletTopUp must exist");
  return module.postWalletTopUp;
}

test("same intent concurrent and sequential replay produces exactly one money graph", async () => {
  const post = await service();
  const f = await walletFixture(db);
  const results = await Promise.all([post(f.ctx, f.input, db), post(f.ctx, f.input, db), post(f.ctx, f.input, db)]);
  assert.equal(results.filter(r => !r.replayed).length, 1);
  assert.equal(new Set(results.map(r => r.topUpId)).size, 1);
  assert.equal(new Set(results.map(r => r.paymentId)).size, 1);
  const replay = await post(f.ctx, f.input, db);
  assert.deepEqual(replay, { ...results[0], replayed: true });
  assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.walletTopUp.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id } }), 2);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id } }), 1);
  assert.equal((await db.walletAccount.findFirstOrThrow({ where: { businessId: f.business.id } })).paidBalance.toString(), "1000");
});

test("operation key rejects changed customer, offer, method, reference or actor", async () => {
  const post = await service();
  const f = await walletFixture(db);
  await post(f.ctx, f.input, db);
  const customer = await db.customer.create({ data: { businessId: f.business.id, name: "Other synthetic", phone: randomUUID() } });
  const offer = await db.walletTopUpOffer.create({ data: { businessId: f.business.id, name: "Other", paidAmount: 100, bonusAmount: 0 } });
  for (const change of [{ customerId: customer.id }, { offerId: offer.id }, { paymentMethodCode: "BUILTIN_CARD" }, { reference: "different" }]) {
    await assert.rejects(post(f.ctx, { ...f.input, ...change }, db), { code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" });
  }
  const actor = await db.user.create({ data: { businessId: f.business.id, branchId: f.branch.id, name: "Another owner", role: "BUSINESS_OWNER" } });
  await assert.rejects(post({ ...f.ctx, user: { userId: actor.id } }, f.input, db), { code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" });
});

for (const existing of [false, true]) {
  test(`concurrent independent credits ${existing ? "existing account" : "first account race"} preserve sums and contiguous ledger`, async () => {
    const post = await service();
    const f = await walletFixture(db, "100", "20");
    if (existing) await post(f.ctx, f.input, db);
    const a = await db.walletTopUpOffer.create({ data: { businessId: f.business.id, name: "A", paidAmount: 1000, bonusAmount: 100 } });
    const b = await db.walletTopUpOffer.create({ data: { businessId: f.business.id, name: "B", paidAmount: 500, bonusAmount: 50 } });
    await Promise.all([a, b].map(offer => post(f.ctx, { ...f.input, offerId: offer.id, operationKey: randomUUID() }, db)));
    const accounts = await db.walletAccount.findMany({ where: { businessId: f.business.id } });
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].paidBalance.toString(), existing ? "1600" : "1500");
    assert.equal(accounts[0].bonusBalance.toString(), existing ? "170" : "150");
    assert.equal(accounts[0].version, existing ? 6 : 4);
    const ledger = await db.walletTransaction.findMany({ where: { walletAccountId: accounts[0].id }, orderBy: { sequence: "asc" } });
    assert.deepEqual(ledger.map(r => r.sequence), existing ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4]);
    assert.equal(ledger.at(-1)!.paidBalanceAfter.toString(), accounts[0].paidBalance.toString());
    assert.equal(ledger.at(-1)!.bonusBalanceAfter.toString(), accounts[0].bonusBalance.toString());
  });
}

for (const model of ["Payment", "WalletTransaction", "AuditLog"]) {
  test(`${model} write failure rolls back operation, account and all financial facts`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    // Fault only the chosen persistence boundary; the rest runs on the real DB transaction.
    const faulty = db.$extends({ query: { $allModels: { async create({ model: current, args, query }) {
      if (current === model) throw new Error(`P1B_TEST_FAIL_${model}`);
      return query(args);
    } } } });
    await assert.rejects(post(f.ctx, f.input, faulty as unknown as PrismaClient), new RegExp(`P1B_TEST_FAIL_${model}`));
    await assertNoWalletMoney(db, f.business.id);
    assert.equal((await post(f.ctx, f.input, db)).replayed, false);
  });
}

test("replay returns immutable receipt after offer change; revoked actor cannot replay", async () => {
  const post = await service();
  const f = await walletFixture(db);
  const original = await post(f.ctx, f.input, db);
  await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { version: 1, bonusAmount: 150 } });
  await db.cashierShift.update({ where: { id: f.shift.id }, data: { status: "CLOSED" } });
  assert.deepEqual(await post(f.ctx, f.input, db), { ...original, replayed: true });
  await db.user.update({ where: { id: f.actor.id }, data: { loginEnabled: false } });
  await assert.rejects(post(f.ctx, f.input, db), { code: "WALLET_ACCESS_DENIED" });
});

test("second ledger insert failure restores an existing account exactly", async () => {
  const post = await service();
  const f = await walletFixture(db);
  const original = await post(f.ctx, f.input, db);
  const before = await db.walletAccount.findUniqueOrThrow({ where: { id: original.walletAccountId } });
  const faulty = db.$extends({ query: { walletTransaction: { async create({ args, query }) {
    if (args.data.type === "TOP_UP_BONUS") throw new Error("P1B_BONUS_WRITE_FAILED");
    return query(args);
  } } } });
  await assert.rejects(post(f.ctx, { ...f.input, operationKey: randomUUID() }, faulty as unknown as PrismaClient), /P1B_BONUS_WRITE_FAILED/);
  assert.deepEqual(await db.walletAccount.findUniqueOrThrow({ where: { id: before.id } }), before);
  assert.equal(await db.walletTopUp.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.financialOperation.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.auditLog.count({ where: { businessId: f.business.id } }), 1);
  assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id } }), 2);
});

for (const revoked of ["CRM", "POS", "module"] as const) {
  test(`successful intent cannot replay after ${revoked} access is revoked`, async () => {
    const post = await service();
    const f = await walletFixture(db);
    await db.user.update({ where: { id: f.actor.id }, data: { role: "STAFF", permissions: ["CRM", "POS"] } });
    await post(f.ctx, f.input, db);
    if (revoked === "module") await db.businessModuleEntitlement.updateMany({ where: { businessId: f.business.id }, data: { status: "DISABLED", revision: { increment: 1 } } });
    else await db.user.update({ where: { id: f.actor.id }, data: { permissions: revoked === "CRM" ? ["POS"] : ["CRM"] } });
    await assert.rejects(post(f.ctx, f.input, db));
    assert.equal(await db.payment.count({ where: { businessId: f.business.id } }), 1);
    assert.equal(await db.walletTransaction.count({ where: { businessId: f.business.id } }), 2);
  });
}

test("intent fingerprint binds expected offer version, branch and shift", async () => {
  const post = await service();
  const f = await walletFixture(db);
  await post(f.ctx, f.input, db);
  const branch = await db.branch.create({ data: { businessId: f.business.id, name: "Other synthetic branch" } });
  for (const change of [{ branchId: branch.id }, { shiftId: randomUUID() }]) {
    await assert.rejects(post({ ...f.ctx, ...change }, f.input, db), { code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" });
  }
  await assert.rejects(post(f.ctx, { ...f.input, expectedOfferVersion: 1 }, db), { code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" });
});
