import { Prisma, type InventoryMovementType, type InventoryRefundDisposition } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";

const inventoryTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
} as const;

type Tx = Prisma.TransactionClient;

export class InventoryConflictError extends Error {
  readonly code = "INVENTORY_CONFLICT";
}

export class InsufficientStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";
}

type MovementInput = {
  actorUserId?: string | null;
  branchId: string;
  businessId: string;
  operationKey: string;
  productId: string;
  quantityDelta: number;
  reason: string;
  reference?: string | null;
  sourceId: string;
  sourceLineId?: string | null;
  sourceType: string;
  transferId?: string | null;
  type: InventoryMovementType;
  expectedRevision?: number;
};

export async function applyInventoryMovement(tx: Tx, input: MovementInput) {
  assertIntegerQuantity(input.quantityDelta);
  if (input.quantityDelta === 0) throw new Error("Inventory movement quantity cannot be zero.");
  if (input.reason.trim().length < 3) throw new Error("A clear inventory reason is required.");

  const existing = await tx.inventoryMovement.findUnique({
    where: {
      businessId_operationKey: {
        businessId: input.businessId,
        operationKey: input.operationKey,
      },
    },
  });
  if (existing) {
    if (movementFingerprint(existing) !== movementFingerprint(input)) {
      throw new InventoryConflictError("Inventory operation ID was reused with different details.");
    }
    return existing;
  }

  const [branch, product] = await Promise.all([
    tx.branch.findUnique({
      where: { id_businessId: { id: input.branchId, businessId: input.businessId } },
      select: { id: true, status: true },
    }),
    tx.product.findUnique({
      where: { id_businessId: { id: input.productId, businessId: input.businessId } },
      select: { id: true, name: true, status: true, trackInventory: true },
    }),
  ]);
  if (!branch || branch.status !== "ACTIVE") throw new Error("Active inventory branch not found.");
  if (!product) throw new Error("Inventory product not found.");
  if (!product.trackInventory) throw new Error(`${product.name} is not inventory-tracked.`);

  const balance = await tx.productStock.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
    create: {
      businessId: input.businessId,
      branchId: input.branchId,
      productId: input.productId,
      quantity: 0,
      reorderLevel: 0,
    },
    update: {},
  });
  if (input.expectedRevision !== undefined && balance.revision !== input.expectedRevision) {
    throw new InventoryConflictError("Stock changed after this form was opened. Refresh and try again.");
  }

  const quantityAfter = balance.quantity + input.quantityDelta;
  if (quantityAfter < 0) {
    throw new InsufficientStockError(`${product.name} does not have enough stock at this branch.`);
  }
  const updated = await tx.productStock.updateMany({
    where: {
      id: balance.id,
      revision: balance.revision,
      ...(input.quantityDelta < 0 ? { quantity: { gte: -input.quantityDelta } } : {}),
    },
    data: {
      quantity: quantityAfter,
      revision: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new InventoryConflictError("Concurrent inventory update detected. Please retry.");
  }

  return tx.inventoryMovement.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      branchId: input.branchId,
      businessId: input.businessId,
      operationKey: input.operationKey,
      productId: input.productId,
      quantityAfter,
      quantityBefore: balance.quantity,
      quantityDelta: input.quantityDelta,
      reason: input.reason.trim(),
      reference: input.reference?.trim() || null,
      sourceId: input.sourceId,
      sourceLineId: input.sourceLineId ?? null,
      sourceType: input.sourceType,
      transferId: input.transferId ?? null,
      type: input.type,
    },
  });
}

export async function recordSaleInventory(
  tx: Tx,
  input: {
    actorUserId: string;
    branchId: string;
    businessId: string;
    invoiceId: string;
    lines: readonly { invoiceItemId: string; productId: string; quantity: number }[];
  },
) {
  if (!(await isBusinessModuleEnabled(input.businessId, "INVENTORY", { database: tx }))) {
    return [];
  }
  const products = await tx.product.findMany({
    where: { businessId: input.businessId, id: { in: input.lines.map((line) => line.productId) } },
    select: { id: true, trackInventory: true },
  });
  const trackedIds = new Set(products.filter((product) => product.trackInventory).map((product) => product.id));
  const movements = [];
  for (const line of input.lines) {
    if (!trackedIds.has(line.productId)) continue;
    assertPositiveQuantity(line.quantity);
    await tx.invoiceItem.updateMany({
      where: { id: line.invoiceItemId, businessId: input.businessId, invoiceId: input.invoiceId },
      data: { inventoryTracked: true },
    });
    movements.push(await applyInventoryMovement(tx, {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      businessId: input.businessId,
      operationKey: `SALE:${line.invoiceItemId}`,
      productId: line.productId,
      quantityDelta: -line.quantity,
      reason: "Committed POS sale",
      sourceId: input.invoiceId,
      sourceLineId: line.invoiceItemId,
      sourceType: "INVOICE",
      type: "SALE",
    }));
  }
  return movements;
}

export async function recordVoidInventoryReversals(
  tx: Tx,
  input: { actorUserId: string; businessId: string; invoiceId: string; reason: string },
) {
  const saleMovements = await tx.inventoryMovement.findMany({
    where: {
      businessId: input.businessId,
      sourceId: input.invoiceId,
      sourceType: "INVOICE",
      type: "SALE",
    },
  });
  const reversals = [];
  for (const movement of saleMovements) {
    reversals.push(await applyInventoryMovement(tx, {
      actorUserId: input.actorUserId,
      branchId: movement.branchId,
      businessId: input.businessId,
      operationKey: `VOID_REVERSAL:${movement.id}`,
      productId: movement.productId,
      quantityDelta: -movement.quantityDelta,
      reason: input.reason,
      sourceId: input.invoiceId,
      sourceLineId: movement.sourceLineId,
      sourceType: "INVOICE_VOID",
      type: "VOID_REVERSAL",
    }));
  }
  return reversals;
}

export type RefundStockLineInput = {
  disposition: InventoryRefundDisposition;
  invoiceItemId: string;
  noRestockReason?: string | null;
  quantity: number;
};

export async function recordRefundInventory(
  tx: Tx,
  input: {
    actorUserId: string;
    branchId: string;
    businessId: string;
    paymentRefundId: string;
    lines: readonly RefundStockLineInput[];
  },
) {
  if (!(await isBusinessModuleEnabled(input.businessId, "INVENTORY", { database: tx }))) {
    return [];
  }
  const results = [];
  const refund = await tx.paymentRefund.findFirst({
    where: { id: input.paymentRefundId, businessId: input.businessId },
    select: { branchId: true, invoiceId: true },
  });
  if (!refund?.invoiceId) throw new Error("Refund invoice scope is required.");
  if (refund.branchId && refund.branchId !== input.branchId) {
    throw new Error("Refund branch scope mismatch.");
  }
  for (const line of input.lines) {
    assertPositiveQuantity(line.quantity);
    if (line.disposition === "NO_RESTOCK" && (line.noRestockReason?.trim().length ?? 0) < 3) {
      throw new Error("A clear no-restock reason is required.");
    }
    const invoiceItem = await tx.invoiceItem.findFirst({
      where: {
        id: line.invoiceItemId,
        businessId: input.businessId,
        invoiceId: refund.invoiceId,
        inventoryTracked: true,
      },
      select: { id: true, invoiceId: true, productId: true, quantity: true },
    });
    if (!invoiceItem?.productId) throw new Error("Tracked refund product line not found.");
    const alreadyReturned = await tx.inventoryRefundLine.aggregate({
      where: { businessId: input.businessId, invoiceItemId: invoiceItem.id },
      _sum: { quantity: true },
    });
    if ((alreadyReturned._sum.quantity ?? 0) + line.quantity > invoiceItem.quantity) {
      throw new Error("Refund stock quantity exceeds the sold quantity.");
    }
    const refundLine = await tx.inventoryRefundLine.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        businessId: input.businessId,
        disposition: line.disposition,
        invoiceItemId: invoiceItem.id,
        noRestockReason: line.disposition === "NO_RESTOCK" ? line.noRestockReason?.trim() : null,
        paymentRefundId: input.paymentRefundId,
        productId: invoiceItem.productId,
        quantity: line.quantity,
      },
    });
    if (line.disposition === "RESTOCK") {
      await applyInventoryMovement(tx, {
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        businessId: input.businessId,
        operationKey: `REFUND_RESTOCK:${refundLine.id}`,
        productId: invoiceItem.productId,
        quantityDelta: line.quantity,
        reason: "Refunded product returned to sellable stock",
        sourceId: input.paymentRefundId,
        sourceLineId: invoiceItem.id,
        sourceType: "PAYMENT_REFUND",
        type: "REFUND_RESTOCK",
      });
    }
    results.push(refundLine);
  }
  return results;
}

export async function runManualInventoryMovement(input: MovementInput) {
  if (!(await isBusinessModuleEnabled(input.businessId, "INVENTORY"))) {
    throw new Error("Inventory is not enabled for this business.");
  }
  return runInventorySerializable((tx) => applyInventoryMovement(tx, input));
}

export async function transferInventory(input: {
  actorUserId: string;
  businessId: string;
  destinationBranchId: string;
  operationKey: string;
  productId: string;
  quantity: number;
  reason: string;
  reference?: string | null;
  sourceBranchId: string;
}) {
  assertPositiveQuantity(input.quantity);
  if (input.sourceBranchId === input.destinationBranchId) {
    throw new Error("Source and destination branches must be different.");
  }
  if (!(await isBusinessModuleEnabled(input.businessId, "INVENTORY"))) {
    throw new Error("Inventory is not enabled for this business.");
  }
  return runInventorySerializable(async (tx) => {
    const existing = await tx.inventoryTransfer.findUnique({
      where: { businessId_operationKey: { businessId: input.businessId, operationKey: input.operationKey } },
      include: { movements: true },
    });
    if (existing) {
      if (
        existing.actorUserId !== input.actorUserId ||
        existing.sourceBranchId !== input.sourceBranchId ||
        existing.destinationBranchId !== input.destinationBranchId ||
        existing.productId !== input.productId ||
        existing.quantity !== input.quantity ||
        existing.reason !== input.reason.trim() ||
        (existing.reference ?? null) !== (input.reference?.trim() || null)
      ) {
        throw new InventoryConflictError("Inventory transfer operation ID was reused with different details.");
      }
      return existing;
    }
    const transfer = await tx.inventoryTransfer.create({
      data: {
        actorUserId: input.actorUserId,
        businessId: input.businessId,
        destinationBranchId: input.destinationBranchId,
        operationKey: input.operationKey,
        productId: input.productId,
        quantity: input.quantity,
        reason: input.reason.trim(),
        reference: input.reference?.trim() || null,
        sourceBranchId: input.sourceBranchId,
      },
    });
    await applyInventoryMovement(tx, {
      actorUserId: input.actorUserId,
      branchId: input.sourceBranchId,
      businessId: input.businessId,
      operationKey: `TRANSFER_OUT:${transfer.id}`,
      productId: input.productId,
      quantityDelta: -input.quantity,
      reason: input.reason,
      reference: input.reference,
      sourceId: transfer.id,
      sourceType: "TRANSFER",
      transferId: transfer.id,
      type: "TRANSFER_OUT",
    });
    await applyInventoryMovement(tx, {
      actorUserId: input.actorUserId,
      branchId: input.destinationBranchId,
      businessId: input.businessId,
      operationKey: `TRANSFER_IN:${transfer.id}`,
      productId: input.productId,
      quantityDelta: input.quantity,
      reason: input.reason,
      reference: input.reference,
      sourceId: transfer.id,
      sourceType: "TRANSFER",
      transferId: transfer.id,
      type: "TRANSFER_IN",
    });
    return tx.inventoryTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include: { movements: true } });
  });
}

export async function reconcileInventory(businessId: string, branchId?: string | null) {
  const [balances, ledgerGroups] = await Promise.all([
    prisma.productStock.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), product: { trackInventory: true } },
      include: { product: { select: { name: true, sku: true } }, branch: { select: { name: true } } },
    }),
    prisma.inventoryMovement.groupBy({
      by: ["branchId", "productId"],
      where: { businessId, ...(branchId ? { branchId } : {}) },
      _sum: { quantityDelta: true },
    }),
  ]);
  const ledgerQuantityByBalance = new Map(
    ledgerGroups.map((group) => [
      `${group.branchId}:${group.productId}`,
      group._sum.quantityDelta ?? 0,
    ]),
  );
  const balanceMismatches = [];
  for (const balance of balances) {
    const ledgerQuantity = ledgerQuantityByBalance.get(`${balance.branchId}:${balance.productId}`) ?? 0;
    if (ledgerQuantity !== balance.quantity) {
      balanceMismatches.push({
        branchId: balance.branchId,
        branchName: balance.branch.name,
        productId: balance.productId,
        productName: balance.product.name,
        balanceQuantity: balance.quantity,
        ledgerQuantity,
      });
    }
  }
  const trackedSaleLines = await prisma.invoiceItem.findMany({
    where: {
      businessId,
      inventoryTracked: true,
      invoice: { ...(branchId ? { branchId } : {}), status: { not: "VOID" } },
    },
    select: { id: true, invoiceId: true, productId: true, quantity: true },
  });
  const saleMovementLines = await prisma.inventoryMovement.findMany({
    where: { businessId, ...(branchId ? { branchId } : {}), type: "SALE" },
    select: { id: true, productId: true, sourceId: true, sourceLineId: true, quantityDelta: true },
  });
  const movementByLine = new Map<string, { count: number; quantity: number }>();
  for (const movement of saleMovementLines) {
    if (!movement.sourceLineId) continue;
    const current = movementByLine.get(movement.sourceLineId) ?? { count: 0, quantity: 0 };
    movementByLine.set(movement.sourceLineId, {
      count: current.count + 1,
      quantity: current.quantity + movement.quantityDelta,
    });
  }
  const trackedLineIds = new Set(trackedSaleLines.map((line) => line.id));
  const saleMismatches = [
    ...trackedSaleLines
      .filter((line) => {
        const movement = movementByLine.get(line.id);
        return !movement || movement.count !== 1 || movement.quantity !== -line.quantity;
      })
      .map((line) => ({
        ...line,
        movementCount: movementByLine.get(line.id)?.count ?? 0,
        movementQuantity: movementByLine.get(line.id)?.quantity ?? 0,
        reason: "MISSING_DUPLICATE_OR_QUANTITY_MISMATCH",
      })),
    ...saleMovementLines
      .filter((movement) => !movement.sourceLineId || !trackedLineIds.has(movement.sourceLineId))
      .map((movement) => ({
        id: movement.sourceLineId ?? movement.id,
        invoiceId: movement.sourceId,
        productId: movement.productId,
        quantity: 0,
        movementCount: 1,
        movementQuantity: movement.quantityDelta,
        reason: "ORPHAN_SALE_MOVEMENT",
      })),
  ];
  const [receiptLines, receiptReversals, receiptMovements, purchaseOrderLines] = await Promise.all([
    prisma.goodsReceiptLine.findMany({
      where: { businessId, ...(branchId ? { goodsReceipt: { branchId } } : {}) },
      select: { id: true, goodsReceiptId: true, productId: true, purchaseOrderLineId: true, receivedQuantity: true, goodsReceipt: { select: { branchId: true } } },
    }),
    prisma.goodsReceiptReversal.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
      select: { id: true, branchId: true, goodsReceiptLineId: true, productId: true, purchaseOrderLineId: true, reversedQuantity: true },
    }),
    prisma.inventoryMovement.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), sourceType: { in: ["GOODS_RECEIPT", "GOODS_RECEIPT_REVERSAL"] } },
      select: { branchId: true, id: true, productId: true, quantityDelta: true, sourceId: true, sourceLineId: true, sourceType: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: { businessId, ...(branchId ? { purchaseOrder: { branchId } } : {}) },
      select: { id: true, productId: true, receivedQuantity: true },
    }),
  ]);
  const receiptMovementByLine = new Map<string, typeof receiptMovements>();
  for (const movement of receiptMovements) {
    if (!movement.sourceLineId) continue;
    receiptMovementByLine.set(movement.sourceLineId, [...(receiptMovementByLine.get(movement.sourceLineId) ?? []), movement]);
  }
  const receiptMismatches = receiptLines.flatMap((line) => {
    const movements = (receiptMovementByLine.get(line.id) ?? []).filter((movement) => movement.sourceType === "GOODS_RECEIPT");
    return movements.length === 1 && movements[0].quantityDelta === line.receivedQuantity && movements[0].productId === line.productId && movements[0].branchId === line.goodsReceipt.branchId
      ? []
      : [{ id: line.id, movementCount: movements.length, movementQuantity: movements.reduce((sum, movement) => sum + movement.quantityDelta, 0), reason: "MISSING_DUPLICATE_QUANTITY_PRODUCT_OR_BRANCH_MISMATCH" }];
  });
  const reversalMismatches = receiptReversals.flatMap((reversal) => {
    const movements = (receiptMovementByLine.get(reversal.id) ?? []).filter((movement) => movement.sourceType === "GOODS_RECEIPT_REVERSAL");
    return movements.length === 1 && movements[0].quantityDelta === -reversal.reversedQuantity && movements[0].productId === reversal.productId && movements[0].branchId === reversal.branchId
      ? []
      : [{ id: reversal.id, movementCount: movements.length, movementQuantity: movements.reduce((sum, movement) => sum + movement.quantityDelta, 0), reason: "MISSING_DUPLICATE_QUANTITY_PRODUCT_OR_BRANCH_MISMATCH" }];
  });
  const receiptLineIds = new Set(receiptLines.map((line) => line.id));
  const reversalIds = new Set(receiptReversals.map((reversal) => reversal.id));
  for (const movement of receiptMovements) {
    if (!movement.sourceLineId || (movement.sourceType === "GOODS_RECEIPT" ? !receiptLineIds.has(movement.sourceLineId) : !reversalIds.has(movement.sourceLineId))) {
      (movement.sourceType === "GOODS_RECEIPT" ? receiptMismatches : reversalMismatches).push({ id: movement.id, movementCount: 1, movementQuantity: movement.quantityDelta, reason: "ORPHAN_PURCHASING_MOVEMENT" });
    }
  }
  const receivedByPoLine = new Map<string, number>();
  for (const line of receiptLines) receivedByPoLine.set(line.purchaseOrderLineId, (receivedByPoLine.get(line.purchaseOrderLineId) ?? 0) + line.receivedQuantity);
  for (const reversal of receiptReversals) receivedByPoLine.set(reversal.purchaseOrderLineId, (receivedByPoLine.get(reversal.purchaseOrderLineId) ?? 0) - reversal.reversedQuantity);
  const purchaseOrderMismatches = purchaseOrderLines.filter((line) => line.receivedQuantity !== (receivedByPoLine.get(line.id) ?? 0)).map((line) => ({ id: line.id, materializedQuantity: line.receivedQuantity, receiptQuantity: receivedByPoLine.get(line.id) ?? 0, reason: "PO_RECEIVED_QUANTITY_MISMATCH" }));
  const [approvedCountLines, stockCountMovements] = await Promise.all([
    prisma.stockCountLine.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), session: { status: "APPROVED" } },
      select: { branchId: true, id: true, productId: true, sessionId: true, varianceQuantity: true },
    }),
    prisma.inventoryMovement.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}), sourceType: "STOCK_COUNT" },
      select: { branchId: true, id: true, productId: true, quantityDelta: true, sourceId: true, sourceLineId: true },
    }),
  ]);
  const countMovementByLine = new Map<string, typeof stockCountMovements>();
  for (const movement of stockCountMovements) {
    if (!movement.sourceLineId) continue;
    countMovementByLine.set(movement.sourceLineId, [...(countMovementByLine.get(movement.sourceLineId) ?? []), movement]);
  }
  const stockCountMismatches = approvedCountLines.flatMap((line) => {
    const movements = countMovementByLine.get(line.id) ?? [];
    const expected = line.varianceQuantity ?? 0;
    const valid = expected === 0
      ? movements.length === 0
      : movements.length === 1 && movements[0].quantityDelta === expected && movements[0].branchId === line.branchId && movements[0].productId === line.productId && movements[0].sourceId === line.sessionId;
    return valid ? [] : [{ id: line.id, expectedQuantity: expected, movementCount: movements.length, movementQuantity: movements.reduce((sum, movement) => sum + movement.quantityDelta, 0), reason: "MISSING_DUPLICATE_QUANTITY_PRODUCT_OR_BRANCH_MISMATCH" }];
  });
  const approvedLineIds = new Set(approvedCountLines.map((line) => line.id));
  for (const movement of stockCountMovements) {
    if (!movement.sourceLineId || !approvedLineIds.has(movement.sourceLineId)) stockCountMismatches.push({ id: movement.id, expectedQuantity: 0, movementCount: 1, movementQuantity: movement.quantityDelta, reason: "ORPHAN_STOCK_COUNT_MOVEMENT" });
  }
  return {
    balanceMismatches,
    purchaseOrderMismatches,
    receiptMismatches,
    reversalMismatches,
    saleMismatches,
    stockCountMismatches,
    ok: balanceMismatches.length === 0 && saleMismatches.length === 0 && receiptMismatches.length === 0 && reversalMismatches.length === 0 && purchaseOrderMismatches.length === 0 && stockCountMismatches.length === 0,
  };
}

export async function rebuildInventoryBalancesForTesting(businessId: string) {
  assertLocalOrTestingDatabase();
  return runInventorySerializable(async (tx) => {
    const [branches, products] = await Promise.all([
      tx.branch.findMany({ where: { businessId, status: "ACTIVE" }, select: { id: true } }),
      tx.product.findMany({ where: { businessId, trackInventory: true }, select: { id: true } }),
    ]);
    let rebuilt = 0;
    for (const product of products) {
      for (const branch of branches) {
        const ledger = await tx.inventoryMovement.aggregate({
          where: { businessId, branchId: branch.id, productId: product.id },
          _sum: { quantityDelta: true },
        });
        await tx.productStock.upsert({
          where: { branchId_productId: { branchId: branch.id, productId: product.id } },
          create: {
            branchId: branch.id,
            businessId,
            productId: product.id,
            quantity: ledger._sum.quantityDelta ?? 0,
            reorderLevel: 0,
            revision: 1,
          },
          update: {
            quantity: ledger._sum.quantityDelta ?? 0,
            revision: { increment: 1 },
          },
        });
        rebuilt += 1;
      }
    }
    return { rebuilt };
  });
}

export async function runInventorySerializable<T>(operation: (tx: Tx) => Promise<T>) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(operation, inventoryTransactionOptions);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 4) {
        throw error;
      }
    }
  }
  throw new Error("Inventory transaction retry limit exceeded.");
}

function movementFingerprint(value: Pick<MovementInput, "actorUserId" | "branchId" | "productId" | "quantityDelta" | "type" | "sourceId" | "sourceLineId" | "reason" | "reference">) {
  return createHash("sha256").update(JSON.stringify([
    value.actorUserId ?? null,
    value.branchId,
    value.productId,
    value.quantityDelta,
    value.type,
    value.sourceId,
    value.sourceLineId ?? null,
    value.reason.trim(),
    value.reference?.trim() || null,
  ])).digest("hex");
}

function assertIntegerQuantity(quantity: number) {
  if (!Number.isInteger(quantity)) throw new Error("Inventory quantity must be a whole number.");
}

function assertPositiveQuantity(quantity: number) {
  assertIntegerQuantity(quantity);
  if (quantity <= 0) throw new Error("Inventory quantity must be greater than zero.");
}

function assertLocalOrTestingDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("LOCAL_OR_TESTING_DATABASE_URL_REQUIRED");
  const hostname = new URL(value).hostname.toLowerCase();
  if (
    !["localhost", "127.0.0.1", "::1"].includes(hostname) &&
    process.env.ALLOW_INVENTORY_TEST_REBUILD !== "true"
  ) {
    throw new Error("INVENTORY_BALANCE_REBUILD_LOCAL_TESTING_ONLY");
  }
}
