import assert from "node:assert/strict";
import test, { after } from "node:test";
import { walletTestDatabase } from "../helpers/wallet-fixture";
import { checkoutFixture, checkoutHarness } from "../helpers/wallet-checkout-fixture";
const db = walletTestDatabase(); after(() => db.$disconnect());
for (const [model, method] of [["invoice", "create"], ["payment", "create"], ["walletAccount", "updateMany"], ["walletTransaction", "create"],
  ["inventoryMovement", "create"], ["auditLog", "create"], ["loyaltyTransaction", "create"], ["performanceReceipt", "create"]]) {
  test(`failure after ${model}.${method} rolls back the entire checkout graph`, async () => {
    const old = process.env.TETAMU_PERFORMANCE_PHASE1; process.env.TETAMU_PERFORMANCE_PHASE1 = "true";
    const h = await checkoutHarness(db);
    try {
      const f = await checkoutFixture(db, "CASH"); await h.login(db, f);
      await db.businessModuleEntitlement.create({ data: { businessId: f.business.id, moduleKey: "INVENTORY", status: "ENABLED", source: "MANUAL", enabledFrom: new Date(0) } });
      await db.product.update({ where: { id: f.product.id }, data: { trackInventory: true } });
      await db.productStock.create({ data: { businessId: f.business.id, branchId: f.branch.id, productId: f.product.id, quantity: 10 } });
      await db.loyaltyProgram.upsert({ where: { businessId: f.business.id }, create: { businessId: f.business.id, enabled: true, pointsPerRinggit: 1 }, update: { enabled: true } });
      const snapshot = async () => JSON.stringify(await Promise.all([
        db.walletAccount.findMany({ where: { businessId: f.business.id } }), db.walletTransaction.findMany({ where: { businessId: f.business.id } }),
        db.invoice.count({ where: { businessId: f.business.id } }), db.invoiceItem.count({ where: { businessId: f.business.id } }),
        db.payment.count({ where: { businessId: f.business.id } }), db.inventoryMovement.count({ where: { businessId: f.business.id } }),
        db.productStock.findMany({ where: { businessId: f.business.id } }), db.auditLog.count({ where: { businessId: f.business.id } }),
        db.financialOperation.count({ where: { businessId: f.business.id } }), db.loyaltyTransaction.count({ where: { businessId: f.business.id } }),
        db.performanceReceipt.count({ where: { businessId: f.business.id } }),
      ]));
      const before = await snapshot(); h.failAfter(model, method);
      const result = await h.action.completeCashierSaleAction(f.form);
      assert.equal(result.status, "error"); assert.match(result.message, /P1C_INJECTED/);
      assert.equal(h.injections(), 1); assert.equal(await snapshot(), before);
    } finally { await h.close(); if (old === undefined) delete process.env.TETAMU_PERFORMANCE_PHASE1; else process.env.TETAMU_PERFORMANCE_PHASE1 = old; }
  });
}
