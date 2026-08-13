import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { runManualInventoryMovement } from "../../src/lib/inventory/service";
import { approvePurchaseOrder, closePurchaseOrder, createPurchaseOrder, createSupplier, PurchasingConflictError, receivePurchaseOrder, reverseGoodsReceiptLine } from "../../src/lib/inventory/purchasing-service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("Supplier → PO → partial/full receive → reversal is scoped, idempotent and ledger-backed", async () => {
  assertLocalDatabase(); const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `P2 ${token}`, slug: `p2-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `Salon ${token}` } });
  const [creator, approver] = await Promise.all([
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "PO Creator", role: "BUSINESS_OWNER" } }),
    prisma.user.create({ data: { branchId: branch.id, businessId: business.id, name: "PO Approver", role: "BUSINESS_OWNER" } }),
  ]);
  const creatorActor = { userId: creator.id, name: creator.name, email: creator.email };
  const approverActor = { userId: approver.id, name: approver.name, email: approver.email };
  await prisma.businessModuleEntitlement.createMany({ data: [
    { businessId: business.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: creator.id, updatedById: creator.id },
    { businessId: business.id, moduleKey: "INVENTORY", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", createdById: creator.id, updatedById: creator.id },
  ] });
  const product = await prisma.product.create({ data: { businessId: business.id, costPrice: 8, name: `Tracked Shampoo ${token}`, price: 20, sku: `P2-${token}`, trackInventory: true } });
  await runManualInventoryMovement({ actorUserId: creator.id, branchId: branch.id, businessId: business.id, operationKey: `P2:OPENING:${token}:0001`, productId: product.id, quantityDelta: 10, reason: "Phase 2 opening fixture", sourceId: product.id, sourceType: "TEST", type: "OPENING_BALANCE" });
  const supplier = await createSupplier({ actor: creatorActor, businessId: business.id, name: `Salon Supply ${token}`, operationKey: `P2:SUPPLIER:${token}:0001` });
  const order = await createPurchaseOrder({ actor: creatorActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 8, orderedQuantity: 10, productId: product.id }], operationKey: `P2:PO:${token}:00000001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  assert.match(order.poNumber, /^PO-\d{6}$/); assert.equal(await quantity(branch.id, product.id), 10); assert.equal(order.status, "DRAFT");
  await assert.rejects(approvePurchaseOrder({ actor: creatorActor, businessId: business.id, expectedRevision: order.revision, operationKey: `P2:SELF-APPROVE:${token}`, purchaseOrderId: order.id }), /creator cannot approve/i);
  const approved = await approvePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: order.revision, operationKey: `P2:APPROVE:${token}:0001`, purchaseOrderId: order.id });
  assert.equal(approved.status, "APPROVED"); assert.equal(await quantity(branch.id, product.id), 10);
  const first = await receivePurchaseOrder({ actor: creatorActor, businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 6 }], operationKey: `P2:RECEIVE:${token}:0001`, purchaseOrderId: order.id });
  assert.match(first.receiptNumber, /^GRN-\d{6}$/); assert.equal(await quantity(branch.id, product.id), 16);
  assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "PARTIALLY_RECEIVED");
  const replay = await receivePurchaseOrder({ actor: creatorActor, businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 6 }], operationKey: `P2:RECEIVE:${token}:0001`, purchaseOrderId: order.id });
  assert.equal(replay.id, first.id); assert.equal(await quantity(branch.id, product.id), 16);
  await assert.rejects(receivePurchaseOrder({ actor: creatorActor, businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 7 }], operationKey: `P2:OVER:${token}:0000001`, purchaseOrderId: order.id }), /Over-receipt blocked/);
  const second = await receivePurchaseOrder({ actor: creatorActor, businessId: business.id, lines: [{ purchaseOrderLineId: approved.lines[0].id, quantity: 4 }], operationKey: `P2:RECEIVE:${token}:0002`, purchaseOrderId: order.id });
  assert.equal(await quantity(branch.id, product.id), 20); assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "RECEIVED");
  const reversal = await reverseGoodsReceiptLine({ actor: approverActor, businessId: business.id, goodsReceiptLineId: second.lines[0].id, operationKey: `P2:REVERSE:${token}:0001`, quantity: 2, reason: "Two units damaged on inspection" });
  assert.equal(reversal.reversedQuantity, 2); assert.equal(await quantity(branch.id, product.id), 18); assert.equal((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "PARTIALLY_RECEIVED");
  await assert.rejects(reverseGoodsReceiptLine({ actor: approverActor, businessId: business.id, goodsReceiptLineId: second.lines[0].id, operationKey: `P2:REVERSE:${token}:0002`, quantity: 3, reason: "Excess reversal attempt" }), /exceeds the net received/);
  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { businessId: business.id, sourceType: "GOODS_RECEIPT", sourceLineId: first.lines[0].id } }); assert.equal(movement.quantityDelta, 6); assert.equal(movement.branchId, branch.id);
  await assert.rejects(prisma.goodsReceiptLine.update({ where: { id: first.lines[0].id }, data: { receivedQuantity: 5 } }), /immutable/);
  await assert.rejects(createSupplier({ actor: creatorActor, businessId: business.id, name: "Changed replay", operationKey: `P2:SUPPLIER:${token}:0001` }), PurchasingConflictError);
  const closeSnapshot = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } }); await closePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: closeSnapshot.revision, operationKey: `P2:CLOSE:${token}:000001`, purchaseOrderId: order.id, reason: "Supplier cannot replace damaged balance" }); assert.equal(await quantity(branch.id, product.id), 18);
  const raceOrder = await createPurchaseOrder({ actor: creatorActor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 8, orderedQuantity: 3, productId: product.id }], operationKey: `P2:RACE-PO:${token}:0001`, orderDate: new Date("2026-08-11T00:00:00Z"), supplierId: supplier.id });
  const raceApproved = await approvePurchaseOrder({ actor: approverActor, businessId: business.id, expectedRevision: raceOrder.revision, operationKey: `P2:RACE-APPROVE:${token}`, purchaseOrderId: raceOrder.id });
  const race = await Promise.allSettled(["A", "B"].map((suffix) => receivePurchaseOrder({ actor: creatorActor, businessId: business.id, lines: [{ purchaseOrderLineId: raceApproved.lines[0].id, quantity: 2 }], operationKey: `P2:RACE-RECEIVE:${token}:${suffix}`, purchaseOrderId: raceOrder.id })));
  assert.equal(race.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(race.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: raceApproved.lines[0].id } })).receivedQuantity, 2);
  assert.equal(await quantity(branch.id, product.id), 20);
  assert.ok(await prisma.auditLog.count({ where: { businessId: business.id, action: { in: ["SUPPLIER_CREATED", "PURCHASE_ORDER_CREATED", "PURCHASE_ORDER_APPROVED", "GOODS_RECEIPT_CREATED", "GOODS_RECEIPT_REVERSED", "PURCHASE_ORDER_CLOSED"] } } }) >= 10);
});

async function quantity(branchId: string, productId: string) { return (await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId, productId } } })).quantity; }
function assertLocalDatabase() { const url = process.env.DATABASE_URL ?? ""; const host = new URL(url).hostname; assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Inventory Phase 2 integration test requires Local database."); }
