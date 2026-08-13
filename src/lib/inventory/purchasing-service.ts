import { createHash } from "node:crypto";
import { Prisma, type InventoryPurchasingCommandType, type PurchaseOrderStatus } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { applyInventoryMovement, InventoryConflictError, runInventorySerializable } from "@/lib/inventory/service";

type Tx = Prisma.TransactionClient;

export type PurchasingActor = {
  userId: string;
  name?: string | null;
  email?: string | null;
};

export type PurchaseOrderLineInput = {
  productId: string;
  orderedQuantity: number;
  expectedUnitCost: number | string;
  notes?: string | null;
};

type CommandContext = {
  actor: PurchasingActor;
  businessId: string;
  operationKey: string;
};

export class PurchasingConflictError extends Error {
  readonly code = "PURCHASING_CONFLICT";
}

export async function createSupplier(input: CommandContext & {
  address?: string | null;
  code?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  name: string;
  notes?: string | null;
  phone?: string | null;
}) {
  validateOperation(input.operationKey);
  const clean = supplierPayload(input);
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CREATE_SUPPLIER", clean);
    if (replay) return tx.supplier.findUniqueOrThrow({ where: { id: replay } });
    if (!clean.name) throw new Error("Supplier name is required.");
    const supplier = await tx.supplier.create({ data: { businessId: input.businessId, ...clean } });
    await recordCommand(tx, input, "CREATE_SUPPLIER", clean, "SUPPLIER", supplier.id);
    await audit(tx, input, "SUPPLIER_CREATED", "Supplier", supplier.id, `Supplier ${supplier.name} created.`, null, supplier);
    return supplier;
  });
}

export async function updateSupplier(input: CommandContext & {
  supplierId: string;
  address?: string | null;
  code?: string | null;
  contactPerson?: string | null;
  email?: string | null;
  name: string;
  notes?: string | null;
  phone?: string | null;
  status: "ACTIVE" | "INACTIVE";
}) {
  validateOperation(input.operationKey);
  const changes = { ...supplierPayload(input), status: input.status };
  const payload = { ...changes, supplierId: input.supplierId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "UPDATE_SUPPLIER", payload);
    if (replay) return tx.supplier.findUniqueOrThrow({ where: { id: replay } });
    const before = await tx.supplier.findUnique({ where: { id_businessId: { id: input.supplierId, businessId: input.businessId } } });
    if (!before) throw new Error("Supplier not found.");
    if (!changes.name) throw new Error("Supplier name is required.");
    const supplier = await tx.supplier.update({ where: { id: before.id }, data: changes });
    await recordCommand(tx, input, "UPDATE_SUPPLIER", payload, "SUPPLIER", supplier.id);
    await audit(tx, input, supplier.status === "INACTIVE" && before.status !== "INACTIVE" ? "SUPPLIER_DEACTIVATED" : "SUPPLIER_UPDATED", "Supplier", supplier.id, `Supplier ${supplier.name} updated.`, before, supplier);
    return supplier;
  });
}

export async function createPurchaseOrder(input: CommandContext & {
  branchId: string;
  expectedDate?: Date | null;
  lines: PurchaseOrderLineInput[];
  notes?: string | null;
  orderDate: Date;
  supplierId: string;
}) {
  validateOperation(input.operationKey);
  validateLines(input.lines);
  const payload = poPayload(input);
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CREATE_PURCHASE_ORDER", payload);
    if (replay) return getPurchaseOrder(tx, input.businessId, replay);
    await validateNewPurchaseOrderReferences(tx, input.businessId, input.branchId, input.supplierId, input.lines);
    const sequence = await tx.business.update({ where: { id: input.businessId }, data: { purchaseOrderSequence: { increment: 1 } }, select: { purchaseOrderSequence: true } });
    const poNumber = `PO-${String(sequence.purchaseOrderSequence).padStart(6, "0")}`;
    const subtotal = calculateSubtotal(input.lines);
    const purchaseOrder = await tx.purchaseOrder.create({ data: { branchId: input.branchId, businessId: input.businessId, createdById: input.actor.userId, expectedDate: input.expectedDate ?? null, notes: cleanNullable(input.notes), orderDate: input.orderDate, poNumber, subtotal, supplierId: input.supplierId } });
    await tx.purchaseOrderLine.createMany({ data: input.lines.map((line) => ({ purchaseOrderId: purchaseOrder.id, ...lineData(input.businessId, line) })) });
    await recordCommand(tx, input, "CREATE_PURCHASE_ORDER", payload, "PURCHASE_ORDER", purchaseOrder.id);
    await audit(tx, input, "PURCHASE_ORDER_CREATED", "PurchaseOrder", purchaseOrder.id, `${poNumber} created as draft.`, null, purchaseOrder, input.branchId);
    return getPurchaseOrder(tx, input.businessId, purchaseOrder.id);
  });
}

export async function updatePurchaseOrder(input: CommandContext & {
  expectedDate?: Date | null;
  expectedRevision: number;
  lines: PurchaseOrderLineInput[];
  notes?: string | null;
  orderDate: Date;
  purchaseOrderId: string;
  supplierId: string;
}) {
  validateOperation(input.operationKey);
  validateLines(input.lines);
  const payload = { ...poPayload(input), expectedRevision: input.expectedRevision, purchaseOrderId: input.purchaseOrderId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "UPDATE_PURCHASE_ORDER", payload);
    if (replay) return getPurchaseOrder(tx, input.businessId, replay);
    const before = await getPurchaseOrder(tx, input.businessId, input.purchaseOrderId);
    if (before.status !== "DRAFT") throw new Error("Only a draft purchase order can be edited.");
    if (before.revision !== input.expectedRevision) throw new PurchasingConflictError("Purchase order changed after this form was opened.");
    await validateNewPurchaseOrderReferences(tx, input.businessId, before.branchId, input.supplierId, input.lines);
    const updated = await tx.purchaseOrder.updateMany({
      where: { businessId: input.businessId, id: before.id, revision: input.expectedRevision, status: "DRAFT" },
      data: { expectedDate: input.expectedDate ?? null, notes: cleanNullable(input.notes), orderDate: input.orderDate, revision: { increment: 1 }, subtotal: calculateSubtotal(input.lines), supplierId: input.supplierId },
    });
    if (updated.count !== 1) throw new PurchasingConflictError("Concurrent purchase order update detected.");
    await tx.purchaseOrderLine.deleteMany({ where: { businessId: input.businessId, purchaseOrderId: before.id } });
    await tx.purchaseOrderLine.createMany({ data: input.lines.map((line) => ({ purchaseOrderId: before.id, ...lineData(input.businessId, line) })) });
    await recordCommand(tx, input, "UPDATE_PURCHASE_ORDER", payload, "PURCHASE_ORDER", before.id);
    const after = await getPurchaseOrder(tx, input.businessId, before.id);
    await audit(tx, input, "PURCHASE_ORDER_UPDATED", "PurchaseOrder", before.id, `${before.poNumber} draft updated.`, before, after, before.branchId);
    return after;
  });
}

export async function approvePurchaseOrder(input: CommandContext & { expectedRevision: number; purchaseOrderId: string }) {
  return transitionPurchaseOrder(input, "APPROVE_PURCHASE_ORDER", async (tx, purchaseOrder) => {
    if (purchaseOrder.status !== "DRAFT") throw new Error("Only a draft purchase order can be approved.");
    if (purchaseOrder.createdById === input.actor.userId) throw new Error("The purchase order creator cannot approve their own order.");
    const updated = await guardedPoUpdate(tx, purchaseOrder, input.expectedRevision, { approvedAt: new Date(), approvedById: input.actor.userId, revision: { increment: 1 }, status: "APPROVED" });
    await audit(tx, input, "PURCHASE_ORDER_APPROVED", "PurchaseOrder", purchaseOrder.id, `${purchaseOrder.poNumber} approved; stock unchanged.`, purchaseOrder, updated, purchaseOrder.branchId);
    return updated;
  });
}

export async function cancelPurchaseOrder(input: CommandContext & { expectedRevision: number; purchaseOrderId: string; reason: string }) {
  if (input.reason.trim().length < 3) throw new Error("Cancellation reason is required.");
  return transitionPurchaseOrder(input, "CANCEL_PURCHASE_ORDER", async (tx, purchaseOrder) => {
    if (!(["DRAFT", "APPROVED"] as PurchaseOrderStatus[]).includes(purchaseOrder.status)) throw new Error("This purchase order cannot be cancelled.");
    if (purchaseOrder.lines.some((line) => line.receivedQuantity > 0)) throw new Error("A partially received order must be closed, not cancelled.");
    const updated = await guardedPoUpdate(tx, purchaseOrder, input.expectedRevision, { cancellationReason: input.reason.trim(), cancelledAt: new Date(), cancelledById: input.actor.userId, revision: { increment: 1 }, status: "CANCELLED" });
    await audit(tx, input, "PURCHASE_ORDER_CANCELLED", "PurchaseOrder", purchaseOrder.id, `${purchaseOrder.poNumber} cancelled.`, purchaseOrder, updated, purchaseOrder.branchId);
    return updated;
  });
}

export async function closePurchaseOrder(input: CommandContext & { expectedRevision: number; purchaseOrderId: string; reason: string }) {
  if (input.reason.trim().length < 3) throw new Error("Close reason is required.");
  return transitionPurchaseOrder(input, "CLOSE_PURCHASE_ORDER", async (tx, purchaseOrder) => {
    if (!(["APPROVED", "PARTIALLY_RECEIVED"] as PurchaseOrderStatus[]).includes(purchaseOrder.status)) throw new Error("Only an approved open order can be closed.");
    const updated = await guardedPoUpdate(tx, purchaseOrder, input.expectedRevision, { closeReason: input.reason.trim(), closedAt: new Date(), closedById: input.actor.userId, revision: { increment: 1 }, status: "CLOSED" });
    await audit(tx, input, "PURCHASE_ORDER_CLOSED", "PurchaseOrder", purchaseOrder.id, `${purchaseOrder.poNumber} remaining quantity closed without stock movement.`, purchaseOrder, updated, purchaseOrder.branchId);
    return updated;
  });
}

export async function receivePurchaseOrder(input: CommandContext & {
  deliveryReference?: string | null;
  lines: Array<{ purchaseOrderLineId: string; quantity: number }>;
  notes?: string | null;
  purchaseOrderId: string;
}) {
  validateOperation(input.operationKey);
  if (!input.lines.length || input.lines.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) throw new Error("At least one positive whole receive quantity is required.");
  const ids = new Set(input.lines.map((line) => line.purchaseOrderLineId));
  if (ids.size !== input.lines.length) throw new Error("Each purchase order line may be received once per receipt.");
  const payload = { deliveryReference: cleanNullable(input.deliveryReference), lines: input.lines, notes: cleanNullable(input.notes), purchaseOrderId: input.purchaseOrderId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "RECEIVE_PURCHASE_ORDER", payload);
    if (replay) return getGoodsReceipt(tx, input.businessId, replay);
    const purchaseOrder = await getPurchaseOrder(tx, input.businessId, input.purchaseOrderId);
    if (!(["APPROVED", "PARTIALLY_RECEIVED"] as PurchaseOrderStatus[]).includes(purchaseOrder.status)) throw new Error("Purchase order is not open for receiving.");
    const branch = await tx.branch.findUnique({ where: { id_businessId: { id: purchaseOrder.branchId, businessId: input.businessId } }, select: { status: true } });
    if (!branch || branch.status !== "ACTIVE") throw new Error("Goods cannot be received into an inactive branch.");
    const byId = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
    for (const line of input.lines) {
      const poLine = byId.get(line.purchaseOrderLineId);
      if (!poLine) throw new Error("Receipt line is not part of this purchase order.");
      if (poLine.receivedQuantity + line.quantity > poLine.orderedQuantity) throw new Error(`Over-receipt blocked for ${poLine.product.name}.`);
    }
    const sequence = await tx.business.update({ where: { id: input.businessId }, data: { goodsReceiptSequence: { increment: 1 } }, select: { goodsReceiptSequence: true } });
    const receipt = await tx.goodsReceipt.create({ data: { branchId: purchaseOrder.branchId, businessId: input.businessId, deliveryReference: cleanNullable(input.deliveryReference), notes: cleanNullable(input.notes), purchaseOrderId: purchaseOrder.id, receivedById: input.actor.userId, receiptNumber: `GRN-${String(sequence.goodsReceiptSequence).padStart(6, "0")}`, supplierId: purchaseOrder.supplierId } });
    for (const line of input.lines) {
      const poLine = byId.get(line.purchaseOrderLineId)!;
      const remaining = poLine.orderedQuantity - poLine.receivedQuantity - line.quantity;
      const receiptLine = await tx.goodsReceiptLine.create({ data: { businessId: input.businessId, goodsReceiptId: receipt.id, orderedQuantitySnapshot: poLine.orderedQuantity, previouslyReceived: poLine.receivedQuantity, productId: poLine.productId, purchaseOrderLineId: poLine.id, receivedQuantity: line.quantity, remainingAfterReceipt: remaining, unitCostSnapshot: poLine.expectedUnitCost } });
      const lineUpdate = await tx.purchaseOrderLine.updateMany({ where: { id: poLine.id, businessId: input.businessId, receivedQuantity: poLine.receivedQuantity }, data: { receivedQuantity: { increment: line.quantity } } });
      if (lineUpdate.count !== 1) throw new PurchasingConflictError("Concurrent goods receipt detected.");
      await applyInventoryMovement(tx, { actorUserId: input.actor.userId, branchId: purchaseOrder.branchId, businessId: input.businessId, operationKey: `GOODS_RECEIPT:${receiptLine.id}`, productId: poLine.productId, quantityDelta: line.quantity, reason: `Goods received for ${purchaseOrder.poNumber}`, reference: receipt.receiptNumber, sourceId: receipt.id, sourceLineId: receiptLine.id, sourceType: "GOODS_RECEIPT", type: "STOCK_IN" });
    }
    const refreshedLines = await tx.purchaseOrderLine.findMany({ where: { businessId: input.businessId, purchaseOrderId: purchaseOrder.id } });
    const nextStatus: PurchaseOrderStatus = refreshedLines.every((line) => line.receivedQuantity === line.orderedQuantity) ? "RECEIVED" : "PARTIALLY_RECEIVED";
    const poUpdate = await tx.purchaseOrder.updateMany({ where: { id: purchaseOrder.id, businessId: input.businessId, revision: purchaseOrder.revision, status: purchaseOrder.status }, data: { revision: { increment: 1 }, status: nextStatus } });
    if (poUpdate.count !== 1) throw new PurchasingConflictError("Purchase order state changed while receiving.");
    await recordCommand(tx, input, "RECEIVE_PURCHASE_ORDER", payload, "GOODS_RECEIPT", receipt.id);
    await audit(tx, input, "GOODS_RECEIPT_CREATED", "GoodsReceipt", receipt.id, `${receipt.receiptNumber} received into ${purchaseOrder.poNumber}.`, null, receipt, purchaseOrder.branchId);
    return getGoodsReceipt(tx, input.businessId, receipt.id);
  });
}

export async function reverseGoodsReceiptLine(input: CommandContext & { goodsReceiptLineId: string; quantity: number; reason: string }) {
  validateOperation(input.operationKey);
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("Reversal quantity must be a positive whole number.");
  if (input.reason.trim().length < 3) throw new Error("Reversal reason is required.");
  const payload = { goodsReceiptLineId: input.goodsReceiptLineId, quantity: input.quantity, reason: input.reason.trim() };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "REVERSE_GOODS_RECEIPT", payload);
    if (replay) return tx.goodsReceiptReversal.findUniqueOrThrow({ where: { id: replay } });
    const line = await tx.goodsReceiptLine.findFirst({ where: { id: input.goodsReceiptLineId, businessId: input.businessId }, include: { goodsReceipt: true, purchaseOrderLine: true, reversals: true } });
    if (!line) throw new Error("Goods receipt line not found.");
    const alreadyReversed = line.reversals.reduce((sum, reversal) => sum + reversal.reversedQuantity, 0);
    if (alreadyReversed + input.quantity > line.receivedQuantity) throw new Error("Reversal exceeds the net received quantity.");
    const reversal = await tx.goodsReceiptReversal.create({ data: { branchId: line.goodsReceipt.branchId, businessId: input.businessId, createdById: input.actor.userId, goodsReceiptId: line.goodsReceiptId, goodsReceiptLineId: line.id, productId: line.productId, purchaseOrderId: line.goodsReceipt.purchaseOrderId, purchaseOrderLineId: line.purchaseOrderLineId, reason: input.reason.trim(), reversedQuantity: input.quantity } });
    await applyInventoryMovement(tx, { actorUserId: input.actor.userId, branchId: line.goodsReceipt.branchId, businessId: input.businessId, operationKey: `GOODS_RECEIPT_REVERSAL:${reversal.id}`, productId: line.productId, quantityDelta: -input.quantity, reason: input.reason.trim(), reference: line.goodsReceipt.receiptNumber, sourceId: reversal.id, sourceLineId: reversal.id, sourceType: "GOODS_RECEIPT_REVERSAL", type: "STOCK_OUT" });
    const lineUpdate = await tx.purchaseOrderLine.updateMany({ where: { id: line.purchaseOrderLineId, businessId: input.businessId, receivedQuantity: line.purchaseOrderLine.receivedQuantity }, data: { receivedQuantity: { decrement: input.quantity } } });
    if (lineUpdate.count !== 1) throw new PurchasingConflictError("Purchase order receipt quantity changed concurrently.");
    const receiptReversals = await tx.goodsReceiptReversal.aggregate({ where: { businessId: input.businessId, goodsReceiptId: line.goodsReceiptId }, _sum: { reversedQuantity: true } });
    const receiptTotal = await tx.goodsReceiptLine.aggregate({ where: { businessId: input.businessId, goodsReceiptId: line.goodsReceiptId }, _sum: { receivedQuantity: true } });
    const reversed = receiptReversals._sum.reversedQuantity ?? 0;
    const total = receiptTotal._sum.receivedQuantity ?? 0;
    await tx.goodsReceipt.update({ where: { id: line.goodsReceiptId }, data: { status: reversed === total ? "REVERSED" : "PARTIALLY_REVERSED" } });
    const purchaseOrder = await getPurchaseOrder(tx, input.businessId, line.goodsReceipt.purchaseOrderId);
    if (purchaseOrder.status !== "CLOSED") {
      const status: PurchaseOrderStatus = purchaseOrder.lines.every((poLine) => poLine.receivedQuantity === poLine.orderedQuantity) ? "RECEIVED" : purchaseOrder.lines.some((poLine) => poLine.receivedQuantity > 0) ? "PARTIALLY_RECEIVED" : "APPROVED";
      await tx.purchaseOrder.update({ where: { id: purchaseOrder.id }, data: { revision: { increment: 1 }, status } });
    }
    await recordCommand(tx, input, "REVERSE_GOODS_RECEIPT", payload, "GOODS_RECEIPT_REVERSAL", reversal.id);
    await audit(tx, input, "GOODS_RECEIPT_REVERSED", "GoodsReceiptReversal", reversal.id, `${input.quantity} unit(s) reversed from ${line.goodsReceipt.receiptNumber}.`, null, reversal, line.goodsReceipt.branchId);
    return reversal;
  });
}

async function transitionPurchaseOrder(input: CommandContext & { expectedRevision: number; purchaseOrderId: string }, type: Extract<InventoryPurchasingCommandType, "APPROVE_PURCHASE_ORDER" | "CANCEL_PURCHASE_ORDER" | "CLOSE_PURCHASE_ORDER">, work: (tx: Tx, purchaseOrder: Awaited<ReturnType<typeof getPurchaseOrder>>) => Promise<Awaited<ReturnType<typeof getPurchaseOrder>>>) {
  validateOperation(input.operationKey);
  const payload = { expectedRevision: input.expectedRevision, purchaseOrderId: input.purchaseOrderId, reason: "reason" in input ? (input as { reason: string }).reason : null };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, type, payload);
    if (replay) return getPurchaseOrder(tx, input.businessId, replay);
    const purchaseOrder = await getPurchaseOrder(tx, input.businessId, input.purchaseOrderId);
    const result = await work(tx, purchaseOrder);
    await recordCommand(tx, input, type, payload, "PURCHASE_ORDER", purchaseOrder.id);
    return result;
  });
}

async function guardedPoUpdate(tx: Tx, purchaseOrder: Awaited<ReturnType<typeof getPurchaseOrder>>, revision: number, data: Prisma.PurchaseOrderUncheckedUpdateManyInput) {
  if (purchaseOrder.revision !== revision) throw new PurchasingConflictError("Purchase order changed after this form was opened.");
  const result = await tx.purchaseOrder.updateMany({ where: { id: purchaseOrder.id, businessId: purchaseOrder.businessId, revision, status: purchaseOrder.status }, data });
  if (result.count !== 1) throw new PurchasingConflictError("Concurrent purchase order transition detected.");
  return getPurchaseOrder(tx, purchaseOrder.businessId, purchaseOrder.id);
}

async function getPurchaseOrder(tx: Tx, businessId: string, id: string) {
  return tx.purchaseOrder.findFirstOrThrow({ where: { businessId, id }, include: { branch: true, createdBy: { select: { id: true, name: true } }, supplier: true, lines: { include: { product: true }, orderBy: { createdAt: "asc" } }, receipts: { include: { lines: true }, orderBy: { receivedAt: "desc" } } } });
}

async function getGoodsReceipt(tx: Tx, businessId: string, id: string) {
  return tx.goodsReceipt.findFirstOrThrow({ where: { businessId, id }, include: { lines: { include: { product: true, reversals: true } }, purchaseOrder: true, receivedBy: { select: { id: true, name: true } }, supplier: true } });
}

async function validateNewPurchaseOrderReferences(tx: Tx, businessId: string, branchId: string, supplierId: string, lines: PurchaseOrderLineInput[]) {
  const [branch, supplier, products] = await Promise.all([
    tx.branch.findUnique({ where: { id_businessId: { id: branchId, businessId } }, select: { status: true } }),
    tx.supplier.findUnique({ where: { id_businessId: { id: supplierId, businessId } }, select: { status: true } }),
    tx.product.findMany({ where: { businessId, id: { in: lines.map((line) => line.productId) } }, select: { id: true, status: true, trackInventory: true } }),
  ]);
  if (!branch || branch.status !== "ACTIVE") throw new Error("Active purchase order branch not found.");
  if (!supplier || supplier.status !== "ACTIVE") throw new Error("Active supplier not found.");
  if (products.length !== lines.length || products.some((product) => product.status !== "ACTIVE" || !product.trackInventory)) throw new Error("New purchase orders require active inventory-tracked products.");
}

function validateLines(lines: PurchaseOrderLineInput[]) {
  if (!lines.length) throw new Error("Purchase order requires at least one line.");
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) throw new Error("Duplicate products are not allowed on a purchase order.");
  for (const line of lines) {
    if (!Number.isInteger(line.orderedQuantity) || line.orderedQuantity <= 0) throw new Error("Ordered quantity must be a positive whole number.");
    const cost = Number(line.expectedUnitCost);
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Expected unit cost cannot be negative.");
  }
}

function lineData(businessId: string, line: PurchaseOrderLineInput) {
  const unitCost = new Prisma.Decimal(line.expectedUnitCost);
  return { businessId, expectedTotal: unitCost.mul(line.orderedQuantity), expectedUnitCost: unitCost, notes: cleanNullable(line.notes), orderedQuantity: line.orderedQuantity, productId: line.productId };
}

function calculateSubtotal(lines: PurchaseOrderLineInput[]) {
  return lines.reduce((sum, line) => sum.add(new Prisma.Decimal(line.expectedUnitCost).mul(line.orderedQuantity)), new Prisma.Decimal(0));
}

function poPayload(input: { branchId?: string; expectedDate?: Date | null; lines: PurchaseOrderLineInput[]; notes?: string | null; orderDate: Date; supplierId: string }) {
  return { branchId: input.branchId, expectedDate: input.expectedDate?.toISOString() ?? null, lines: input.lines.map((line) => ({ ...line, expectedUnitCost: String(line.expectedUnitCost), notes: cleanNullable(line.notes) })), notes: cleanNullable(input.notes), orderDate: input.orderDate.toISOString(), supplierId: input.supplierId };
}

function supplierPayload(input: { address?: string | null; code?: string | null; contactPerson?: string | null; email?: string | null; name: string; notes?: string | null; phone?: string | null }) {
  return { address: cleanNullable(input.address), code: cleanNullable(input.code)?.toUpperCase() ?? null, contactPerson: cleanNullable(input.contactPerson), email: cleanNullable(input.email)?.toLowerCase() ?? null, name: input.name.trim(), notes: cleanNullable(input.notes), phone: cleanNullable(input.phone) };
}

async function commandReplay(tx: Tx, context: CommandContext, type: InventoryPurchasingCommandType, payload: unknown) {
  const existing = await tx.inventoryPurchasingCommand.findUnique({ where: { businessId_operationKey: { businessId: context.businessId, operationKey: context.operationKey } } });
  if (!existing) return null;
  if (existing.commandType !== type || existing.requestFingerprint !== fingerprint(payload)) throw new PurchasingConflictError("Purchasing operation ID was reused with different details.");
  return existing.resultEntityId;
}

async function recordCommand(tx: Tx, context: CommandContext, type: InventoryPurchasingCommandType, payload: unknown, resultEntityType: string, resultEntityId: string) {
  await tx.inventoryPurchasingCommand.create({ data: { actorUserId: context.actor.userId, businessId: context.businessId, commandType: type, operationKey: context.operationKey, requestFingerprint: fingerprint(payload), resultEntityId, resultEntityType } });
}

async function audit(tx: Tx, context: CommandContext, action: string, entityType: string, entityId: string, summary: string, before: unknown, after: unknown, branchId?: string) {
  await writeAuditLog({ action, actor: { email: context.actor.email ?? "", name: context.actor.name ?? "System", userId: context.actor.userId }, after, before, branchId, businessId: context.businessId, entityId, entityType, summary }, tx);
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)]));
  return value;
}

function cleanNullable(value?: string | null) {
  const clean = value?.trim();
  return clean || null;
}

function validateOperation(operationKey: string) {
  if (operationKey.trim().length < 16 || operationKey.length > 180) throw new Error("A valid purchasing operation ID is required.");
}

export function mapPurchasingError(error: unknown) {
  if (error instanceof InventoryConflictError || error instanceof PurchasingConflictError) return error.message;
  return error instanceof Error ? error.message : "Unable to complete purchasing operation.";
}
