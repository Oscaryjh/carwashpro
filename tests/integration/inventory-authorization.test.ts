import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createSupplier, createPurchaseOrder, updatePurchaseOrder, approvePurchaseOrder, cancelPurchaseOrder, closePurchaseOrder, receivePurchaseOrder, reverseGoodsReceiptLine } from '../../src/lib/inventory/purchasing-service';
import { createStockCount, startStockCount, recordStockCountLine, submitStockCount, approveStockCount, reopenStockCount, cancelStockCount } from '../../src/lib/inventory/stock-count-service';
import { reconcileInventory } from '../../src/lib/inventory/service';

const db = new PrismaClient();
after(() => db.$disconnect());

test('service authorization rejects cross-branch/tenant documents and replay, without any mutation', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && /disposable/.test(url.pathname), 'disposable DB only');
  const token = randomUUID();
  const business = await db.business.create({ data: { name: 'Inventory authorization fixture', slug: `inv-auth-${token}` } });
  const foreign = await db.business.create({ data: { name: 'Other tenant fixture', slug: `inv-auth-other-${token}` } });
  const a = await db.branch.create({ data: { businessId: business.id, name: 'A' } });
  const b = await db.branch.create({ data: { businessId: business.id, name: 'B' } });
  const owner = await db.user.create({ data: { businessId: business.id, role: 'BUSINESS_OWNER', name: 'Owner' } });
  const reviewer = await db.user.create({ data: { businessId: business.id, role: 'BUSINESS_OWNER', name: 'Reviewer' } });
  const staff = await db.user.create({ data: { businessId: business.id, branchId: a.id, role: 'STAFF', name: 'Staff A', permissions: ['INVENTORY_VIEW','PURCHASE_ORDERS_CREATE','PURCHASE_ORDERS_APPROVE','PURCHASE_ORDERS_CANCEL','PURCHASE_ORDERS_RECEIVE','GOODS_RECEIPTS_REVERSE','STOCK_COUNTS_CREATE','STOCK_COUNTS_COUNT','STOCK_COUNTS_APPROVE','STOCK_COUNTS_CANCEL'] } });
  await db.businessModuleEntitlement.createMany({ data: ['POS','INVENTORY'].map(moduleKey => ({ businessId: business.id, moduleKey: moduleKey as 'INVENTORY', status: 'ENABLED' as const, enabledFrom: new Date(), source: 'MANUAL' as const })) });
  const product = await db.product.create({ data: { businessId: business.id, name: 'Tracked fixture', price: 10, trackInventory: true } });
  const op = () => `AUTH:${randomUUID()}`;
  const own = { businessId: business.id, actor: { userId: owner.id } };
  const actor = { businessId: business.id, actor: { userId: staff.id } };
  const supplier = await createSupplier({ ...own, operationKey: op(), name: 'Supplier fixture' });
  const lines = [{ productId: product.id, orderedQuantity: 10, expectedUnitCost: 2 }];
  const po = await createPurchaseOrder({ ...own, operationKey: op(), branchId: b.id, supplierId: supplier.id, orderDate: new Date(), lines });
  const approved = await approvePurchaseOrder({ ...own, actor: { userId: reviewer.id }, operationKey: op(), purchaseOrderId: po.id, expectedRevision: po.revision });
  const receipt = await receivePurchaseOrder({ ...own, operationKey: op(), purchaseOrderId: po.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 5 }] });
  const count = await createStockCount({ ...own, operationKey: op(), branchId: b.id, countType: 'SELECTED_PRODUCTS', productIds: [product.id] });
  const snapshot = async () => JSON.stringify(await Promise.all([
    db.purchaseOrder.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }),
    db.stockCountSession.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }),
    db.productStock.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }),
    db.inventoryMovement.count({ where: { businessId: business.id } }),
    db.inventoryPurchasingCommand.count({ where: { businessId: business.id } }),
    db.stockCountCommand.count({ where: { businessId: business.id } }),
  ]));
  const before = await snapshot();
  const poInput = { ...actor, purchaseOrderId: po.id, expectedRevision: approved.revision, reason: 'Controlled denial', operationKey: op() };
  const countInput = { ...actor, sessionId: count.id, expectedRevision: count.revision, reason: 'Controlled denial', operationKey: op() };
  const attempts = [
    () => updatePurchaseOrder({ ...poInput, supplierId: supplier.id, orderDate: new Date(), lines }),
    () => approvePurchaseOrder(poInput), () => cancelPurchaseOrder(poInput), () => closePurchaseOrder(poInput),
    () => receivePurchaseOrder({ ...poInput, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 1 }] }),
    () => reverseGoodsReceiptLine({ ...actor, operationKey: op(), goodsReceiptLineId: receipt.lines[0].id, quantity: 1, reason: 'Controlled denial' }),
    () => startStockCount(countInput), () => submitStockCount(countInput), () => approveStockCount(countInput), () => reopenStockCount(countInput), () => cancelStockCount(countInput),
    () => recordStockCountLine({ ...countInput, lineId: count.lines[0].id, expectedLineRevision: 0, actualQuantity: 4 }),
    () => approvePurchaseOrder({ ...poInput, businessId: foreign.id }),
  ];
  for (const attempt of attempts) await assert.rejects(attempt(), /outside your authorised/);
  assert.equal(await snapshot(), before, 'denied operations must have zero mutation');

  // Positive path and replay: staff creates/starts A count, then loses A scope.
  const ownCount = await createStockCount({ ...actor, operationKey: op(), branchId: a.id, countType: 'SELECTED_PRODUCTS', productIds: [product.id] });
  const start = { ...actor, sessionId: ownCount.id, expectedRevision: ownCount.revision, operationKey: op() };
  const started = await startStockCount(start);
  assert.equal(started.status, 'IN_PROGRESS');
  assert.equal((await startStockCount(start)).id, started.id);
  await db.user.update({ where: { id: staff.id }, data: { branchId: b.id } });
  await assert.rejects(startStockCount(start), /outside your authorised/);
  await db.user.update({ where: { id: staff.id }, data: { branchId: a.id } });
  const draftInput = { ...actor, operationKey: op(), branchId: a.id, supplierId: supplier.id, orderDate: new Date(), lines };
  const ownPo = await createPurchaseOrder(draftInput);
  assert.equal((await createPurchaseOrder(draftInput)).id, ownPo.id);
  await db.user.update({ where: { id: staff.id }, data: { branchId: b.id } });
  await assert.rejects(createPurchaseOrder(draftInput), /outside your authorised/);
  // Authorization must preserve Owner's existing ability to close old work.
  await db.branch.update({ where: { id: a.id }, data: { status: 'INACTIVE' } });
  const cancelled = await cancelPurchaseOrder({ ...own, operationKey: op(), purchaseOrderId: ownPo.id, expectedRevision: ownPo.revision, reason: 'Close old branch draft' });
  assert.equal(cancelled.status, 'CANCELLED');
  const empty = await reconcileInventory(business.id, { kind: 'none' });
  assert.equal(empty.ok, true);
  assert.equal(empty.balanceMismatches.length, 0);
});
