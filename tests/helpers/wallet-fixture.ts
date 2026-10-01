import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export function walletTestDatabase() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  assert.match(url.pathname, /disposable/);
  return new PrismaClient();
}

export async function walletFixture(db: PrismaClient, paid = "1000", bonus = "100") {
  const business = await db.business.create({ data: { name: "WALLET_P1B_SYNTHETIC", slug: `wallet-p1b-${randomUUID()}`, industryType: "SALON_BEAUTY" } });
  await db.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "POS", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
  await db.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "WALLET", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
  const branch = await db.branch.create({ data: { businessId: business.id, name: "Synthetic branch" } });
  const actor = await db.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Synthetic owner", role: "BUSINESS_OWNER" } });
  const shift = await db.cashierShift.create({ data: { businessId: business.id, branchId: branch.id, cashierId: actor.id } });
  const customer = await db.customer.create({ data: { businessId: business.id, name: "Synthetic customer", phone: randomUUID() } });
  const offer = await db.walletTopUpOffer.create({ data: { businessId: business.id, name: "Synthetic offer", paidAmount: paid, bonusAmount: bonus } });
  return {
    business, branch, actor, shift, customer, offer,
    ctx: { businessId: business.id, user: { userId: actor.id }, branchId: branch.id, shiftId: shift.id },
    input: { customerId: customer.id, offerId: offer.id, expectedOfferVersion: 0, paymentMethodCode: "BUILTIN_CASH", operationKey: randomUUID() },
  };
}

export async function setWalletModule(db: PrismaClient, businessId: string, enabled: boolean) {
  await db.businessModuleEntitlement.updateMany({ where: { businessId, moduleKey: "WALLET" }, data: { status: enabled ? "ENABLED" : "DISABLED", revision: { increment: 1 } } });
}

export async function withWalletModules(db: PrismaClient, ids: string, run: () => Promise<void>) {
  const rows = await db.businessModuleEntitlement.findMany({ where: { moduleKey: "WALLET" } });
  const allowed = new Set(ids.split(",").filter(Boolean));
  try {
    for (const row of rows) await setWalletModule(db, row.businessId, allowed.has(row.businessId));
    await run();
  } finally {
    for (const row of rows) await db.businessModuleEntitlement.update({ where: { id: row.id }, data: { status: row.status, revision: { increment: 1 } } });
  }
}

export async function assertNoWalletMoney(db: PrismaClient, businessId: string) {
  for (const count of await Promise.all([
    db.walletAccount.count({ where: { businessId } }),
    db.walletTopUp.count({ where: { businessId } }),
    db.walletTransaction.count({ where: { businessId } }),
    db.payment.count({ where: { businessId } }),
    db.financialOperation.count({ where: { businessId } }),
    db.auditLog.count({ where: { businessId } }),
  ])) assert.equal(count, 0);
}
