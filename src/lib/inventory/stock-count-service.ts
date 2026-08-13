import { createHash } from "node:crypto";
import {
  Prisma,
  type StockCountCommandType,
  type StockCountType,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { applyInventoryMovement, InventoryConflictError, runInventorySerializable } from "@/lib/inventory/service";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;
type Actor = { email?: string | null; name?: string | null; userId: string };
type CommandContext = { actor: Actor; businessId: string; operationKey: string };

export class StockCountConflictError extends Error {
  readonly code = "STOCK_COUNT_CONFLICT";
}

export class StockCountStaleError extends Error {
  readonly code = "STOCK_COUNT_RECOUNT_REQUIRED";
}

export async function createStockCount(input: CommandContext & {
  branchId: string;
  countType: StockCountType;
  notes?: string | null;
  productIds?: string[];
}) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  const productIds = [...new Set(input.productIds ?? [])].sort();
  const payload = { branchId: input.branchId, countType: input.countType, notes: clean(input.notes), productIds };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CREATE_COUNT", payload);
    if (replay) return getSession(tx, input.businessId, replay);
    const branch = await tx.branch.findUnique({
      where: { id_businessId: { businessId: input.businessId, id: input.branchId } },
      select: { status: true },
    });
    if (!branch || branch.status !== "ACTIVE") throw new Error("Active stock-count branch not found.");
    const products = await tx.product.findMany({
      where: {
        businessId: input.businessId,
        status: "ACTIVE",
        trackInventory: true,
        ...(input.countType === "SELECTED_PRODUCTS" ? { id: { in: productIds } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (!products.length) throw new Error("A stock count requires at least one active inventory-tracked product.");
    if (input.countType === "SELECTED_PRODUCTS" && products.length !== productIds.length) {
      throw new Error("Every selected product must belong to this business and be active inventory.");
    }
    const duplicates = await tx.stockCountLine.findMany({
      where: { active: true, branchId: input.branchId, businessId: input.businessId, productId: { in: products.map((product) => product.id) } },
      select: { productId: true },
    });
    if (duplicates.length) throw new StockCountConflictError("ACTIVE_STOCK_COUNT_ALREADY_EXISTS");
    const sequence = await tx.business.update({
      where: { id: input.businessId },
      data: { stockCountSequence: { increment: 1 } },
      select: { stockCountSequence: true },
    });
    const session = await tx.stockCountSession.create({
      data: {
        branchId: input.branchId,
        businessId: input.businessId,
        countNumber: `SC-${String(sequence.stockCountSequence).padStart(6, "0")}`,
        countType: input.countType,
        createdById: input.actor.userId,
        notes: clean(input.notes),
        lines: { create: products.map((product) => ({ branchId: input.branchId, productId: product.id })) },
      },
    });
    await recordCommand(tx, input, "CREATE_COUNT", payload, session.id, session.id);
    await audit(tx, input, "STOCK_COUNT_CREATED", session.id, `${session.countNumber} created with ${products.length} product(s).`, null, session, input.branchId);
    return getSession(tx, input.businessId, session.id);
  });
}

export async function startStockCount(input: CommandContext & { expectedRevision: number; sessionId: string }) {
  return transition(input, "START_COUNT", "DRAFT", async (tx, session) => {
    const now = new Date();
    const updated = await guardedSessionUpdate(tx, session, input.expectedRevision, {
      revision: { increment: 1 }, status: "IN_PROGRESS", startedAt: now, startedById: input.actor.userId,
    });
    await audit(tx, input, "STOCK_COUNT_STARTED", session.id, `${session.countNumber} started.`, session, updated, session.branchId);
    return updated;
  });
}

export async function recordStockCountLine(input: CommandContext & {
  actualQuantity: number;
  expectedLineRevision: number;
  lineId: string;
  notes?: string | null;
  sessionId: string;
}) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  if (!Number.isInteger(input.actualQuantity) || input.actualQuantity < 0) throw new Error("Actual quantity must be a non-negative whole number.");
  const payload = { actualQuantity: input.actualQuantity, expectedLineRevision: input.expectedLineRevision, lineId: input.lineId, notes: clean(input.notes), sessionId: input.sessionId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "RECORD_LINE", payload);
    if (replay) return tx.stockCountLine.findFirstOrThrow({ where: { businessId: input.businessId, id: replay }, include: { product: true, revisions: { orderBy: { revision: "desc" } } } });
    const line = await tx.stockCountLine.findFirst({
      where: { businessId: input.businessId, id: input.lineId, sessionId: input.sessionId },
      include: { product: true, session: true },
    });
    if (!line) throw new Error("Stock count line not found.");
    if (line.session.status !== "IN_PROGRESS" || !line.active) throw new Error("Only an in-progress count can be edited.");
    if (!line.product.trackInventory) throw new Error("Inventory tracking changed; manager review and recount are required.");
    if (line.revision !== input.expectedLineRevision) throw new StockCountConflictError("REFRESH_REQUIRED");
    const [balance, watermark] = await Promise.all([
      tx.productStock.findUnique({ where: { branchId_productId: { branchId: line.branchId, productId: line.productId } }, select: { quantity: true, revision: true } }),
      tx.inventoryMovement.findFirst({ where: { branchId: line.branchId, businessId: input.businessId, productId: line.productId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true, id: true, quantityAfter: true } }),
    ]);
    const expected = balance?.quantity ?? 0;
    const countedAt = new Date();
    const revision = line.revision + 1;
    const ledgerDigest = fingerprint({ balanceRevision: balance?.revision ?? 0, expected, movementId: watermark?.id ?? null, movementQuantityAfter: watermark?.quantityAfter ?? 0 });
    await tx.stockCountLineRevision.create({ data: {
      actualQuantity: input.actualQuantity, businessId: input.businessId, countedAt, countedById: input.actor.userId,
      expectedQuantityAtCount: expected, ledgerDigest, ledgerWatermarkAtCount: watermark?.createdAt ?? null,
      lineId: line.id, notes: clean(input.notes), productId: line.productId, revision, varianceQuantity: input.actualQuantity - expected,
    } });
    const update = await tx.stockCountLine.updateMany({ where: { businessId: input.businessId, id: line.id, revision: line.revision }, data: {
      actualQuantity: input.actualQuantity, countedAt, countedById: input.actor.userId, expectedQuantityAtCount: expected,
      ledgerDigest, ledgerWatermarkAtCount: watermark?.createdAt ?? null, notes: clean(input.notes), revision,
      varianceQuantity: input.actualQuantity - expected,
    } });
    if (update.count !== 1) throw new StockCountConflictError("REFRESH_REQUIRED");
    await recordCommand(tx, input, "RECORD_LINE", payload, line.id, line.sessionId);
    return tx.stockCountLine.findUniqueOrThrow({ where: { id: line.id }, include: { product: true, revisions: { orderBy: { revision: "desc" } } } });
  });
}

export async function submitStockCount(input: CommandContext & { expectedRevision: number; sessionId: string }) {
  return transition(input, "SUBMIT_COUNT", "IN_PROGRESS", async (tx, session) => {
    if (session.lines.some((line) => line.actualQuantity === null)) throw new Error("Every required product must be counted before submission.");
    const updated = await guardedSessionUpdate(tx, session, input.expectedRevision, { revision: { increment: 1 }, status: "SUBMITTED", submittedAt: new Date(), submittedById: input.actor.userId });
    await audit(tx, input, "STOCK_COUNT_SUBMITTED", session.id, `${session.countNumber} submitted for variance review.`, session, updated, session.branchId);
    return updated;
  });
}

export async function reopenStockCount(input: CommandContext & { expectedRevision: number; reason: string; sessionId: string }) {
  if (input.reason.trim().length < 3) throw new Error("Reopen reason is required.");
  return transition(input, "REOPEN_COUNT", "SUBMITTED", async (tx, session) => {
    const updated = await guardedSessionUpdate(tx, session, input.expectedRevision, { revision: { increment: 1 }, status: "IN_PROGRESS", submittedAt: null, submittedById: null, transitionReason: input.reason.trim() });
    await audit(tx, input, "STOCK_COUNT_REOPENED", session.id, `${session.countNumber} reopened for recount: ${input.reason.trim()}`, session, updated, session.branchId);
    return updated;
  }, input.reason);
}

export async function cancelStockCount(input: CommandContext & { expectedRevision: number; reason: string; sessionId: string }) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  if (input.reason.trim().length < 3) throw new Error("Cancellation reason is required.");
  const payload = { expectedRevision: input.expectedRevision, reason: input.reason.trim(), sessionId: input.sessionId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CANCEL_COUNT", payload);
    if (replay) return getSession(tx, input.businessId, replay);
    const session = await getSession(tx, input.businessId, input.sessionId);
    if (session.status === "APPROVED" || session.status === "CANCELLED") throw new Error("This count cannot be cancelled.");
    const updated = await guardedSessionUpdate(tx, session, input.expectedRevision, { cancelledAt: new Date(), cancelledById: input.actor.userId, revision: { increment: 1 }, status: "CANCELLED", transitionReason: input.reason.trim() });
    await tx.stockCountLine.updateMany({ where: { businessId: input.businessId, sessionId: session.id }, data: { active: false } });
    await recordCommand(tx, input, "CANCEL_COUNT", payload, session.id, session.id);
    await audit(tx, input, "STOCK_COUNT_CANCELLED", session.id, `${session.countNumber} cancelled: ${input.reason.trim()}`, session, updated, session.branchId);
    return getSession(tx, input.businessId, session.id);
  });
}

export async function approveStockCount(input: CommandContext & { expectedRevision: number; reason: string; sessionId: string }) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  if (input.reason.trim().length < 3) throw new Error("Approval reason is required.");
  const payload = { expectedRevision: input.expectedRevision, reason: input.reason.trim(), sessionId: input.sessionId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "APPROVE_COUNT", payload);
    if (replay) return getSession(tx, input.businessId, replay);
    const session = await getSession(tx, input.businessId, input.sessionId);
    if (session.status !== "SUBMITTED") throw new Error("Only a submitted count can be approved.");
    if (session.revision !== input.expectedRevision) throw new StockCountConflictError("REFRESH_REQUIRED");
    if (session.lines.some((line) => line.actualQuantity === null || line.expectedQuantityAtCount === null || line.varianceQuantity === null || !line.countedAt)) throw new Error("Count evidence is incomplete.");
    if (session.lines.some((line) => line.varianceQuantity !== 0 && line.countedById === input.actor.userId)) throw new Error("The counter cannot approve their own variance.");
    const products = await tx.product.findMany({ where: { businessId: input.businessId, id: { in: session.lines.map((line) => line.productId) } }, select: { id: true, trackInventory: true } });
    if (products.length !== session.lines.length || products.some((product) => !product.trackInventory)) throw new StockCountStaleError("Inventory tracking changed; recount or manager review is required.");
    const oldestCount = new Date(Math.min(...session.lines.map((line) => line.countedAt!.getTime())));
    const invalidating = await tx.inventoryMovement.findMany({ where: {
      branchId: session.branchId, businessId: input.businessId, createdAt: { gt: oldestCount },
      productId: { in: session.lines.map((line) => line.productId) }, type: { in: ["ADJUSTMENT_IN", "ADJUSTMENT_OUT", "SYSTEM_CORRECTION"] },
    }, select: { createdAt: true, productId: true, sourceType: true } });
    const stale = session.lines.some((line) => invalidating.some((movement) => movement.productId === line.productId && movement.createdAt > line.countedAt!));
    if (stale) throw new StockCountStaleError("STALE_COUNT_RECOUNT_REQUIRED");
    for (const line of session.lines) {
      const variance = line.varianceQuantity!;
      if (variance === 0) continue;
      await applyInventoryMovement(tx, {
        actorUserId: input.actor.userId, branchId: session.branchId, businessId: input.businessId,
        operationKey: `STOCK_COUNT:${session.id}:${line.id}`, productId: line.productId, quantityDelta: variance,
        reason: input.reason.trim(), reference: session.countNumber, sourceId: session.id, sourceLineId: line.id,
        sourceType: "STOCK_COUNT", type: variance > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
      });
    }
    await tx.stockCountLine.updateMany({ where: { businessId: input.businessId, sessionId: session.id }, data: { active: false } });
    const updated = await guardedSessionUpdate(tx, session, input.expectedRevision, { approvedAt: new Date(), approvedById: input.actor.userId, revision: { increment: 1 }, status: "APPROVED", transitionReason: input.reason.trim() });
    await recordCommand(tx, input, "APPROVE_COUNT", payload, session.id, session.id);
    await audit(tx, input, "STOCK_COUNT_APPROVED", session.id, `${session.countNumber} approved; variance deltas posted to the inventory ledger.`, session, updated, session.branchId);
    await audit(tx, input, "STOCK_COUNT_VARIANCE_APPLIED", session.id, `${session.lines.filter((line) => line.varianceQuantity !== 0).length} variance movement(s) applied.`, null, { countNumber: session.countNumber }, session.branchId);
    return getSession(tx, input.businessId, session.id);
  });
}

export async function setReorderSettings(input: CommandContext & {
  branchId: string;
  expectedRevision?: number;
  productId: string;
  reorderLevel: number;
  targetStockLevel: number | null;
}) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  if (!Number.isInteger(input.reorderLevel) || input.reorderLevel < 0) throw new Error("Reorder level must be a non-negative whole number.");
  if (input.targetStockLevel !== null && (!Number.isInteger(input.targetStockLevel) || input.targetStockLevel < 0)) throw new Error("Target stock must be a non-negative whole number or blank.");
  const payload = { branchId: input.branchId, expectedRevision: input.expectedRevision ?? null, productId: input.productId, reorderLevel: input.reorderLevel, targetStockLevel: input.targetStockLevel };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "SET_REORDER_SETTINGS", payload);
    if (replay) return tx.productStock.findFirstOrThrow({ where: { businessId: input.businessId, id: replay } });
    const [branch, product, existing] = await Promise.all([
      tx.branch.findUnique({ where: { id_businessId: { businessId: input.businessId, id: input.branchId } }, select: { status: true } }),
      tx.product.findUnique({ where: { id_businessId: { businessId: input.businessId, id: input.productId } }, select: { status: true, trackInventory: true } }),
      tx.productStock.findUnique({ where: { branchId_productId: { branchId: input.branchId, productId: input.productId } } }),
    ]);
    if (!branch || branch.status !== "ACTIVE" || !product || product.status !== "ACTIVE" || !product.trackInventory) throw new Error("Active branch inventory product not found.");
    if (existing && input.expectedRevision !== undefined && existing.revision !== input.expectedRevision) throw new StockCountConflictError("REFRESH_REQUIRED");
    const stock = existing
      ? await tx.productStock.update({ where: { id: existing.id }, data: { reorderLevel: input.reorderLevel, targetStockLevel: input.targetStockLevel, revision: { increment: 1 } } })
      : await tx.productStock.create({ data: { branchId: input.branchId, businessId: input.businessId, productId: input.productId, reorderLevel: input.reorderLevel, targetStockLevel: input.targetStockLevel } });
    await recordCommand(tx, input, "SET_REORDER_SETTINGS", payload, stock.id, null);
    await audit(tx, input, "REORDER_SETTINGS_CHANGED", stock.id, "Branch reorder and target stock settings changed.", existing, stock, input.branchId);
    return stock;
  });
}

export async function getReorderView(input: { branchIds: string[]; businessId: string; page?: number; pageSize?: number; query?: string }) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const query = input.query?.trim() ?? "";
  const [branches, products, stocks, openLines] = await Promise.all([
    prisma.branch.findMany({ where: { businessId: input.businessId, id: { in: input.branchIds }, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { businessId: input.businessId, status: "ACTIVE", trackInventory: true, ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { sku: { contains: query, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, sku: true }, orderBy: { name: "asc" } }),
    prisma.productStock.findMany({ where: { businessId: input.businessId, branchId: { in: input.branchIds } } }),
    prisma.purchaseOrderLine.findMany({ where: { businessId: input.businessId, purchaseOrder: { branchId: { in: input.branchIds }, status: { in: ["APPROVED", "PARTIALLY_RECEIVED"] } } }, select: { orderedQuantity: true, productId: true, receivedQuantity: true, purchaseOrder: { select: { branchId: true } } } }),
  ]);
  const stockByKey = new Map(stocks.map((stock) => [`${stock.branchId}:${stock.productId}`, stock]));
  const onOrder = new Map<string, number>();
  for (const line of openLines) {
    const key = `${line.purchaseOrder.branchId}:${line.productId}`;
    onOrder.set(key, (onOrder.get(key) ?? 0) + Math.max(0, line.orderedQuantity - line.receivedQuantity));
  }
  const allRows = branches.flatMap((branch) => products.map((product) => {
    const key = `${branch.id}:${product.id}`;
    const stock = stockByKey.get(key);
    const onHand = stock?.quantity ?? 0;
    const onOrderQuantity = onOrder.get(key) ?? 0;
    const projectedStock = onHand + onOrderQuantity;
    const targetStockLevel = stock?.targetStockLevel ?? null;
    return {
      branchId: branch.id, branchName: branch.name, onHand, onOrderQuantity, productId: product.id, productName: product.name,
      projectedStock, reorderLevel: stock?.reorderLevel ?? 0, revision: stock?.revision ?? 0, sku: product.sku,
      suggestedQuantity: targetStockLevel === null ? null : Math.max(0, targetStockLevel - projectedStock), targetStockLevel,
    };
  }));
  const start = (page - 1) * pageSize;
  return { page, pageSize, rows: allRows.slice(start, start + pageSize), total: allRows.length };
}

async function transition(input: CommandContext & { expectedRevision: number; sessionId: string }, commandType: Extract<StockCountCommandType, "START_COUNT" | "SUBMIT_COUNT" | "REOPEN_COUNT">, expectedStatus: "DRAFT" | "IN_PROGRESS" | "SUBMITTED", work: (tx: Tx, session: Awaited<ReturnType<typeof getSession>>) => Promise<Awaited<ReturnType<typeof getSession>>>, reason?: string) {
  await requireInventory(input.businessId);
  validateOperation(input.operationKey);
  const payload = { expectedRevision: input.expectedRevision, reason: reason ?? null, sessionId: input.sessionId };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, commandType, payload);
    if (replay) return getSession(tx, input.businessId, replay);
    const session = await getSession(tx, input.businessId, input.sessionId);
    if (session.status !== expectedStatus) throw new Error(`Stock count must be ${expectedStatus.toLowerCase().replaceAll("_", " ")}.`);
    const result = await work(tx, session);
    await recordCommand(tx, input, commandType, payload, session.id, session.id);
    return result;
  });
}

async function guardedSessionUpdate(tx: Tx, session: Awaited<ReturnType<typeof getSession>>, expectedRevision: number, data: Prisma.StockCountSessionUncheckedUpdateManyInput) {
  if (session.revision !== expectedRevision) throw new StockCountConflictError("REFRESH_REQUIRED");
  const updated = await tx.stockCountSession.updateMany({ where: { businessId: session.businessId, id: session.id, revision: expectedRevision, status: session.status }, data });
  if (updated.count !== 1) throw new StockCountConflictError("REFRESH_REQUIRED");
  return getSession(tx, session.businessId, session.id);
}

async function getSession(tx: Tx, businessId: string, id: string) {
  return tx.stockCountSession.findFirstOrThrow({ where: { businessId, id }, include: {
    approvedBy: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } },
    lines: { include: { countedBy: { select: { id: true, name: true } }, product: { select: { id: true, name: true, sku: true, status: true, trackInventory: true } }, revisions: { orderBy: { revision: "desc" } } }, orderBy: { product: { name: "asc" } } },
  } });
}

async function commandReplay(tx: Tx, context: CommandContext, commandType: StockCountCommandType, payload: unknown) {
  const existing = await tx.stockCountCommand.findUnique({ where: { businessId_operationKey: { businessId: context.businessId, operationKey: context.operationKey } } });
  if (!existing) return null;
  if (existing.commandType !== commandType || existing.requestFingerprint !== fingerprint(payload)) throw new StockCountConflictError("Stock-count operation ID was reused with different details.");
  return existing.resultEntityId;
}

async function recordCommand(tx: Tx, context: CommandContext, commandType: StockCountCommandType, payload: unknown, resultEntityId: string, sessionId: string | null) {
  await tx.stockCountCommand.create({ data: { actorUserId: context.actor.userId, businessId: context.businessId, commandType, operationKey: context.operationKey, requestFingerprint: fingerprint(payload), resultEntityId, resultEntityType: commandType === "RECORD_LINE" ? "STOCK_COUNT_LINE" : commandType === "SET_REORDER_SETTINGS" ? "PRODUCT_STOCK" : "STOCK_COUNT_SESSION", sessionId } });
}

async function audit(tx: Tx, context: CommandContext, action: string, entityId: string, summary: string, before: unknown, after: unknown, branchId: string) {
  await writeAuditLog({ action, actor: { email: context.actor.email ?? "", name: context.actor.name ?? "System", userId: context.actor.userId }, after, before, branchId, businessId: context.businessId, entityId, entityType: "StockCount", summary }, tx);
}

async function requireInventory(businessId: string) {
  if (!(await isBusinessModuleEnabled(businessId, "INVENTORY"))) throw new Error("Inventory is not enabled for this business.");
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)]));
  return value;
}

function validateOperation(operationKey: string) {
  if (operationKey.trim().length < 16 || operationKey.length > 180) throw new Error("A valid stock-count operation ID is required.");
}

function clean(value?: string | null) {
  return value?.trim() || null;
}

export function mapStockCountError(error: unknown) {
  if (error instanceof StockCountConflictError || error instanceof StockCountStaleError || error instanceof InventoryConflictError) return error.message;
  return error instanceof Error ? error.message : "Unable to complete stock-count operation.";
}
