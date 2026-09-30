import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { getDailyClosingReport } from "../../src/lib/daily-closing/query";

const db = new PrismaClient();
const disposableUrl = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1", "::1"].includes(disposableUrl.hostname));
assert.match(disposableUrl.pathname, /disposable/);
after(() => db.$disconnect());
test("wallet foundation is present after the complete migration chain", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.match(url.pathname, /disposable/);
  const tables = await db.$queryRaw<{ name: string }[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wallet_%' ORDER BY tablename`;
  assert.deepEqual(tables.map((row) => row.name), ["wallet_accounts", "wallet_top_up_offers", "wallet_top_up_reversals", "wallet_top_ups", "wallet_transactions"]);
});

async function fixture() {
  const business = await db.business.create({ data: { name: "WALLET_P1A_TEST", slug: `wallet-${randomUUID()}` } });
  const customer = await db.customer.create({ data: { businessId: business.id, name: "Synthetic wallet customer", phone: randomUUID() } });
  return { business, customer };
}

test("account unique scope, currency and nonnegative constraints reject invalid rows", async () => {
  const a = await fixture();
  const b = await fixture();
  const account = await db.walletAccount.create({ data: { businessId: a.business.id, customerId: a.customer.id } });
  assert.equal(account.paidBalance.toString(), "0");
  assert.equal(account.bonusBalance.toString(), "0");
  await assert.rejects(db.walletAccount.create({ data: { businessId: a.business.id, customerId: a.customer.id } }));
  await assert.rejects(db.walletAccount.create({ data: { businessId: a.business.id, customerId: b.customer.id } }));
  await assert.rejects(db.walletAccount.update({ where: { id: account.id }, data: { paidBalance: -1 } }));
  await assert.rejects(db.walletAccount.update({ where: { id: account.id }, data: { bonusBalance: -1 } }));
  await assert.rejects(db.walletAccount.update({ where: { id: account.id }, data: { currency: "USD" } }));
});

test("offer has exact nonnegative terms and an optimistic version foundation", async () => {
  const a = await fixture();
  await assert.rejects(db.walletTopUpOffer.create({ data: { businessId: a.business.id, name: "Invalid", paidAmount: 0, bonusAmount: 1 } }));
  await assert.rejects(db.walletTopUpOffer.create({ data: { businessId: a.business.id, name: "Invalid", paidAmount: 1, bonusAmount: -1 } }));
  const offer = await db.walletTopUpOffer.create({ data: { businessId: a.business.id, name: "1000", paidAmount: 1000, bonusAmount: 100 } });
  assert.equal((await db.walletTopUpOffer.updateMany({ where: { id: offer.id, version: 0 }, data: { bonusAmount: 150, version: { increment: 1 } } })).count, 1);
  assert.equal((await db.walletTopUpOffer.updateMany({ where: { id: offer.id, version: 0 }, data: { bonusAmount: 200, version: { increment: 1 } } })).count, 0);
});

test("member wallet payment cannot commit without its ledger", async () => {
  const a = await fixture();
  const invoice = await db.invoice.create({ data: { businessId: a.business.id, customerId: a.customer.id, invoiceNumber: randomUUID(), subtotal: 80, total: 80, paidAmount: 0, balance: 80 } });
  await assert.rejects(db.payment.create({ data: { businessId: a.business.id, invoiceId: invoice.id, amount: 80, method: "MEMBER_WALLET", purpose: "SALE" } }), /WALLET_PAYMENT_REQUIRES_LEDGER/);
  const payment = await db.payment.create({ data: { businessId: a.business.id, amount: 20, method: "CARD" } });
  assert.equal(payment.purpose, "LEGACY");
});

// Test-only graph fixtures: no production top-up or redemption command exists in P1A.
async function postedFixture(paid = 100, status: "ACTIVE" | "VOID" = "ACTIVE") {
  const { business, customer } = await fixture();
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Wallet synthetic branch" } });
  const actor = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Wallet synthetic owner", role: "BUSINESS_OWNER" } });
  const shift = await db.cashierShift.create({ data: { businessId: business.id, branchId: branch.id, cashierId: actor.id } });
  const offer = await db.walletTopUpOffer.create({ data: { businessId: business.id, name: "Synthetic topup", paidAmount: paid, bonusAmount: 10 } });
  return db.$transaction(async (tx) => {
    const account = await tx.walletAccount.create({ data: { businessId: business.id, customerId: customer.id, paidBalance: paid, bonusBalance: 10, version: 2 } });
    const operation = await tx.financialOperation.create({ data: { businessId: business.id, branchId: branch.id, actorUserId: actor.id, operationType: "WALLET_TOP_UP", operationKey: randomUUID(), requestFingerprint: "a".repeat(64) } });
    const payment = await tx.payment.create({ data: { businessId: business.id, branchId: branch.id, shiftId: shift.id, amount: paid, method: "CASH", purpose: "WALLET_TOP_UP", status } });
    const topup = await tx.walletTopUp.create({ data: { businessId: business.id, walletAccountId: account.id, offerId: offer.id, offerVersion: 0, offerNameSnapshot: offer.name, paidAmount: paid, bonusAmount: 10, totalCredited: paid + 10, externalPaymentId: payment.id, financialOperationId: operation.id, branchId: branch.id, shiftId: shift.id, actorUserId: actor.id } });
    const base = { businessId: business.id, walletAccountId: account.id, topUpId: topup.id, financialOperationId: operation.id, branchId: branch.id, actorUserId: actor.id, policyVersion: "P1A_TEST" };
    const entry = await tx.walletTransaction.create({ data: { ...base, sequence: 1, type: "TOP_UP_PAID", paidDelta: paid, bonusDelta: 0, paidBalanceAfter: paid, bonusBalanceAfter: 0, entryKey: "paid" } });
    await tx.walletTransaction.create({ data: { ...base, sequence: 2, type: "TOP_UP_BONUS", paidDelta: 0, bonusDelta: 10, paidBalanceAfter: paid, bonusBalanceAfter: 10, entryKey: "bonus" } });
    return { business, customer, branch, actor, shift, offer, account, payment, topup, entry, operation };
  });
}

test("immutable history, source uniqueness, snapshots and source payment are protected", async () => {
  const f = await postedFixture();
  await assert.rejects(db.walletTransaction.update({ where: { id: f.entry.id }, data: { reason: "rewrite" } }));
  await assert.rejects(db.walletTransaction.delete({ where: { id: f.entry.id } }));
  await assert.rejects(db.walletTopUp.update({ where: { id: f.topup.id }, data: { offerNameSnapshot: "rewrite" } }));
  await assert.rejects(db.walletTopUp.delete({ where: { id: f.topup.id } }));
  await assert.rejects(db.payment.update({ where: { id: f.payment.id }, data: { amount: 101 } }));
  await assert.rejects(db.payment.update({ where: { id: f.payment.id }, data: { purpose: "LEGACY" } }));
  const anotherCustomer = await db.customer.create({ data: { businessId: f.business.id, name: "Other synthetic", phone: randomUUID() } });
  await assert.rejects(db.walletAccount.update({ where: { id: f.account.id }, data: { customerId: anotherCustomer.id } }));
  await assert.rejects(db.walletAccount.update({ where: { id: f.account.id }, data: { paidBalance: 999 } }));
  const { id: _id, ...entry } = f.entry;
  await assert.rejects(db.walletTransaction.create({ data: { ...entry, id: randomUUID() } }));
  await assert.rejects(db.walletTransaction.create({ data: { ...entry, id: randomUUID(), sequence: 3, entryKey: "another" } }));
  await db.walletTopUpOffer.update({ where: { id: f.offer.id }, data: { bonusAmount: 15, version: { increment: 1 } } });
  assert.equal((await db.walletTopUp.findUniqueOrThrow({ where: { id: f.topup.id } })).bonusAmount.toString(), "10");
});

test("void external payment cannot fund a wallet", async () => {
  await assert.rejects(postedFixture(100, "VOID"), /WALLET_TOP_UP_GRAPH_MISMATCH/);
});

test("wallet source FKs reject foreign account, offer, payment and operation", async () => {
  const a = await postedFixture();
  const b = await postedFixture();
  const { id: _id, ...source } = a.topup;
  const foreignPayment = await db.payment.create({ data: { businessId: b.business.id, amount: 100, method: "CASH" } });
  const foreignOperation = await db.financialOperation.create({ data: { businessId: b.business.id, actorUserId: b.actor.id, operationType: "WALLET_TOP_UP", operationKey: randomUUID(), requestFingerprint: "e".repeat(64) } });
  for (const injected of [{ walletAccountId: b.account.id }, { offerId: b.offer.id }, { externalPaymentId: foreignPayment.id }, { financialOperationId: foreignOperation.id }, { branchId: b.branch.id }, { shiftId: b.shift.id }]) {
    await assert.rejects(db.$transaction(async tx => {
      const payment = await tx.payment.create({ data: { businessId: a.business.id, amount: 100, method: "CASH", purpose: "WALLET_TOP_UP", branchId: a.branch.id, shiftId: a.shift.id } });
      const operation = await tx.financialOperation.create({ data: { businessId: a.business.id, actorUserId: a.actor.id, operationType: "WALLET_TOP_UP", operationKey: randomUUID(), requestFingerprint: "f".repeat(64) } });
      await tx.walletTopUp.create({ data: { ...source, id: randomUUID(), externalPaymentId: payment.id, financialOperationId: operation.id, ...injected } });
    }), (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
  }
  await assert.rejects(db.walletTransaction.create({ data: { businessId: a.business.id, walletAccountId: a.account.id, sequence: 3, type: "ADJUSTMENT", paidDelta: 1, bonusDelta: 0, paidBalanceAfter: 101, bonusBalanceAfter: 10, policyVersion: "P1A_TEST", financialOperationId: a.operation.id, entryKey: "forbidden", actorUserId: a.actor.id } }));
});

test("a reversed redemption cannot be reactivated and invoice identity stays protected", async () => {
  const f = await postedFixture();
  const graph = await db.$transaction(async tx => {
    const invoice = await tx.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, invoiceNumber: randomUUID(), subtotal: 80, total: 80, paidAmount: 80, balance: 0, status: "PAID" } });
    const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: invoice.id, amount: 80, method: "MEMBER_WALLET", purpose: "SALE" } });
    const operation = await tx.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "CASHIER_CHECKOUT", operationKey: randomUUID(), requestFingerprint: "c".repeat(64) } });
    const ledger = await tx.walletTransaction.create({ data: { businessId: f.business.id, walletAccountId: f.account.id, sequence: 3, type: "REDEMPTION", paidDelta: -70, bonusDelta: -10, paidBalanceAfter: 30, bonusBalanceAfter: 0, policyVersion: "BONUS_FIRST_V1", financialOperationId: operation.id, entryKey: "debit", paymentId: payment.id, actorUserId: f.actor.id, branchId: f.branch.id } });
    await tx.walletAccount.update({ where: { id: f.account.id }, data: { paidBalance: 30, bonusBalance: 0, version: 3 } });
    return { invoice, payment, ledger };
  });
  await assert.rejects(db.payment.update({ where: { id: graph.payment.id }, data: { status: "VOID" } }), /WALLET_VOID_REQUIRES_REVERSAL/);
  await assert.rejects(getDailyClosingReport({ businessId: f.business.id, branchId: f.branch.id, industryType: "SALON_BEAUTY" }, db), /MEMBER_WALLET_CLOSING_NOT_SUPPORTED/);
  await assert.rejects(db.invoice.update({ where: { id: graph.invoice.id }, data: { customerId: null } }), /WALLET_INVOICE_IDENTITY_IMMUTABLE/);
  await db.$transaction(async tx => {
    await tx.payment.update({ where: { id: graph.payment.id }, data: { status: "VOID" } });
    const op = await tx.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "INVOICE_VOID", operationKey: randomUUID(), requestFingerprint: "d".repeat(64) } });
    await tx.walletTransaction.create({ data: { businessId: f.business.id, walletAccountId: f.account.id, sequence: 4, type: "REVERSAL", paidDelta: 70, bonusDelta: 10, paidBalanceAfter: 100, bonusBalanceAfter: 10, originalTransactionId: graph.ledger.id, policyVersion: "P1A_TEST", financialOperationId: op.id, entryKey: "reverse", actorUserId: f.actor.id, branchId: f.branch.id } });
    await tx.walletAccount.update({ where: { id: f.account.id }, data: { paidBalance: 100, bonusBalance: 10, version: 4 } });
  });
  await assert.rejects(db.payment.update({ where: { id: graph.payment.id }, data: { status: "ACTIVE" } }), /WALLET_REVERSAL_REQUIRES_VOID/);
});

test("version conditional updates serialize competing debits with ledger and payment atomically", async () => {
  const f = await postedFixture(90); // Exactly 100 total: two debits of 80 cannot both succeed.
  const attempt = async () => db.$transaction(async (tx) => {
    const result = await tx.walletAccount.updateMany({ where: { id: f.account.id, version: 2, paidBalance: { gte: 70 }, bonusBalance: { gte: 10 } }, data: { paidBalance: { decrement: 70 }, bonusBalance: { decrement: 10 }, version: { increment: 1 } } });
    if (!result.count) return "VERSION_CONFLICT";
    const invoice = await tx.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id, invoiceNumber: randomUUID(), subtotal: 80, total: 80, paidAmount: 80, balance: 0, status: "PAID" } });
    const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, invoiceId: invoice.id, amount: 80, method: "MEMBER_WALLET", purpose: "SALE" } });
    const operation = await tx.financialOperation.create({ data: { businessId: f.business.id, actorUserId: f.actor.id, operationType: "CASHIER_CHECKOUT", operationKey: randomUUID(), requestFingerprint: "b".repeat(64) } });
    await tx.walletTransaction.create({ data: { businessId: f.business.id, walletAccountId: f.account.id, sequence: 3, type: "REDEMPTION", paidDelta: -70, bonusDelta: -10, paidBalanceAfter: 20, bonusBalanceAfter: 0, policyVersion: "BONUS_FIRST_V1", financialOperationId: operation.id, entryKey: "debit", paymentId: payment.id, actorUserId: f.actor.id, branchId: f.branch.id } });
    return "SUCCESS";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10000 });
  assert.deepEqual((await Promise.all([attempt(), attempt()])).sort(), ["SUCCESS", "VERSION_CONFLICT"]);
  const account = await db.walletAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  assert.equal(account.paidBalance.toString(), "20");
  assert.equal(account.bonusBalance.toString(), "0");
  assert.equal(account.version, 3);
  // A fresh-version retry still cannot debit 80 from 20.
  assert.equal((await db.walletAccount.updateMany({ where: { id: account.id, version: 3, paidBalance: { gte: 80 } }, data: { paidBalance: { decrement: 80 }, version: { increment: 1 } } })).count, 0);
});
