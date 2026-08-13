import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  InventoryConflictError,
  applyInventoryMovement,
  reconcileInventory,
  recordRefundInventory,
  recordSaleInventory,
  runManualInventoryMovement,
  transferInventory,
} from "../../src/lib/inventory/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("Inventory Phase 1 preserves ledger, idempotency, concurrency, refund choice, transfer and isolation", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `Inventory ${token}`, slug: `inventory-${token}` } });
  const [sourceBranch, destinationBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: `Main ${token}` } }),
    prisma.branch.create({ data: { businessId: business.id, name: `Second ${token}` } }),
  ]);
  const actor = await prisma.user.create({ data: { businessId: business.id, branchId: sourceBranch.id, name: "Inventory Owner", role: "BUSINESS_OWNER" } });
  await enableInventory(business.id, actor.id);
  const product = await prisma.product.create({
    data: {
      businessId: business.id,
      name: `Tracked Shampoo ${token}`,
      price: 20,
      sku: `INV-${token}`,
      trackInventory: true,
    },
  });
  await prisma.productStock.createMany({ data: [
    { businessId: business.id, branchId: sourceBranch.id, productId: product.id, quantity: 0, reorderLevel: 3 },
    { businessId: business.id, branchId: destinationBranch.id, productId: product.id, quantity: 0, reorderLevel: 1 },
  ] });

  await runManualInventoryMovement({
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    operationKey: `test:opening:${token}`,
    productId: product.id,
    quantityDelta: 10,
    reason: "Explicit test opening balance",
    sourceId: product.id,
    sourceType: "TEST",
    type: "OPENING_BALANCE",
  });
  assert.equal(await quantity(sourceBranch.id, product.id), 10);

  const invoice = await prisma.invoice.create({
    data: {
      businessId: business.id,
      branchId: sourceBranch.id,
      invoiceNumber: `INV-${token}`,
      subtotal: 40,
      total: 40,
      paidAmount: 40,
      balance: 0,
      status: "PAID",
      items: { create: { businessId: business.id, productId: product.id, name: product.name, quantity: 2, unitPrice: 20, lineTotal: 40 } },
    },
    include: { items: true },
  });
  await prisma.$transaction((tx) => recordSaleInventory(tx, {
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    invoiceId: invoice.id,
    lines: [{ invoiceItemId: invoice.items[0].id, productId: product.id, quantity: 2 }],
  }), { isolationLevel: "Serializable" });
  await prisma.$transaction((tx) => recordSaleInventory(tx, {
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    invoiceId: invoice.id,
    lines: [{ invoiceItemId: invoice.items[0].id, productId: product.id, quantity: 2 }],
  }), { isolationLevel: "Serializable" });
  assert.equal(await quantity(sourceBranch.id, product.id), 8);
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId: business.id, type: "SALE" } }), 1);

  const payment = await prisma.payment.create({ data: { businessId: business.id, branchId: sourceBranch.id, invoiceId: invoice.id, cashierId: actor.id, amount: 40, method: "CASH" } });
  const restockRefund = await prisma.paymentRefund.create({ data: { businessId: business.id, branchId: sourceBranch.id, paymentId: payment.id, invoiceId: invoice.id, processedById: actor.id, amount: 20, method: "CASH", reason: "Returned sealed product" } });
  await prisma.$transaction((tx) => recordRefundInventory(tx, {
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    paymentRefundId: restockRefund.id,
    lines: [{ disposition: "RESTOCK", invoiceItemId: invoice.items[0].id, quantity: 1 }],
  }), { isolationLevel: "Serializable" });
  assert.equal(await quantity(sourceBranch.id, product.id), 9);

  const noRestockRefund = await prisma.paymentRefund.create({ data: { businessId: business.id, branchId: sourceBranch.id, paymentId: payment.id, invoiceId: invoice.id, processedById: actor.id, amount: 20, method: "CASH", reason: "Damaged returned product" } });
  await prisma.$transaction((tx) => recordRefundInventory(tx, {
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    paymentRefundId: noRestockRefund.id,
    lines: [{ disposition: "NO_RESTOCK", invoiceItemId: invoice.items[0].id, noRestockReason: "Packaging opened and damaged", quantity: 1 }],
  }), { isolationLevel: "Serializable" });
  assert.equal(await quantity(sourceBranch.id, product.id), 9);
  assert.equal(await prisma.inventoryRefundLine.count({ where: { businessId: business.id } }), 2);

  const transfer = await transferInventory({
    actorUserId: actor.id,
    businessId: business.id,
    destinationBranchId: destinationBranch.id,
    operationKey: `test:transfer:${token}`,
    productId: product.id,
    quantity: 2,
    reason: "Replenish second branch",
    sourceBranchId: sourceBranch.id,
  });
  const transferReplay = await transferInventory({
    actorUserId: actor.id,
    businessId: business.id,
    destinationBranchId: destinationBranch.id,
    operationKey: `test:transfer:${token}`,
    productId: product.id,
    quantity: 2,
    reason: "Replenish second branch",
    sourceBranchId: sourceBranch.id,
  });
  assert.equal(transferReplay.id, transfer.id);
  assert.equal(transfer.movements.length, 2);
  assert.equal(await quantity(sourceBranch.id, product.id), 7);
  assert.equal(await quantity(destinationBranch.id, product.id), 2);

  const beforeAdjustment = await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId: sourceBranch.id, productId: product.id } } });
  await runManualInventoryMovement({
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    expectedRevision: beforeAdjustment.revision,
    operationKey: `test:adjust:${token}`,
    productId: product.id,
    quantityDelta: 3,
    reason: "Verified shelf count correction",
    sourceId: `adjust-${token}`,
    sourceType: "TEST",
    type: "ADJUSTMENT_IN",
  });
  await assert.rejects(runManualInventoryMovement({
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    expectedRevision: beforeAdjustment.revision,
    operationKey: `test:stale-adjust:${token}`,
    productId: product.id,
    quantityDelta: 1,
    reason: "Stale count must fail",
    sourceId: `stale-${token}`,
    sourceType: "TEST",
    type: "ADJUSTMENT_IN",
  }), InventoryConflictError);
  assert.equal(await quantity(sourceBranch.id, product.id), 10);

  const concurrencyResults = await Promise.allSettled(Array.from({ length: 4 }, () => runManualInventoryMovement({
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    operationKey: `test:concurrent:${token}`,
    productId: product.id,
    quantityDelta: 1,
    reason: "Concurrent idempotency command",
    sourceId: `concurrent-${token}`,
    sourceType: "TEST",
    type: "STOCK_IN",
  })));
  assert.ok(concurrencyResults.every((result) => result.status === "fulfilled"));
  assert.equal(await quantity(sourceBranch.id, product.id), 11);
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId: business.id, operationKey: `test:concurrent:${token}` } }), 1);

  const transferRace = await Promise.allSettled([
    transferInventory({ actorUserId: actor.id, businessId: business.id, destinationBranchId: destinationBranch.id, operationKey: `test:transfer-race-a:${token}`, productId: product.id, quantity: 8, reason: "Concurrent transfer A", sourceBranchId: sourceBranch.id }),
    transferInventory({ actorUserId: actor.id, businessId: business.id, destinationBranchId: destinationBranch.id, operationKey: `test:transfer-race-b:${token}`, productId: product.id, quantity: 8, reason: "Concurrent transfer B", sourceBranchId: sourceBranch.id }),
  ]);
  assert.equal(transferRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(transferRace.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await quantity(sourceBranch.id, product.id), 3);

  const lastUnitProduct = await prisma.product.create({ data: { businessId: business.id, name: `Last Unit ${token}`, price: 5, trackInventory: true } });
  await runManualInventoryMovement({ actorUserId: actor.id, branchId: sourceBranch.id, businessId: business.id, operationKey: `test:last-unit-opening:${token}`, productId: lastUnitProduct.id, quantityDelta: 1, reason: "One unit concurrency fixture", sourceId: lastUnitProduct.id, sourceType: "TEST", type: "OPENING_BALANCE" });
  const competingInvoices = await Promise.all(["A", "B"].map((suffix) => prisma.invoice.create({ data: { businessId: business.id, branchId: sourceBranch.id, invoiceNumber: `RACE-${suffix}-${token}`, subtotal: 5, total: 5, paidAmount: 5, balance: 0, status: "PAID", items: { create: { businessId: business.id, productId: lastUnitProduct.id, name: lastUnitProduct.name, quantity: 1, unitPrice: 5, lineTotal: 5 } } }, include: { items: true } })));
  const saleRace = await Promise.allSettled(competingInvoices.map((raceInvoice) => prisma.$transaction((tx) => recordSaleInventory(tx, { actorUserId: actor.id, branchId: sourceBranch.id, businessId: business.id, invoiceId: raceInvoice.id, lines: [{ invoiceItemId: raceInvoice.items[0].id, productId: lastUnitProduct.id, quantity: 1 }] }), { isolationLevel: "Serializable" })));
  assert.equal(saleRace.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(saleRace.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await quantity(sourceBranch.id, lastUnitProduct.id), 0);

  await assert.rejects(runManualInventoryMovement({
    actorUserId: actor.id,
    branchId: sourceBranch.id,
    businessId: business.id,
    operationKey: `test:negative:${token}`,
    productId: product.id,
    quantityDelta: -999,
    reason: "Negative stock rejection test",
    sourceId: `negative-${token}`,
    sourceType: "TEST",
    type: "STOCK_OUT",
  }), /does not have enough stock/);

  const movement = await prisma.inventoryMovement.findFirstOrThrow({ where: { businessId: business.id } });
  await assert.rejects(prisma.inventoryMovement.update({ where: { id: movement.id }, data: { reason: "Illegal edit" } }), /immutable/);

  const otherBusiness = await prisma.business.create({ data: { name: `Other ${token}`, slug: `other-${token}` } });
  const otherBranch = await prisma.branch.create({ data: { businessId: otherBusiness.id, name: `Other Branch ${token}` } });
  await assert.rejects(prisma.$transaction((tx) => applyInventoryMovement(tx, {
    actorUserId: actor.id,
    branchId: otherBranch.id,
    businessId: business.id,
    operationKey: `test:cross-tenant:${token}`,
    productId: product.id,
    quantityDelta: 1,
    reason: "Cross tenant must fail",
    sourceId: `cross-${token}`,
    sourceType: "TEST",
    type: "STOCK_IN",
  })), /branch not found/);

  const reconciliation = await reconcileInventory(business.id);
  assert.equal(reconciliation.ok, true);
  assert.deepEqual(reconciliation.balanceMismatches, []);
  assert.deepEqual(reconciliation.saleMismatches, []);

  const missingMovementItem = await prisma.invoiceItem.create({ data: { businessId: business.id, invoiceId: invoice.id, productId: product.id, inventoryTracked: true, name: "Corrupted QA sale line", quantity: 1, unitPrice: 1, lineTotal: 1 } });
  const failedReconciliation = await reconcileInventory(business.id);
  assert.equal(failedReconciliation.ok, false);
  assert.ok(failedReconciliation.saleMismatches.some((item) => item.id === missingMovementItem.id && item.movementCount === 0));
  await prisma.invoiceItem.update({ where: { id: missingMovementItem.id }, data: { inventoryTracked: false } });

  const disabledBusiness = await prisma.business.create({ data: { name: `No Inventory ${token}`, slug: `no-inventory-${token}` } });
  const disabledBranch = await prisma.branch.create({ data: { businessId: disabledBusiness.id, name: `No Inventory Branch ${token}` } });
  const disabledActor = await prisma.user.create({ data: { businessId: disabledBusiness.id, branchId: disabledBranch.id, name: "Disabled Inventory Owner", role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: disabledBusiness.id, moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(), source: "MANUAL", reason: undefined } as never });
  const disabledProduct = await prisma.product.create({ data: { businessId: disabledBusiness.id, name: `Disabled Tracked ${token}`, price: 10, trackInventory: true } });
  const disabledInvoice = await prisma.invoice.create({ data: { businessId: disabledBusiness.id, branchId: disabledBranch.id, invoiceNumber: `DIS-${token}`, subtotal: 10, total: 10, paidAmount: 10, balance: 0, status: "PAID", items: { create: { businessId: disabledBusiness.id, productId: disabledProduct.id, name: disabledProduct.name, quantity: 1, unitPrice: 10, lineTotal: 10 } } }, include: { items: true } });
  const skipped = await prisma.$transaction((tx) => recordSaleInventory(tx, { actorUserId: disabledActor.id, branchId: disabledBranch.id, businessId: disabledBusiness.id, invoiceId: disabledInvoice.id, lines: [{ invoiceItemId: disabledInvoice.items[0].id, productId: disabledProduct.id, quantity: 1 }] }));
  assert.deepEqual(skipped, []);
  assert.equal(await prisma.inventoryMovement.count({ where: { businessId: disabledBusiness.id } }), 0);
  assert.equal((await prisma.invoiceItem.findUniqueOrThrow({ where: { id: disabledInvoice.items[0].id } })).inventoryTracked, false);
});

async function enableInventory(businessId: string, actorId: string) {
  const now = new Date();
  await prisma.businessModuleEntitlement.createMany({ data: [
    { businessId, moduleKey: "POS", status: "ENABLED", enabledFrom: now, source: "MANUAL", createdById: actorId, updatedById: actorId },
    { businessId, moduleKey: "INVENTORY", status: "ENABLED", enabledFrom: now, source: "MANUAL", createdById: actorId, updatedById: actorId },
  ] });
}

async function quantity(branchId: string, productId: string) {
  return (await prisma.productStock.findUniqueOrThrow({ where: { branchId_productId: { branchId, productId } } })).quantity;
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const host = new URL(url).hostname;
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Inventory integration test requires a Local database.");
}
