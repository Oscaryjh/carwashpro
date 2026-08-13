import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder } from "../../src/lib/inventory/purchasing-service";
import { reconcileInventory, recordSaleInventory, runManualInventoryMovement } from "../../src/lib/inventory/service";
import { approveStockCount, cancelStockCount, createStockCount, getReorderView, recordStockCountLine, reopenStockCount, setReorderSettings, startStockCount, StockCountConflictError, StockCountStaleError, submitStockCount } from "../../src/lib/inventory/stock-count-service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("physical count snapshot, delta approval, stale protection and reorder are ledger-safe", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { industryType: "SALON_BEAUTY", name: `P3 ${token}`, slug: `p3-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Salon ${token}` } });
  const [counter, approver] = await Promise.all([
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "Counter", role: "BUSINESS_OWNER" } }),
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "Approver", role: "BUSINESS_OWNER" } }),
  ]);
  const counterActor = actor(counter); const approverActor = actor(approver);
  await prisma.businessModuleEntitlement.createMany({ data: [
    { businessId: business.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: counter.id, updatedById: counter.id },
    { businessId: business.id, moduleKey: "INVENTORY", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: counter.id, updatedById: counter.id },
  ] });
  const products = await Promise.all(["Shampoo", "Wax", "Towel", "Cleaner", "Polish", "Filter", "Oil", "Glove"].map((name, index) => prisma.product.create({ data: { businessId: business.id, name: `${name} ${token}`, price: 10, sku: `P3-${token}-${index}`, trackInventory: true } })));
  for (const [index, quantity] of [20, 10, 8, 5, 3, 3, 20, 10].entries()) await opening(business.id, branch.id, products[index].id, counter.id, quantity, `${token}:${index}`);

  const negative = await createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:COUNT:NEG:${token}:0001`, productIds: [products[0].id] });
  assert.match(negative.countNumber, /^SC-\d{6}$/);
  await assert.rejects(createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:COUNT:DUP:${token}:0001`, productIds: [products[0].id] }), (error: unknown) => error instanceof StockCountConflictError && /ACTIVE_STOCK_COUNT/.test(error.message));
  const started = await startStockCount({ actor: counterActor, businessId: business.id, expectedRevision: negative.revision, operationKey: `P3:START:NEG:${token}:0001`, sessionId: negative.id });
  const countedLine = await recordStockCountLine({ actor: counterActor, actualQuantity: 18, businessId: business.id, expectedLineRevision: started.lines[0].revision, lineId: started.lines[0].id, operationKey: `P3:LINE:NEG:${token}:000001`, sessionId: started.id });
  assert.equal(countedLine.expectedQuantityAtCount, 20); assert.equal(countedLine.varianceQuantity, -2); assert.equal(countedLine.revisions.length, 1);
  const countReplay = await recordStockCountLine({ actor: counterActor, actualQuantity: 18, businessId: business.id, expectedLineRevision: started.lines[0].revision, lineId: started.lines[0].id, operationKey: `P3:LINE:NEG:${token}:000001`, sessionId: started.id }); assert.equal(countReplay.revisions.length, 1);
  const submitted = await submitStockCount({ actor: counterActor, businessId: business.id, expectedRevision: started.revision, operationKey: `P3:SUBMIT:NEG:${token}:0001`, sessionId: started.id });
  const saleInvoice = await prisma.invoice.create({ data: { balance: 0, branchId: branch.id, businessId: business.id, invoiceNumber: `P3-SALE-${token}`, paidAmount: 10, status: "PAID", subtotal: 10, total: 10, items: { create: { businessId: business.id, lineTotal: 10, name: products[0].name, productId: products[0].id, quantity: 1, unitPrice: 10 } } }, include: { items: true } });
  await prisma.$transaction((tx) => recordSaleInventory(tx, { actorUserId: counter.id, branchId: branch.id, businessId: business.id, invoiceId: saleInvoice.id, lines: [{ invoiceItemId: saleInvoice.items[0].id, productId: products[0].id, quantity: 1 }] }), { isolationLevel: "Serializable" });
  assert.equal(await quantity(branch.id, products[0].id), 19);
  const approvalRace = await Promise.allSettled(["A", "B"].map((suffix) => approveStockCount({ actor: approverActor, businessId: business.id, expectedRevision: submitted.revision, operationKey: `P3:APPROVE:NEG:${token}:${suffix}`, reason: "Physical variance independently reviewed", sessionId: submitted.id })));
  assert.equal(approvalRace.filter((result) => result.status === "fulfilled").length, 1); assert.equal(await quantity(branch.id, products[0].id), 17);
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId: business.id, sourceType: "STOCK_COUNT", sourceLineId: countedLine.id } }), 1);

  const positive = await completeCount({ actual: 12, approverActor, businessId: business.id, branchId: branch.id, counterActor, productId: products[1].id, token: `${token}:POS` });
  assert.equal(positive.status, "APPROVED"); assert.equal(await quantity(branch.id, products[1].id), 12);
  const zero = await completeCount({ actual: 8, approverActor, businessId: business.id, branchId: branch.id, counterActor, productId: products[2].id, token: `${token}:ZERO` });
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId: business.id, sourceType: "STOCK_COUNT", sourceId: zero.id } }), 0);

  const stale = await createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:STALE:CREATE:${token}`, productIds: [products[3].id] });
  const staleStarted = await startStockCount({ actor: counterActor, businessId: business.id, expectedRevision: stale.revision, operationKey: `P3:STALE:START:${token}`, sessionId: stale.id });
  await recordStockCountLine({ actor: counterActor, actualQuantity: 4, businessId: business.id, expectedLineRevision: staleStarted.lines[0].revision, lineId: staleStarted.lines[0].id, operationKey: `P3:STALE:LINE:${token}:1`, sessionId: stale.id });
  const staleSubmitted = await submitStockCount({ actor: counterActor, businessId: business.id, expectedRevision: staleStarted.revision, operationKey: `P3:STALE:SUBMIT:${token}`, sessionId: stale.id });
  await runManualInventoryMovement({ actorUserId: approver.id, branchId: branch.id, businessId: business.id, operationKey: `P3:CORRECTION:${token}:01`, productId: products[3].id, quantityDelta: 1, reason: "Manual correction after physical count", sourceId: randomUUID(), sourceType: "MANUAL", type: "ADJUSTMENT_IN" });
  await assert.rejects(approveStockCount({ actor: approverActor, businessId: business.id, expectedRevision: staleSubmitted.revision, operationKey: `P3:STALE:APPROVE:${token}`, reason: "Attempt old evidence", sessionId: stale.id }), StockCountStaleError);
  const reopened = await reopenStockCount({ actor: approverActor, businessId: business.id, expectedRevision: staleSubmitted.revision, operationKey: `P3:STALE:REOPEN:${token}`, reason: "Correction requires a fresh physical count", sessionId: stale.id });
  const recounted = await recordStockCountLine({ actor: counterActor, actualQuantity: 5, businessId: business.id, expectedLineRevision: reopened.lines[0].revision, lineId: reopened.lines[0].id, operationKey: `P3:STALE:LINE:${token}:2`, sessionId: stale.id });
  assert.equal(recounted.revisions.length, 2); assert.equal(recounted.expectedQuantityAtCount, 6);
  const resubmitted = await submitStockCount({ actor: counterActor, businessId: business.id, expectedRevision: reopened.revision, operationKey: `P3:STALE:RESUBMIT:${token}`, sessionId: stale.id });
  await approveStockCount({ actor: approverActor, businessId: business.id, expectedRevision: resubmitted.revision, operationKey: `P3:STALE:APPROVE2:${token}`, reason: "Fresh count reviewed", sessionId: stale.id }); assert.equal(await quantity(branch.id, products[3].id), 5);

  const cancelled = await createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:CANCEL:CREATE:${token}`, productIds: [products[4].id] });
  const cancelledResult = await cancelStockCount({ actor: approverActor, businessId: business.id, expectedRevision: cancelled.revision, operationKey: `P3:CANCEL:${token}:0001`, reason: "Count no longer required", sessionId: cancelled.id }); assert.equal(cancelledResult.status, "CANCELLED");

  await setReorderSettings({ actor: approverActor, branchId: branch.id, businessId: business.id, expectedRevision: 1, operationKey: `P3:REORDER:${token}:0001`, productId: products[4].id, reorderLevel: 5, targetStockLevel: 20 });
  const supplier = await createSupplier({ actor: counterActor, businessId: business.id, name: `Supplier ${token}`, operationKey: `P3:SUPPLIER:${token}:0001` });
  const order = await createPurchaseOrder({ actor: counterActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 2, orderedQuantity: 4, productId: products[4].id }], operationKey: `P3:PO:${token}:000000001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  await approvePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: order.revision, operationKey: `P3:PO:APPROVE:${token}`, purchaseOrderId: order.id });
  const reorder = await getReorderView({ branchIds: [branch.id], businessId: business.id, pageSize: 100 }); const row = reorder.rows.find((item) => item.productId === products[4].id)!;
  assert.equal(row.onHand, 3); assert.equal(row.onOrderQuantity, 4); assert.equal(row.projectedStock, 7); assert.equal(row.suggestedQuantity, 13);
  const partialOrder = await createPurchaseOrder({ actor: counterActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 2, orderedQuantity: 10, productId: products[5].id }], operationKey: `P3:PO:PARTIAL:${token}`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const partialApproved = await approvePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: partialOrder.revision, operationKey: `P3:PO:PARTAPP:${token}`, purchaseOrderId: partialOrder.id });
  await receivePurchaseOrder({ actor: counterActor, businessId: business.id, lines: [{ purchaseOrderLineId: partialApproved.lines[0].id, quantity: 6 }], operationKey: `P3:PO:RECEIVE:${token}`, purchaseOrderId: partialOrder.id });
  const partialRow = (await getReorderView({ branchIds: [branch.id], businessId: business.id, pageSize: 100 })).rows.find((item) => item.productId === products[5].id)!; assert.equal(partialRow.onOrderQuantity, 4);

  const receiveDuringCount = await createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:RECEIVECOUNT:CREATE:${token}`, productIds: [products[6].id] });
  const receiveCountStarted = await startStockCount({ actor: counterActor, businessId: business.id, expectedRevision: receiveDuringCount.revision, operationKey: `P3:RECEIVECOUNT:START:${token}`, sessionId: receiveDuringCount.id });
  await recordStockCountLine({ actor: counterActor, actualQuantity: 18, businessId: business.id, expectedLineRevision: receiveCountStarted.lines[0].revision, lineId: receiveCountStarted.lines[0].id, operationKey: `P3:RECEIVECOUNT:LINE:${token}`, sessionId: receiveDuringCount.id });
  const receiveCountSubmitted = await submitStockCount({ actor: counterActor, businessId: business.id, expectedRevision: receiveCountStarted.revision, operationKey: `P3:RECEIVECOUNT:SUBMIT:${token}`, sessionId: receiveDuringCount.id });
  const receiveOrder = await createPurchaseOrder({ actor: counterActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 2, orderedQuantity: 5, productId: products[6].id }], operationKey: `P3:RECEIVECOUNT:PO:${token}`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const receiveOrderApproved = await approvePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: receiveOrder.revision, operationKey: `P3:RECEIVECOUNT:POAPP:${token}`, purchaseOrderId: receiveOrder.id });
  await receivePurchaseOrder({ actor: counterActor, businessId: business.id, lines: [{ purchaseOrderLineId: receiveOrderApproved.lines[0].id, quantity: 5 }], operationKey: `P3:RECEIVECOUNT:GR:${token}`, purchaseOrderId: receiveOrder.id }); assert.equal(await quantity(branch.id, products[6].id), 25);
  await approveStockCount({ actor: approverActor, businessId: business.id, expectedRevision: receiveCountSubmitted.revision, operationKey: `P3:RECEIVECOUNT:APP:${token}`, reason: "Variance remains valid after receipt", sessionId: receiveDuringCount.id }); assert.equal(await quantity(branch.id, products[6].id), 23);

  const negativeGuard = await createStockCount({ actor: counterActor, branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:NEGATIVE:CREATE:${token}`, productIds: [products[7].id] });
  const negativeGuardStarted = await startStockCount({ actor: counterActor, businessId: business.id, expectedRevision: negativeGuard.revision, operationKey: `P3:NEGATIVE:START:${token}`, sessionId: negativeGuard.id });
  await recordStockCountLine({ actor: counterActor, actualQuantity: 0, businessId: business.id, expectedLineRevision: negativeGuardStarted.lines[0].revision, lineId: negativeGuardStarted.lines[0].id, operationKey: `P3:NEGATIVE:LINE:${token}`, sessionId: negativeGuard.id });
  const negativeGuardSubmitted = await submitStockCount({ actor: counterActor, businessId: business.id, expectedRevision: negativeGuardStarted.revision, operationKey: `P3:NEGATIVE:SUBMIT:${token}`, sessionId: negativeGuard.id });
  await runManualInventoryMovement({ actorUserId: counter.id, branchId: branch.id, businessId: business.id, operationKey: `P3:NEGATIVE:OUT:${token}`, productId: products[7].id, quantityDelta: -10, reason: "Legitimate stock out before approval", sourceId: randomUUID(), sourceType: "MANUAL_STOCK_OUT", type: "STOCK_OUT" });
  await assert.rejects(approveStockCount({ actor: approverActor, businessId: business.id, expectedRevision: negativeGuardSubmitted.revision, operationKey: `P3:NEGATIVE:APPROVE:${token}`, reason: "Would violate negative stock guard", sessionId: negativeGuard.id }), /does not have enough stock/);
  const reconciliation = await reconcileInventory(business.id, branch.id); assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
  await assert.rejects(prisma.stockCountLineRevision.update({ where: { id: recounted.revisions[0].id }, data: { actualQuantity: 99 } }), /immutable/);
});

test("module-disabled and cross-tenant stock-count writes fail closed", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8); const business = await prisma.business.create({ data: { name: `P3 Denied ${token}`, slug: `p3-denied-${token}` } }); const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Denied branch" } }); const user = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Denied", role: "BUSINESS_OWNER" } }); const product = await prisma.product.create({ data: { businessId: business.id, name: `Denied product ${token}`, price: 1, trackInventory: true } });
  await assert.rejects(createStockCount({ actor: actor(user), branchId: branch.id, businessId: business.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:DENIED:${token}:000001`, productIds: [product.id] }), /not enabled/);
  const enabled = await prisma.business.create({ data: { name: `P3 Enabled ${token}`, slug: `p3-enabled-${token}` } }); const enabledBranch = await prisma.branch.create({ data: { businessId: enabled.id, name: "Enabled branch" } }); const enabledUser = await prisma.user.create({ data: { businessId: enabled.id, branchId: enabledBranch.id, name: "Enabled", role: "BUSINESS_OWNER" } }); const enabledProduct = await prisma.product.create({ data: { businessId: enabled.id, name: `Enabled product ${token}`, price: 1, trackInventory: true } }); await prisma.businessModuleEntitlement.createMany({ data: [{ businessId: enabled.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: enabledUser.id, updatedById: enabledUser.id }, { businessId: enabled.id, moduleKey: "INVENTORY", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: enabledUser.id, updatedById: enabledUser.id }] });
  await assert.rejects(createStockCount({ actor: actor(user), branchId: enabledBranch.id, businessId: enabled.id, countType: "SELECTED_PRODUCTS", operationKey: `P3:CROSS:${token}:0000001`, productIds: [enabledProduct.id] }), /outside business scope/);
});

async function completeCount(input: { actual: number; approverActor: ReturnType<typeof actor>; branchId: string; businessId: string; counterActor: ReturnType<typeof actor>; productId: string; token: string }) {
  const created = await createStockCount({ actor: input.counterActor, branchId: input.branchId, businessId: input.businessId, countType: "SELECTED_PRODUCTS", operationKey: `P3:CREATE:${input.token}:0001`, productIds: [input.productId] });
  const started = await startStockCount({ actor: input.counterActor, businessId: input.businessId, expectedRevision: created.revision, operationKey: `P3:START:${input.token}:00001`, sessionId: created.id });
  await recordStockCountLine({ actor: input.counterActor, actualQuantity: input.actual, businessId: input.businessId, expectedLineRevision: started.lines[0].revision, lineId: started.lines[0].id, operationKey: `P3:LINE:${input.token}:000001`, sessionId: created.id });
  const submitted = await submitStockCount({ actor: input.counterActor, businessId: input.businessId, expectedRevision: started.revision, operationKey: `P3:SUBMIT:${input.token}:001`, sessionId: created.id });
  return approveStockCount({ actor: input.approverActor, businessId: input.businessId, expectedRevision: submitted.revision, operationKey: `P3:APPROVE:${input.token}:01`, reason: "Independent variance review complete", sessionId: created.id });
}
async function opening(businessId: string, branchId: string, productId: string, actorUserId: string, value: number, token: string) { return runManualInventoryMovement({ actorUserId, branchId, businessId, operationKey: `P3:OPENING:${token}:0001`, productId, quantityDelta: value, reason: "Phase 3 opening fixture", sourceId: productId, sourceType: "TEST", type: "OPENING_BALANCE" }); }
async function quantity(branchId: string, productId: string) { return (await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId, productId } } })).quantity; }
function actor(user: { email: string | null; id: string; name: string }) { return { email: user.email, name: user.name, userId: user.id }; }
function assertLocalDatabase() { const host = new URL(process.env.DATABASE_URL ?? "").hostname; assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Inventory Phase 3 integration test requires Local database."); }
