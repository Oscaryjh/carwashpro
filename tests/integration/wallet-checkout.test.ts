import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { walletFixture, walletTestDatabase } from "../helpers/wallet-fixture";
import { postWalletTopUp } from "../../src/lib/wallet/top-up";
import { runFinancialOperation } from "../../src/lib/financial-idempotency";

const db = walletTestDatabase();
after(() => db.$disconnect());
test("redemption posts bonus-first against CASHIER_CHECKOUT with immutable original consumption", async () => {
  const module = await import("../../src/lib/wallet/redemption").catch(() => null);
  assert.ok(module?.postWalletRedemption, "transaction-bound Wallet redemption must exist");
  const f = await walletFixture(db, "50", "30");
  await postWalletTopUp(f.ctx, f.input, db);
  const key = randomUUID();
  const operation = { businessId: f.business.id, branchId: f.branch.id, actorUserId: f.actor.id,
    operationType: "CASHIER_CHECKOUT" as const, operationKey: key, payload: { amount: "40.00" },
    execute: async (tx: Parameters<Parameters<typeof runFinancialOperation>[0]["execute"]>[0]) => {
      const invoice = await tx.invoice.create({ data: { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
        invoiceNumber: randomUUID(), subtotal: 40, total: 40, paidAmount: 40, balance: 0, status: "PAID" } });
      const payment = await tx.payment.create({ data: { businessId: f.business.id, branchId: f.branch.id, cashierId: f.actor.id,
        shiftId: f.shift.id, invoiceId: invoice.id, method: "MEMBER_WALLET", purpose: "SALE", amount: 40 } });
      const op = await tx.financialOperation.findUniqueOrThrow({ where: { businessId_operationType_operationKey: {
        businessId: f.business.id, operationType: "CASHIER_CHECKOUT", operationKey: key } } });
      return module.postWalletRedemption(tx, { businessId: f.business.id, branchId: f.branch.id, customerId: f.customer.id,
        actorUserId: f.actor.id, paymentId: payment.id, financialOperationId: op.id, amountCents: 4000 });
    } };
  const first = await runFinancialOperation(operation, db);
  assert.equal(first.result.paidUsedCents, 1000); assert.equal(first.result.bonusUsedCents, 3000);
  assert.deepEqual((await runFinancialOperation(operation, db)).result, first.result);
  const account = await db.walletAccount.findUniqueOrThrow({ where: { businessId_customerId: { businessId: f.business.id, customerId: f.customer.id } } });
  assert.equal(account.paidBalance.toFixed(2), "40.00"); assert.equal(account.bonusBalance.toFixed(2), "0.00");
  const rows = await db.walletTransaction.findMany({ where: { businessId: f.business.id, type: "REDEMPTION" } });
  assert.equal(rows.length, 1); assert.equal(rows[0].paidDelta.toFixed(2), "-10.00"); assert.equal(rows[0].bonusDelta.toFixed(2), "-30.00");
});
