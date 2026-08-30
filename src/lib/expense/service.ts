import { createHash } from "node:crypto";
import {
  ExpenseCategoryGroup,
  ExpenseCommandType,
  ExpensePaymentMethod,
  ExpensePaymentSource,
  ExpenseSourceType,
  ExpenseStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { assertClaimAttachmentCanBeReleased, validateClaimAttachment } from "@/lib/claim/attachment-policy";
import {
  getClaimPrivateAttachmentStore,
  type ClaimPrivateAttachmentStore,
} from "@/lib/claim/private-attachment-storage";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION, ANALYTICS_METRIC_DEFINITION_VERSION } from "@/lib/analytics/constants";
import { assertCashierShiftAcceptsActivity } from "@/lib/closing/shift-control";

export type ExpenseActor = Readonly<{ userId: string; name: string; email: string }>;
export type ExpenseReceiptInput = Readonly<{
  bytes: Uint8Array;
  claimedMimeType: string;
  originalFileName: string;
}>;

const starterCategories = [
  ["Rental", "RENTAL"],
  ["Utilities", "OPERATIONS"],
  ["Marketing", "MARKETING"],
  ["Repairs & Maintenance", "OPERATIONS"],
  ["Office Supplies", "OPERATIONS"],
  ["Technology & Software", "OPERATIONS"],
  ["Transport", "OPERATIONS"],
  ["Professional Fees", "FINANCE"],
  ["Bank Fees", "FINANCE"],
  ["Insurance", "FINANCE"],
  ["Training", "STAFF"],
  ["Staff Welfare", "STAFF"],
  ["Employee Claims", "STAFF"],
  ["Payroll & Employee Cost", "STAFF"],
  ["Inventory Purchases", "OPERATIONS"],
  ["Other", "OTHER"],
] as const satisfies readonly (readonly [string, ExpenseCategoryGroup])[];

const mutationIsolation = Prisma.TransactionIsolationLevel.Serializable;

export class ExpenseDomainError extends Error {
  constructor(message: string, readonly code = "EXPENSE_INVALID") {
    super(message);
    this.name = "ExpenseDomainError";
  }
}

export async function ensureStarterExpenseCategories(
  businessId: string,
  database: PrismaClient = prisma,
) {
  await database.expenseCategory.createMany({
    data: starterCategories.map(([name, group], index) => ({
      businessId,
      code: starterCode(name),
      group,
      name,
      sortOrder: (index + 1) * 10,
    })),
    skipDuplicates: true,
  });
}

export async function createExpenseCategory(input: {
  actor: ExpenseActor;
  businessId: string;
  code?: string | null;
  description?: string | null;
  group: ExpenseCategoryGroup;
  name: string;
  operationKey: string;
  requiresReceipt?: boolean;
  sortOrder?: number;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  const data = {
    code: optionalText(input.code, 40)?.toUpperCase() ?? null,
    description: optionalText(input.description, 500),
    group: input.group,
    name: requiredText(input.name, 120, "Category name"),
    requiresReceipt: Boolean(input.requiresReceipt),
    sortOrder: integer(input.sortOrder ?? 0, 0, 100_000, "Sort order"),
  };
  const fingerprint = hash({ command: "CREATE_CATEGORY", ...data });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "CREATE_CATEGORY", fingerprint);
    if (replay) return tx.expenseCategory.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const category = await tx.expenseCategory.create({ data: { businessId: input.businessId, ...data } });
    await recordCommand(tx, input, "CREATE_CATEGORY", fingerprint, "ExpenseCategory", category.id);
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, action: "EXPENSE_CATEGORY_CREATED", entityType: "ExpenseCategory", entityId: category.id, summary: "Expense category created.", after: { name: category.name, group: category.group, requiresReceipt: category.requiresReceipt }, request: input.request }, tx);
    return category;
  }, { isolationLevel: mutationIsolation });
}

export async function updateExpenseCategory(input: {
  active: boolean;
  actor: ExpenseActor;
  businessId: string;
  categoryId: string;
  code?: string | null;
  description?: string | null;
  group: ExpenseCategoryGroup;
  name: string;
  operationKey: string;
  requiresReceipt: boolean;
  sortOrder: number;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  const data = {
    active: input.active,
    code: optionalText(input.code, 40)?.toUpperCase() ?? null,
    description: optionalText(input.description, 500),
    group: input.group,
    name: requiredText(input.name, 120, "Category name"),
    requiresReceipt: input.requiresReceipt,
    sortOrder: integer(input.sortOrder, 0, 100_000, "Sort order"),
  };
  const fingerprint = hash({ command: "UPDATE_CATEGORY", categoryId: input.categoryId, ...data });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "UPDATE_CATEGORY", fingerprint);
    if (replay) return tx.expenseCategory.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const before = await tx.expenseCategory.findFirst({ where: { businessId: input.businessId, id: input.categoryId } });
    if (!before) throw new ExpenseDomainError("Expense category was not found in this business.", "EXPENSE_CATEGORY_NOT_FOUND");
    const category = await tx.expenseCategory.update({ where: { id: before.id }, data });
    await recordCommand(tx, input, "UPDATE_CATEGORY", fingerprint, "ExpenseCategory", category.id);
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, action: category.active ? "EXPENSE_CATEGORY_UPDATED" : "EXPENSE_CATEGORY_DEACTIVATED", entityType: "ExpenseCategory", entityId: category.id, summary: category.active ? "Expense category updated." : "Expense category deactivated.", before: { active: before.active, group: before.group, name: before.name, requiresReceipt: before.requiresReceipt }, after: { active: category.active, group: category.group, name: category.name, requiresReceipt: category.requiresReceipt }, request: input.request }, tx);
    return category;
  }, { isolationLevel: mutationIsolation });
}

export async function reorderExpenseCategories(input: {
  actor: ExpenseActor;
  businessId: string;
  expectedOrderIds: string[];
  operationKey: string;
  orderIds: string[];
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  const orderIds = [...input.orderIds];
  const expectedOrderIds = [...input.expectedOrderIds];
  if (orderIds.length === 0 || orderIds.length > 500 || new Set(orderIds).size !== orderIds.length) throw new ExpenseDomainError("Category order is invalid.", "EXPENSE_CATEGORY_ORDER_INVALID");
  if (expectedOrderIds.length !== orderIds.length || new Set(expectedOrderIds).size !== expectedOrderIds.length) throw new ExpenseDomainError("Category order is stale. Refresh and try again.", "EXPENSE_CATEGORY_ORDER_STALE");
  const fingerprint = hash({ command: "REORDER_CATEGORIES", expectedOrderIds, orderIds });

  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "UPDATE_CATEGORY", fingerprint);
    if (replay) return { changed: false };
    const current = await tx.expenseCategory.findMany({ where: { businessId: input.businessId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } });
    const currentIds = current.map((category) => category.id);
    if (currentIds.length !== orderIds.length || currentIds.some((id, index) => id !== expectedOrderIds[index])) throw new ExpenseDomainError("Categories changed while you were arranging them. Refresh and try again.", "EXPENSE_CATEGORY_ORDER_STALE");
    const currentIdSet = new Set(currentIds);
    if (orderIds.some((id) => !currentIdSet.has(id))) throw new ExpenseDomainError("Category order contains a category outside this business.", "EXPENSE_CATEGORY_ORDER_SCOPE_INVALID");

    for (const [index, id] of orderIds.entries()) {
      await tx.expenseCategory.update({ where: { id }, data: { sortOrder: (index + 1) * 10 } });
    }

    const nameById = new Map(current.map((category) => [category.id, category.name]));
    await recordCommand(tx, input, "UPDATE_CATEGORY", fingerprint, "ExpenseCategoryOrder", orderIds[0]);
    await writeAuditLog({ businessId: input.businessId, actor: input.actor, action: "EXPENSE_CATEGORIES_REORDERED", entityType: "ExpenseCategoryOrder", entityId: input.businessId, summary: "Expense categories reordered.", before: { order: currentIds.map((id) => nameById.get(id) ?? id) }, after: { order: orderIds.map((id) => nameById.get(id) ?? id) }, request: input.request }, tx);
    return { changed: true };
  }, { isolationLevel: mutationIsolation });
}

type ExpenseFactsInput = {
  amount: string | number | Prisma.Decimal;
  branchId?: string | null;
  categoryId: string;
  description: string;
  expenseDate: string | Date;
  notes?: string | null;
  payeeName?: string | null;
};

export async function createBusinessExpense(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  desiredStatus?: "DRAFT" | "CONFIRMED";
  operationKey: string;
  paymentDate?: string | Date | null;
  paymentMethod?: ExpensePaymentMethod | null;
  paymentSource?: ExpensePaymentSource | null;
  cashierShiftId?: string | null;
  paymentReference?: string | null;
  paymentStatus?: "UNPAID" | "PAID";
  receipt?: ExpenseReceiptInput | null;
  documentScanId?: string | null;
  duplicateOverride?: boolean;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma, store?: ClaimPrivateAttachmentStore) {
  return createExpenseWithSource({ ...input, sourceType: "MANUAL", sourceId: null, sourceRevision: null }, database, store);
}

export async function materializeSourceExpense(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  operationKey: string;
  sourceId: string;
  sourceRevision: string;
  sourceType: Exclude<ExpenseSourceType, "MANUAL">;
  paymentDate?: string | Date | null;
  paymentMethod?: ExpensePaymentMethod | null;
  paymentSource?: ExpensePaymentSource | null;
  cashierShiftId?: string | null;
  paymentReference?: string | null;
  paymentStatus?: "UNPAID" | "PAID";
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  return createExpenseWithSource({ ...input, desiredStatus: "CONFIRMED", paymentStatus: input.paymentStatus ?? "UNPAID", sourceId: requiredText(input.sourceId, 180, "Source ID"), sourceRevision: requiredText(input.sourceRevision, 100, "Source revision") }, database);
}

async function createExpenseWithSource(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  desiredStatus?: "DRAFT" | "CONFIRMED";
  operationKey: string;
  paymentDate?: string | Date | null;
  paymentMethod?: ExpensePaymentMethod | null;
  paymentSource?: ExpensePaymentSource | null;
  cashierShiftId?: string | null;
  paymentReference?: string | null;
  paymentStatus?: "UNPAID" | "PAID";
  receipt?: ExpenseReceiptInput | null;
  documentScanId?: string | null;
  duplicateOverride?: boolean;
  request?: AuditRequestContext;
  sourceId: string | null;
  sourceRevision: string | null;
  sourceType: ExpenseSourceType;
  recurringTemplateId?: string | null;
  generatedPeriod?: string | null;
}, database: PrismaClient, store?: ClaimPrivateAttachmentStore) {
  const facts = normalizeFacts(input);
  const desiredStatus = input.desiredStatus ?? "DRAFT";
  const paymentStatus = input.paymentStatus ?? "UNPAID";
  if (paymentStatus === "PAID" && desiredStatus !== "CONFIRMED") throw new ExpenseDomainError("Paid expenses must be confirmed.", "PAID_EXPENSE_MUST_BE_CONFIRMED");
  const payment = normalizePayment(paymentStatus, input);
  if (input.receipt && input.documentScanId) throw new ExpenseDomainError("Use either the scanned private document or a new receipt upload, not both.", "EXPENSE_RECEIPT_SOURCE_CONFLICT");
  const validatedReceipt = input.receipt ? validateClaimAttachment({ bytes: input.receipt.bytes, claimedMimeType: input.receipt.claimedMimeType, originalFileName: input.receipt.originalFileName }) : null;
  const fingerprint = hash({ command: "CREATE_EXPENSE", ...facts.fingerprint, desiredStatus, payment, sourceType: input.sourceType, sourceId: input.sourceId, sourceRevision: input.sourceRevision, receiptChecksum: validatedReceipt?.checksumSha256 ?? null, documentScanId: input.documentScanId ?? null, duplicateOverride: Boolean(input.duplicateOverride) });

  const existing = await database.expenseCommand.findUnique({ where: { businessId_operationKey: { businessId: input.businessId, operationKey: operationKey(input.operationKey) } } });
  if (existing) {
    assertReplay(existing, "CREATE_EXPENSE", fingerprint);
    return database.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: existing.resultEntityId }, include: { attachments: true } });
  }

  const receiptStore = validatedReceipt ? store ?? getClaimPrivateAttachmentStore() : null;
  const stored = validatedReceipt ? await receiptStore!.putQuarantined(validatedReceipt) : null;
  try {
    return await database.$transaction(async (tx) => {
      const replay = await replayCommand(tx, input.businessId, input.operationKey, "CREATE_EXPENSE", fingerprint);
      if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId }, include: { attachments: true } });
      const [category, branch, documentScan] = await Promise.all([
        tx.expenseCategory.findFirst({ where: { active: true, businessId: input.businessId, id: facts.categoryId } }),
        facts.branchId ? tx.branch.findFirst({ where: { businessId: input.businessId, id: facts.branchId, status: "ACTIVE" } }) : null,
        input.documentScanId ? tx.expenseDocumentScan.findFirst({ where: { id: input.documentScanId, businessId: input.businessId, createdById: input.actor.userId } }) : null,
      ]);
      if (!category) throw new ExpenseDomainError("An active expense category is required.", "EXPENSE_CATEGORY_INACTIVE");
      if (facts.branchId && !branch) throw new ExpenseDomainError("Expense branch is outside this business.", "EXPENSE_BRANCH_INVALID");
      if (input.documentScanId && !documentScan) throw new ExpenseDomainError("The private document scan was not found in this business or user scope.", "EXPENSE_DOCUMENT_SCAN_NOT_FOUND");
      if (documentScan) {
        if (documentScan.expenseId || documentScan.consumedAt) throw new ExpenseDomainError("This private document scan has already been used.", "EXPENSE_DOCUMENT_SCAN_ALREADY_USED");
        if (documentScan.expiresAt <= new Date()) throw new ExpenseDomainError("This private document scan expired. Scan the receipt again.", "EXPENSE_DOCUMENT_SCAN_EXPIRED");
        if (documentScan.branchId !== null && documentScan.branchId !== facts.branchId) throw new ExpenseDomainError("The scanned document belongs to a different branch scope.", "EXPENSE_DOCUMENT_SCAN_BRANCH_MISMATCH");
        if (!["EXPENSE_RECEIPT", "UNKNOWN"].includes(documentScan.documentType)) throw new ExpenseDomainError(documentScan.documentType === "SUPPLIER_INVOICE" ? "This document belongs in Supplier Bills, not manual Expenses." : "This document belongs in employee Claims, not manual Expenses.", "EXPENSE_DOCUMENT_WRONG_WORKFLOW");
        const duplicates = Array.isArray(documentScan.duplicateCandidates) ? documentScan.duplicateCandidates : [];
        if (duplicates.length > 0 && !input.duplicateOverride) throw new ExpenseDomainError("Review the possible duplicate and explicitly choose Continue anyway.", "EXPENSE_DUPLICATE_REVIEW_REQUIRED");
      }
      if (desiredStatus === "CONFIRMED" && category.requiresReceipt && !stored && !documentScan && input.sourceType === "MANUAL") throw new ExpenseDomainError("This category requires a receipt before confirmation.", "EXPENSE_RECEIPT_REQUIRED");
      if (input.sourceType !== "MANUAL" && (!input.sourceId || !input.sourceRevision)) throw new ExpenseDomainError("System-sourced expenses require stable source identity.", "EXPENSE_SOURCE_IDENTITY_REQUIRED");
      if (input.sourceType === "MANUAL" && (input.sourceId || input.sourceRevision)) throw new ExpenseDomainError("Manual expenses cannot claim a system source identity.", "MANUAL_SOURCE_IDENTITY_INVALID");

      const sequence = await tx.business.update({ where: { id: input.businessId }, data: { expenseSequence: { increment: 1 } }, select: { expenseSequence: true } });
      const now = new Date();
      const expense = await tx.businessExpense.create({
        data: {
          amount: facts.amount,
          branchId: facts.branchId,
          branchNameSnapshot: branch?.name ?? null,
          businessId: input.businessId,
          categoryId: category.id,
          categoryNameSnapshot: category.name,
          confirmedAt: desiredStatus === "CONFIRMED" ? now : null,
          confirmedById: desiredStatus === "CONFIRMED" ? input.actor.userId : null,
          createdById: input.actor.userId,
          currency: "MYR",
          description: facts.description,
          expenseDate: facts.expenseDate,
          expenseNumber: `EXP-${String(sequence.expenseSequence).padStart(6, "0")}`,
          generatedPeriod: input.generatedPeriod ?? null,
          notes: facts.notes,
          paidAt: paymentStatus === "PAID" ? now : null,
          paidById: paymentStatus === "PAID" ? input.actor.userId : null,
          payeeName: facts.payeeName,
          paymentDate: payment.paymentDate,
          paymentMethod: payment.paymentMethod,
          paymentReference: payment.paymentReference,
          paymentStatus,
          receiptRequiredSnapshot: category.requiresReceipt,
          recurringTemplateId: input.recurringTemplateId ?? null,
          sourceId: input.sourceId,
          sourceRevision: input.sourceRevision,
          sourceType: input.sourceType,
          status: desiredStatus,
          revision: 0,
        },
      });
      if (stored) await tx.businessExpenseAttachment.create({ data: { businessId: input.businessId, expenseId: expense.id, uploadedById: input.actor.userId, objectKey: stored.objectKey, sanitizedFileName: stored.sanitizedFileName, mimeType: stored.mimeType, byteLength: stored.byteLength, checksumSha256: stored.checksumSha256, malwareStatus: validatedReceipt!.malwareStatus, privacyMetadataStatus: validatedReceipt!.privacyMetadataStatus, quarantineDisposition: stored.disposition } });
      if (documentScan) {
        await tx.businessExpenseAttachment.create({ data: { businessId: input.businessId, expenseId: expense.id, uploadedById: input.actor.userId, objectKey: documentScan.objectKey, sanitizedFileName: documentScan.sanitizedFileName, mimeType: documentScan.mimeType, byteLength: documentScan.byteLength, checksumSha256: documentScan.checksumSha256, malwareStatus: documentScan.malwareStatus, privacyMetadataStatus: documentScan.privacyMetadataStatus, quarantineDisposition: documentScan.quarantineDisposition } });
        await tx.expenseDocumentScan.update({ where: { id: documentScan.id }, data: { expenseId: expense.id, consumedAt: now } });
      }
      if (paymentStatus === "PAID") {
        const paymentEvent = await tx.businessExpensePaymentEvent.create({ data: { amount: expense.amount, businessId: input.businessId, expenseId: expense.id, paymentStatus: "PAID", paymentMethod: payment.paymentMethod!, paymentSource: payment.paymentSource!, paymentDate: payment.paymentDate!, paymentReference: payment.paymentReference, actorUserId: input.actor.userId } });
        await recordExpenseDrawerPayout(tx, {
          actorUserId: input.actor.userId,
          amount: expense.amount,
          branchId: expense.branchId,
          businessId: input.businessId,
          cashierShiftId: payment.cashierShiftId,
          paymentEventId: paymentEvent.id,
          paymentMethod: payment.paymentMethod!,
          paymentSource: payment.paymentSource!,
        });
      }
      await createRevision(tx, expense, input.actor.userId, desiredStatus === "CONFIRMED" ? "CREATED_CONFIRMED" : "CREATED_DRAFT", null);
      await recordCommand(tx, input, "CREATE_EXPENSE", fingerprint, "BusinessExpense", expense.id);
      await writeAuditLog({ businessId: input.businessId, branchId: facts.branchId, actor: input.actor, action: input.sourceType === "CLAIM" ? "EXPENSE_SOURCE_MATERIALIZED_FROM_CLAIM" : input.sourceType === "PAYROLL" ? "EXPENSE_SOURCE_MATERIALIZED_FROM_PAYROLL" : "EXPENSE_CREATED", entityType: "BusinessExpense", entityId: expense.id, summary: `${expense.expenseNumber} created as ${desiredStatus.toLowerCase()}.`, after: auditExpense(expense, Boolean(stored || documentScan)), metadata: documentScan ? { documentScanId: documentScan.id, humanReviewed: true, automaticConfirmation: false, duplicateOverride: Boolean(input.duplicateOverride) } : undefined, request: input.request }, tx);
      return tx.businessExpense.findUniqueOrThrow({ where: { id: expense.id }, include: { attachments: true } });
    }, { isolationLevel: mutationIsolation });
  } catch (error) {
    if (stored) await receiptStore!.deleteQuarantined(stored.objectKey).catch(() => undefined);
    if (isUniqueViolation(error) && input.sourceType !== "MANUAL") throw new ExpenseDomainError("This canonical source revision already has an Expense representation.", "EXPENSE_SOURCE_ALREADY_MATERIALIZED");
    throw error;
  }
}

export async function updateDraftBusinessExpense(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  expenseId: string;
  expectedRevision: number;
  operationKey: string;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  return reviseExpenseFacts({ ...input, commandType: "UPDATE_DRAFT", requiredStatus: "DRAFT", reason: null }, database);
}

export async function correctConfirmedBusinessExpense(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  expenseId: string;
  expectedRevision: number;
  operationKey: string;
  reason: string;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  return reviseExpenseFacts({ ...input, commandType: "CORRECT_EXPENSE", requiredStatus: "CONFIRMED", reason: requiredText(input.reason, 500, "Correction reason") }, database);
}

async function reviseExpenseFacts(input: ExpenseFactsInput & {
  actor: ExpenseActor;
  businessId: string;
  commandType: "UPDATE_DRAFT" | "CORRECT_EXPENSE";
  expenseId: string;
  expectedRevision: number;
  operationKey: string;
  reason: string | null;
  requiredStatus: "DRAFT" | "CONFIRMED";
  request?: AuditRequestContext;
}, database: PrismaClient) {
  const facts = normalizeFacts(input);
  const fingerprint = hash({ command: input.commandType, expenseId: input.expenseId, expectedRevision: input.expectedRevision, reason: input.reason, ...facts.fingerprint });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, input.commandType, fingerprint);
    if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const expense = await tx.businessExpense.findFirst({ where: { businessId: input.businessId, id: input.expenseId }, include: { attachments: { select: { id: true } } } });
    if (!expense) throw new ExpenseDomainError("Expense was not found in this business.", "EXPENSE_NOT_FOUND");
    if (expense.status !== input.requiredStatus) throw new ExpenseDomainError(`Only ${input.requiredStatus.toLowerCase()} expenses can use this action.`, "EXPENSE_STATUS_INVALID");
    if (expense.sourceType !== "MANUAL") throw new ExpenseDomainError("System-sourced expenses must be corrected in their source domain.", "SYSTEM_SOURCE_EDIT_DENIED");
    if (expense.paymentStatus !== "UNPAID" && input.commandType === "CORRECT_EXPENSE") throw new ExpenseDomainError("Expenses with recorded payments require a separate reviewed correction workflow.", "PAID_EXPENSE_CORRECTION_REQUIRES_REVIEW");
    if (expense.revision !== input.expectedRevision) throw stale();
    const [category, branch] = await Promise.all([
      tx.expenseCategory.findFirst({ where: { active: true, businessId: input.businessId, id: facts.categoryId } }),
      facts.branchId ? tx.branch.findFirst({ where: { businessId: input.businessId, id: facts.branchId, status: "ACTIVE" } }) : null,
    ]);
    if (!category) throw new ExpenseDomainError("An active expense category is required.", "EXPENSE_CATEGORY_INACTIVE");
    if (facts.branchId && !branch) throw new ExpenseDomainError("Expense branch is outside this business.", "EXPENSE_BRANCH_INVALID");
    if (input.requiredStatus === "CONFIRMED" && category.requiresReceipt && !expense.attachments.length) throw new ExpenseDomainError("This category requires a receipt.", "EXPENSE_RECEIPT_REQUIRED");
    const updated = await tx.businessExpense.updateMany({ where: { id: expense.id, revision: input.expectedRevision, status: input.requiredStatus }, data: { amount: facts.amount, branchId: facts.branchId, branchNameSnapshot: branch?.name ?? null, categoryId: category.id, categoryNameSnapshot: category.name, description: facts.description, expenseDate: facts.expenseDate, notes: facts.notes, payeeName: facts.payeeName, receiptRequiredSnapshot: category.requiresReceipt, revision: { increment: 1 } } });
    if (updated.count !== 1) throw stale();
    const current = await tx.businessExpense.findUniqueOrThrow({ where: { id: expense.id } });
    await createRevision(tx, current, input.actor.userId, input.commandType, input.reason);
    await recordCommand(tx, input, input.commandType, fingerprint, "BusinessExpense", current.id);
    await writeAuditLog({ businessId: input.businessId, branchId: current.branchId, actor: input.actor, action: input.commandType === "CORRECT_EXPENSE" ? "EXPENSE_CORRECTED" : "EXPENSE_DRAFT_UPDATED", entityType: "BusinessExpense", entityId: current.id, summary: input.commandType === "CORRECT_EXPENSE" ? "Confirmed Expense corrected with immutable revision history." : "Draft Expense updated.", before: auditExpense(expense, expense.attachments.length > 0), after: auditExpense(current, expense.attachments.length > 0), metadata: { reason: input.reason }, request: input.request }, tx);
    return current;
  }, { isolationLevel: mutationIsolation });
}

export async function confirmBusinessExpense(input: TransitionInput, database: PrismaClient = prisma) {
  const fingerprint = hash({ command: "CONFIRM_EXPENSE", expenseId: input.expenseId, expectedRevision: input.expectedRevision });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "CONFIRM_EXPENSE", fingerprint);
    if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const expense = await tx.businessExpense.findFirst({ where: { businessId: input.businessId, id: input.expenseId }, include: { attachments: { select: { id: true } } } });
    if (!expense) throw new ExpenseDomainError("Expense was not found in this business.", "EXPENSE_NOT_FOUND");
    if (expense.status !== "DRAFT") throw new ExpenseDomainError("Only draft expenses can be confirmed.", "EXPENSE_STATUS_INVALID");
    if (expense.revision !== input.expectedRevision) throw stale();
    if (expense.receiptRequiredSnapshot && !expense.attachments.length) throw new ExpenseDomainError("This category requires a receipt before confirmation.", "EXPENSE_RECEIPT_REQUIRED");
    const updated = await tx.businessExpense.updateMany({ where: { id: expense.id, revision: input.expectedRevision, status: "DRAFT" }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: input.actor.userId, revision: { increment: 1 } } });
    if (updated.count !== 1) throw stale();
    const current = await tx.businessExpense.findUniqueOrThrow({ where: { id: expense.id } });
    await createRevision(tx, current, input.actor.userId, "CONFIRMED", null);
    await recordCommand(tx, input, "CONFIRM_EXPENSE", fingerprint, "BusinessExpense", current.id);
    await writeAuditLog({ businessId: input.businessId, branchId: current.branchId, actor: input.actor, action: "EXPENSE_CONFIRMED", entityType: "BusinessExpense", entityId: current.id, summary: `${current.expenseNumber} confirmed.`, after: auditExpense(current, expense.attachments.length > 0), request: input.request }, tx);
    return current;
  }, { isolationLevel: mutationIsolation });
}

export async function markBusinessExpensePaid(input: TransitionInput & {
  allowSystemSource?: boolean;
  amount?: string | number | Prisma.Decimal;
  paymentDate: string | Date;
  paymentMethod: ExpensePaymentMethod;
  paymentSource?: ExpensePaymentSource | null;
  cashierShiftId?: string | null;
  paymentReference?: string | null;
}, database: PrismaClient = prisma) {
  const payment = normalizePayment("PAID", input);
  const requestedAmount = input.amount === undefined ? null : money(input.amount);
  const fingerprint = hash({ command: "MARK_PAID", expenseId: input.expenseId, expectedRevision: input.expectedRevision, payment, requestedAmount: requestedAmount?.toFixed(2) ?? null });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "MARK_PAID", fingerprint);
    if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const expense = await tx.businessExpense.findFirst({ where: { businessId: input.businessId, id: input.expenseId }, include: { paymentEvents: { select: { amount: true } } } });
    if (!expense) throw new ExpenseDomainError("Expense was not found in this business.", "EXPENSE_NOT_FOUND");
    if (expense.sourceType !== "MANUAL" && !input.allowSystemSource) throw new ExpenseDomainError("System-sourced payment state is controlled by its source domain.", "SYSTEM_SOURCE_EDIT_DENIED");
    if (expense.status !== "CONFIRMED" || expense.paymentStatus === "PAID") throw new ExpenseDomainError("Only confirmed expenses with an outstanding balance can accept payment.", "EXPENSE_PAYMENT_STATUS_INVALID");
    if (expense.revision !== input.expectedRevision) throw stale();
    const alreadyPaid = expense.paymentEvents.reduce((sum, event) => sum.add(event.amount), new Prisma.Decimal(0));
    const outstanding = expense.amount.sub(alreadyPaid);
    const amount = requestedAmount ?? outstanding;
    if (amount.lte(0)) throw new ExpenseDomainError("Payment amount must be greater than zero.", "EXPENSE_PAYMENT_AMOUNT_INVALID");
    if (amount.gt(outstanding)) throw new ExpenseDomainError(`Payment exceeds the outstanding amount of RM ${outstanding.toFixed(2)}.`, "EXPENSE_OVERPAYMENT_BLOCKED");
    const nextPaid = alreadyPaid.add(amount);
    const nextStatus = nextPaid.eq(expense.amount) ? "PAID" : "PARTIALLY_PAID";
    const updated = await tx.businessExpense.updateMany({ where: { id: expense.id, revision: input.expectedRevision, status: "CONFIRMED", paymentStatus: { not: "PAID" } }, data: { paidAt: nextStatus === "PAID" ? new Date() : null, paidById: nextStatus === "PAID" ? input.actor.userId : null, paymentDate: payment.paymentDate, paymentMethod: payment.paymentMethod, paymentReference: payment.paymentReference, paymentStatus: nextStatus, revision: { increment: 1 } } });
    if (updated.count !== 1) throw stale();
    const paymentEvent = await tx.businessExpensePaymentEvent.create({ data: { amount, businessId: input.businessId, expenseId: expense.id, paymentStatus: nextStatus, paymentMethod: payment.paymentMethod!, paymentSource: payment.paymentSource!, paymentDate: payment.paymentDate!, paymentReference: payment.paymentReference, actorUserId: input.actor.userId } });
    await recordExpenseDrawerPayout(tx, {
      actorUserId: input.actor.userId,
      amount,
      branchId: expense.branchId,
      businessId: input.businessId,
      cashierShiftId: payment.cashierShiftId,
      paymentEventId: paymentEvent.id,
      paymentMethod: payment.paymentMethod!,
      paymentSource: payment.paymentSource!,
    });
    const current = await tx.businessExpense.findUniqueOrThrow({ where: { id: expense.id } });
    await createRevision(tx, current, input.actor.userId, nextStatus === "PAID" ? "MARKED_PAID" : "PARTIAL_PAYMENT_RECORDED", null);
    await recordCommand(tx, input, "MARK_PAID", fingerprint, "BusinessExpense", current.id);
    await writeAuditLog({ businessId: input.businessId, branchId: current.branchId, actor: input.actor, action: expense.sourceType === "CLAIM" ? "EXPENSE_SOURCE_PAYMENT_SYNCED" : nextStatus === "PAID" ? "EXPENSE_MARKED_PAID" : "EXPENSE_PARTIAL_PAYMENT_RECORDED", entityType: "BusinessExpense", entityId: current.id, summary: `${current.expenseNumber} payment of RM ${amount.toFixed(2)} recorded; RM ${expense.amount.sub(nextPaid).toFixed(2)} remains outstanding.`, before: { paidAmount: alreadyPaid.toFixed(2), paymentStatus: expense.paymentStatus }, after: { paidAmount: nextPaid.toFixed(2), paymentDate: current.paymentDate, paymentMethod: current.paymentMethod, paymentSource: payment.paymentSource, paymentReference: current.paymentReference, paymentStatus: current.paymentStatus }, request: input.request }, tx);
    return current;
  }, { isolationLevel: mutationIsolation });
}

export async function voidBusinessExpense(input: TransitionInput & { allowSystemSource?: boolean; reason: string }, database: PrismaClient = prisma) {
  const reason = requiredText(input.reason, 500, "Void reason");
  const fingerprint = hash({ command: "VOID_EXPENSE", expenseId: input.expenseId, expectedRevision: input.expectedRevision, reason });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "VOID_EXPENSE", fingerprint);
    if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const expense = await tx.businessExpense.findFirst({ where: { businessId: input.businessId, id: input.expenseId } });
    if (!expense) throw new ExpenseDomainError("Expense was not found in this business.", "EXPENSE_NOT_FOUND");
    if (expense.sourceType !== "MANUAL" && !input.allowSystemSource) throw new ExpenseDomainError("System-sourced lifecycle is controlled by its source domain.", "SYSTEM_SOURCE_EDIT_DENIED");
    if (expense.status !== "CONFIRMED") throw new ExpenseDomainError("Only confirmed expenses can be voided.", "EXPENSE_STATUS_INVALID");
    if (expense.paymentStatus !== "UNPAID") throw new ExpenseDomainError("Expenses with recorded payments cannot be voided directly; reviewed correction is required.", "PAID_EXPENSE_CANNOT_BE_VOIDED_DIRECTLY");
    if (expense.revision !== input.expectedRevision) throw stale();
    const updated = await tx.businessExpense.updateMany({ where: { id: expense.id, revision: input.expectedRevision, status: "CONFIRMED", paymentStatus: "UNPAID" }, data: { status: "VOID", voidedAt: new Date(), voidedById: input.actor.userId, voidReason: reason, revision: { increment: 1 } } });
    if (updated.count !== 1) throw stale();
    const current = await tx.businessExpense.findUniqueOrThrow({ where: { id: expense.id } });
    await createRevision(tx, current, input.actor.userId, "VOIDED", reason);
    await recordCommand(tx, input, "VOID_EXPENSE", fingerprint, "BusinessExpense", current.id);
    await writeAuditLog({ businessId: input.businessId, branchId: current.branchId, actor: input.actor, action: expense.sourceType === "CLAIM" ? "EXPENSE_SOURCE_VOIDED_FROM_CLAIM" : expense.sourceType === "PAYROLL" ? "EXPENSE_SOURCE_SUPERSEDED_FROM_PAYROLL" : "EXPENSE_VOIDED", entityType: "BusinessExpense", entityId: current.id, summary: `${current.expenseNumber} voided; history preserved.`, before: { status: expense.status }, after: { status: current.status }, metadata: { reason }, request: input.request }, tx);
    return current;
  }, { isolationLevel: mutationIsolation });
}

type TransitionInput = {
  actor: ExpenseActor;
  businessId: string;
  expenseId: string;
  expectedRevision: number;
  operationKey: string;
  request?: AuditRequestContext;
};

export async function createRecurringExpenseTemplate(input: Omit<ExpenseFactsInput, "expenseDate"> & {
  actor: ExpenseActor;
  businessId: string;
  endDate?: string | Date | null;
  operationKey: string;
  startDate: string | Date;
  request?: AuditRequestContext;
}, database: PrismaClient = prisma) {
  const facts = normalizeFacts({ ...input, expenseDate: input.startDate });
  const startDate = dateOnly(input.startDate, "Start date");
  const endDate = input.endDate ? dateOnly(input.endDate, "End date") : null;
  if (endDate && endDate < startDate) throw new ExpenseDomainError("Recurring end date cannot precede start date.", "RECURRING_DATE_INVALID");
  const fingerprint = hash({ command: "CREATE_RECURRING_TEMPLATE", ...facts.fingerprint, startDate, endDate });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "CREATE_RECURRING_TEMPLATE", fingerprint);
    if (replay) return tx.recurringExpenseTemplate.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const [category, branch] = await Promise.all([
      tx.expenseCategory.findFirst({ where: { active: true, businessId: input.businessId, id: facts.categoryId } }),
      facts.branchId ? tx.branch.findFirst({ where: { businessId: input.businessId, id: facts.branchId, status: "ACTIVE" } }) : null,
    ]);
    if (!category) throw new ExpenseDomainError("An active category is required.", "EXPENSE_CATEGORY_INACTIVE");
    if (facts.branchId && !branch) throw new ExpenseDomainError("Recurring branch is outside this business.", "EXPENSE_BRANCH_INVALID");
    const template = await tx.recurringExpenseTemplate.create({ data: { amount: facts.amount, branchId: facts.branchId, businessId: input.businessId, categoryId: facts.categoryId, createdById: input.actor.userId, currency: "MYR", defaultDescription: facts.description, endDate, frequency: "MONTHLY", notes: facts.notes, payeeName: facts.payeeName, startDate, updatedById: input.actor.userId } });
    await recordCommand(tx, input, "CREATE_RECURRING_TEMPLATE", fingerprint, "RecurringExpenseTemplate", template.id);
    await writeAuditLog({ businessId: input.businessId, branchId: template.branchId, actor: input.actor, action: "RECURRING_EXPENSE_CREATED", entityType: "RecurringExpenseTemplate", entityId: template.id, summary: "Monthly recurring Expense template created; no payment was made.", after: { active: template.active, amount: template.amount.toFixed(2), categoryId: template.categoryId, frequency: template.frequency }, request: input.request }, tx);
    return template;
  }, { isolationLevel: mutationIsolation });
}

export async function updateRecurringExpenseTemplate(input: Omit<ExpenseFactsInput, "expenseDate"> & {
  active: boolean;
  actor: ExpenseActor;
  businessId: string;
  endDate?: string | Date | null;
  expectedRevision: number;
  operationKey: string;
  reason: string;
  request?: AuditRequestContext;
  startDate: string | Date;
  templateId: string;
}, database: PrismaClient = prisma) {
  const facts = normalizeFacts({ ...input, expenseDate: input.startDate });
  const startDate = dateOnly(input.startDate, "Start date");
  const endDate = input.endDate ? dateOnly(input.endDate, "End date") : null;
  const reason = requiredText(input.reason, 500, "Template revision reason");
  if (endDate && endDate < startDate) throw new ExpenseDomainError("Recurring end date cannot precede start date.", "RECURRING_DATE_INVALID");
  const fingerprint = hash({ command: "UPDATE_RECURRING_TEMPLATE", active: input.active, endDate, expectedRevision: input.expectedRevision, reason, startDate, templateId: input.templateId, ...facts.fingerprint });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "UPDATE_RECURRING_TEMPLATE", fingerprint);
    if (replay) return tx.recurringExpenseTemplate.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const before = await tx.recurringExpenseTemplate.findFirst({ where: { businessId: input.businessId, id: input.templateId } });
    if (!before) throw new ExpenseDomainError("Recurring Expense template was not found.", "RECURRING_TEMPLATE_NOT_FOUND");
    if (before.revision !== input.expectedRevision) throw new ExpenseDomainError("Recurring template was updated by another user. Refresh required.", "RECURRING_TEMPLATE_UPDATED");
    const [category, branch] = await Promise.all([
      tx.expenseCategory.findFirst({ where: { active: true, businessId: input.businessId, id: facts.categoryId } }),
      facts.branchId ? tx.branch.findFirst({ where: { businessId: input.businessId, id: facts.branchId, status: "ACTIVE" } }) : null,
    ]);
    if (!category) throw new ExpenseDomainError("An active category is required.", "EXPENSE_CATEGORY_INACTIVE");
    if (facts.branchId && !branch) throw new ExpenseDomainError("Recurring branch is outside this business.", "EXPENSE_BRANCH_INVALID");
    const updated = await tx.recurringExpenseTemplate.updateMany({ where: { id: before.id, revision: input.expectedRevision }, data: { active: input.active, amount: facts.amount, branchId: facts.branchId, categoryId: facts.categoryId, defaultDescription: facts.description, endDate, notes: facts.notes, payeeName: facts.payeeName, revision: { increment: 1 }, startDate, updatedById: input.actor.userId } });
    if (updated.count !== 1) throw new ExpenseDomainError("Recurring template was updated by another user. Refresh required.", "RECURRING_TEMPLATE_UPDATED");
    const current = await tx.recurringExpenseTemplate.findUniqueOrThrow({ where: { id: before.id } });
    await recordCommand(tx, input, "UPDATE_RECURRING_TEMPLATE", fingerprint, "RecurringExpenseTemplate", current.id);
    await writeAuditLog({ businessId: input.businessId, branchId: current.branchId, actor: input.actor, action: current.active ? "RECURRING_EXPENSE_REVISED" : "RECURRING_EXPENSE_DEACTIVATED", entityType: "RecurringExpenseTemplate", entityId: current.id, summary: current.active ? "Recurring Expense template revised; prior generated Expenses were unchanged." : "Recurring Expense template deactivated; prior generated Expenses were unchanged.", before: { active: before.active, amount: before.amount.toFixed(2), revision: before.revision }, after: { active: current.active, amount: current.amount.toFixed(2), revision: current.revision }, metadata: { reason }, request: input.request }, tx);
    return current;
  }, { isolationLevel: mutationIsolation });
}

export async function generateRecurringExpense(input: {
  actor: ExpenseActor;
  businessId: string;
  operationKey: string;
  period: string;
  request?: AuditRequestContext;
  templateId: string;
}, database: PrismaClient = prisma) {
  const period = parsePeriod(input.period);
  const fingerprint = hash({ command: "GENERATE_RECURRING_EXPENSE", templateId: input.templateId, period: period.key });
  return database.$transaction(async (tx) => {
    const replay = await replayCommand(tx, input.businessId, input.operationKey, "GENERATE_RECURRING_EXPENSE", fingerprint);
    if (replay) return tx.businessExpense.findFirstOrThrow({ where: { businessId: input.businessId, id: replay.resultEntityId } });
    const template = await tx.recurringExpenseTemplate.findFirst({ where: { active: true, businessId: input.businessId, id: input.templateId }, include: { branch: { select: { name: true } }, category: true } });
    if (!template) throw new ExpenseDomainError("Active recurring Expense template was not found.", "RECURRING_TEMPLATE_NOT_FOUND");
    if (period.date < template.startDate || (template.endDate && period.date > template.endDate)) throw new ExpenseDomainError("Requested period is outside the recurring template effective dates.", "RECURRING_PERIOD_OUTSIDE_RANGE");
    const existing = await tx.businessExpense.findFirst({ where: { businessId: input.businessId, recurringTemplateId: template.id, generatedPeriod: period.key } });
    if (existing) {
      await recordCommand(tx, input, "GENERATE_RECURRING_EXPENSE", fingerprint, "BusinessExpense", existing.id);
      return existing;
    }
    const sequence = await tx.business.update({ where: { id: input.businessId }, data: { expenseSequence: { increment: 1 } }, select: { expenseSequence: true } });
    const expense = await tx.businessExpense.create({ data: { amount: template.amount, branchId: template.branchId, branchNameSnapshot: template.branch?.name ?? null, businessId: input.businessId, categoryId: template.categoryId, categoryNameSnapshot: template.category.name, createdById: input.actor.userId, currency: "MYR", description: template.defaultDescription, expenseDate: period.date, expenseNumber: `EXP-${String(sequence.expenseSequence).padStart(6, "0")}`, generatedPeriod: period.key, notes: template.notes, payeeName: template.payeeName, receiptRequiredSnapshot: template.category.requiresReceipt, recurringTemplateId: template.id, sourceId: `RECURRING:${template.id}`, sourceRevision: period.key, sourceType: "SYSTEM", status: "DRAFT", paymentStatus: "UNPAID", revision: 0 } });
    await createRevision(tx, expense, input.actor.userId, "RECURRING_DRAFT_GENERATED", null);
    await recordCommand(tx, input, "GENERATE_RECURRING_EXPENSE", fingerprint, "BusinessExpense", expense.id);
    await writeAuditLog({ businessId: input.businessId, branchId: expense.branchId, actor: input.actor, action: "RECURRING_EXPENSE_GENERATED", entityType: "BusinessExpense", entityId: expense.id, summary: `${expense.expenseNumber} generated as an unpaid draft for ${period.key}.`, after: auditExpense(expense, false), request: input.request }, tx);
    return expense;
  }, { isolationLevel: mutationIsolation });
}

export type ExpenseReadScope = Readonly<{
  allowedBranchIds?: readonly string[];
  includeBusinessWide?: boolean;
}>;

export async function listBusinessExpenses(input: ExpenseReadScope & {
  businessId: string;
  branchId?: string | null;
  categoryId?: string | null;
  dateFrom?: string | Date | null;
  dateTo?: string | Date | null;
  page?: number;
  pageSize?: number;
  paymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID" | null;
  q?: string | null;
  sourceType?: ExpenseSourceType | null;
  status?: ExpenseStatus | null;
}, database: PrismaClient = prisma) {
  const page = Math.max(1, input.page ?? 1);
  const take = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const where: Prisma.BusinessExpenseWhereInput = {
    businessId: input.businessId,
    ...readScopeWhere(input),
    ...(input.branchId ? { branchId: input.branchId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.sourceType ? { sourceType: input.sourceType } : {}),
    ...(input.dateFrom || input.dateTo ? { expenseDate: { ...(input.dateFrom ? { gte: dateOnly(input.dateFrom, "From date") } : {}), ...(input.dateTo ? { lte: dateOnly(input.dateTo, "To date") } : {}) } } : {}),
    ...(input.q?.trim() ? { OR: [{ expenseNumber: { contains: input.q.trim(), mode: "insensitive" } }, { payeeName: { contains: input.q.trim(), mode: "insensitive" } }, { description: { contains: input.q.trim(), mode: "insensitive" } }] } : {}),
  };
  const [items, total] = await Promise.all([
    database.businessExpense.findMany({ where, include: { attachments: { select: { id: true } }, branch: { select: { name: true } }, category: { select: { active: true, name: true } }, sourceSettlement: true, sourceSnapshot: true }, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * take, take }),
    database.businessExpense.count({ where }),
  ]);
  return { items, page, pageSize: take, total };
}

export async function getBusinessExpenseDetail(input: ExpenseReadScope & { businessId: string; expenseId: string }, database: PrismaClient = prisma) {
  const expense = await database.businessExpense.findFirst({ where: { businessId: input.businessId, id: input.expenseId, ...readScopeWhere(input) }, include: { attachments: { select: { byteLength: true, createdAt: true, id: true, malwareStatus: true, mimeType: true, privacyMetadataStatus: true, sanitizedFileName: true } }, branch: { select: { name: true } }, category: true, confirmedBy: { select: { name: true } }, createdBy: { select: { name: true } }, paidBy: { select: { name: true } }, paymentEvents: { include: { actor: { select: { name: true } }, drawerPayout: { include: { shift: { include: { cashier: { select: { name: true } } } } } } }, orderBy: { createdAt: "asc" } }, revisions: { include: { createdBy: { select: { name: true } } }, orderBy: { revision: "desc" } }, sourceSettlement: true, sourceSnapshot: true, voidedBy: { select: { name: true } } } });
  if (!expense) throw new ExpenseDomainError("Expense was not found in the authorised scope.", "EXPENSE_NOT_FOUND");
  return expense;
}

export async function getExpenseDashboard(input: ExpenseReadScope & {
  businessId: string;
  branchId?: string | null;
  dateFrom: string | Date;
  dateTo: string | Date;
  sourceType?: ExpenseSourceType | null;
}, database: PrismaClient = prisma) {
  const fromDate = dateOnly(input.dateFrom, "From date");
  const toDate = dateOnly(input.dateTo, "To date");
  const scopeWhere = readScopeWhere(input);
  const where: Prisma.BusinessExpenseWhereInput = { businessId: input.businessId, status: "CONFIRMED", expenseDate: { gte: fromDate, lte: toDate }, ...scopeWhere, ...(input.branchId ? { branchId: input.branchId } : {}), ...(input.sourceType ? { sourceType: input.sourceType } : {}) };
  const settlementExpenseWhere: Prisma.BusinessExpenseWhereInput = { businessId: input.businessId, status: "CONFIRMED", ...scopeWhere, ...(input.branchId ? { branchId: input.branchId } : {}), ...(input.sourceType ? { sourceType: input.sourceType } : {}) };
  const [aggregate, recognizedExpenses, byCategory, byBranch, bySource, recent, sales, periodPaymentEvents, inventoryExpenseSources] = await Promise.all([
    database.businessExpense.aggregate({ where, _avg: { amount: true }, _count: true, _max: { amount: true }, _sum: { amount: true } }),
    database.businessExpense.findMany({ where, select: { amount: true, id: true, recurringTemplateId: true, sourceId: true, sourceType: true } }),
    database.businessExpense.groupBy({ by: ["categoryId", "categoryNameSnapshot"], where, _count: true, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
    database.businessExpense.groupBy({ by: ["branchId", "branchNameSnapshot"], where, _count: true, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
    database.businessExpense.groupBy({ by: ["sourceType"], where, _count: true, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
    database.businessExpense.findMany({ where, select: { amount: true, branchNameSnapshot: true, categoryNameSnapshot: true, expenseDate: true, expenseNumber: true, id: true, payeeName: true, sourceType: true }, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }], take: 10 }),
    input.branchId || input.allowedBranchIds ? Promise.resolve(null) : database.analyticsDailyStoreSummary.aggregate({ where: { businessId: input.businessId, businessDate: { gte: dateOnly(input.dateFrom, "From date"), lte: dateOnly(input.dateTo, "To date") }, businessDayDefinitionVersion: ANALYTICS_BUSINESS_DAY_DEFINITION_VERSION, metricDefinitionVersion: ANALYTICS_METRIC_DEFINITION_VERSION }, _sum: { netSalesCents: true } }),
    database.businessExpensePaymentEvent.findMany({ where: { businessId: input.businessId, paymentDate: { gte: fromDate, lte: toDate }, expense: settlementExpenseWhere }, select: { amount: true, paymentMethod: true, paymentSource: true } }),
    input.sourceType && input.sourceType !== "INVENTORY_PURCHASE" ? Promise.resolve([]) : database.businessExpense.findMany({ where: { ...settlementExpenseWhere, sourceType: "INVENTORY_PURCHASE", sourceId: { not: null } }, select: { sourceId: true } }),
  ]);
  const genericExpenseIds = recognizedExpenses.filter((expense) => expense.sourceType !== "INVENTORY_PURCHASE").map((expense) => expense.id);
  const selectedSupplierBillIds = recognizedExpenses.filter((expense) => expense.sourceType === "INVENTORY_PURCHASE").map((expense) => expense.sourceId).filter((value): value is string => Boolean(value));
  const supplierBillIds = inventoryExpenseSources.map((expense) => expense.sourceId).filter((value): value is string => Boolean(value));
  const [appliedPayments, selectedSupplierPayments, supplierPayments] = await Promise.all([
    genericExpenseIds.length ? database.businessExpensePaymentEvent.aggregate({ where: { businessId: input.businessId, expenseId: { in: genericExpenseIds }, paymentDate: { lte: toDate } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    selectedSupplierBillIds.length ? database.supplierPayment.aggregate({ where: { businessId: input.businessId, paymentDate: { lte: toDate }, status: "COMPLETED", supplierBillId: { in: selectedSupplierBillIds } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    supplierBillIds.length ? database.supplierPayment.findMany({ where: { businessId: input.businessId, paymentDate: { gte: fromDate, lte: toDate }, status: "COMPLETED", supplierBillId: { in: supplierBillIds } }, select: { amount: true, paymentMethod: true } }) : Promise.resolve([]),
  ]);
  const total = moneyString(aggregate._sum.amount);
  const totalCents = toCents(total);
  const genericPaid = new Prisma.Decimal(appliedPayments._sum.amount ?? 0);
  const inventoryPaid = new Prisma.Decimal(selectedSupplierPayments._sum.amount ?? 0);
  const paid = genericPaid.add(inventoryPaid);
  const outstanding = Prisma.Decimal.max(new Prisma.Decimal(0), new Prisma.Decimal(total).sub(paid));
  const oneOff = recognizedExpenses.filter((expense) => !expense.recurringTemplateId).reduce((sum, expense) => sum.add(expense.amount), new Prisma.Decimal(0));
  const recurring = recognizedExpenses.filter((expense) => Boolean(expense.recurringTemplateId)).reduce((sum, expense) => sum.add(expense.amount), new Prisma.Decimal(0));
  const paymentMethodTotals = new Map<string, Prisma.Decimal>();
  const paymentSourceTotals = new Map<string, Prisma.Decimal>();
  for (const payment of periodPaymentEvents) {
    paymentMethodTotals.set(payment.paymentMethod, (paymentMethodTotals.get(payment.paymentMethod) ?? new Prisma.Decimal(0)).add(payment.amount));
    paymentSourceTotals.set(payment.paymentSource, (paymentSourceTotals.get(payment.paymentSource) ?? new Prisma.Decimal(0)).add(payment.amount));
  }
  for (const payment of supplierPayments) {
    const method = supplierPaymentMethod(payment.paymentMethod);
    paymentMethodTotals.set(method, (paymentMethodTotals.get(method) ?? new Prisma.Decimal(0)).add(payment.amount));
    const source = supplierPaymentSource(payment.paymentMethod);
    paymentSourceTotals.set(source, (paymentSourceTotals.get(source) ?? new Prisma.Decimal(0)).add(payment.amount));
  }
  const paymentsInPeriod = [...periodPaymentEvents, ...supplierPayments].reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
  return {
    average: moneyString(aggregate._avg.amount),
    byBranch: byBranch.map((row) => ({ amount: moneyString(row._sum.amount), branchId: row.branchId, branchName: row.branchNameSnapshot ?? "Business-wide", count: row._count })),
    byCategory: byCategory.map((row) => { const amount = moneyString(row._sum.amount); return { amount, categoryId: row.categoryId, categoryName: row.categoryNameSnapshot, count: row._count, percentage: totalCents === 0n ? 0 : Number((toCents(amount) * 10_000n) / totalCents) / 100 }; }),
    bySource: bySource.map((row) => ({ amount: moneyString(row._sum.amount), count: row._count, sourceType: row.sourceType })),
    count: aggregate._count,
    highest: moneyString(aggregate._max.amount),
    netSales: sales?._sum.netSalesCents === null || sales?._sum.netSalesCents === undefined ? null : centsNumberToMoney(sales._sum.netSalesCents),
    oneOff: oneOff.toFixed(2),
    paid: paid.toFixed(2),
    paymentByMethod: [...paymentMethodTotals.entries()].map(([method, amount]) => ({ amount: amount.toFixed(2), method })),
    paymentBySource: [...paymentSourceTotals.entries()].map(([source, amount]) => ({ amount: amount.toFixed(2), source })),
    paymentsInPeriod: paymentsInPeriod.toFixed(2),
    recent,
    recorded: total,
    recurring: recurring.toFixed(2),
    topCategory: byCategory[0]?.categoryNameSnapshot ?? null,
    unpaid: outstanding.toFixed(2),
  };
}

export async function getAuthorizedExpenseAttachment(input: ExpenseReadScope & { attachmentId: string; businessId: string }, database: PrismaClient = prisma, store: ClaimPrivateAttachmentStore = getClaimPrivateAttachmentStore()) {
  const attachment = await database.businessExpenseAttachment.findFirst({ where: { businessId: input.businessId, id: input.attachmentId, expense: { ...readScopeWhere(input) } } });
  if (!attachment) throw new ExpenseDomainError("Expense receipt was not found in the authorised scope.", "EXPENSE_RECEIPT_NOT_FOUND");
  assertClaimAttachmentCanBeReleased({ malwareStatus: attachment.malwareStatus, privacyMetadataStatus: attachment.privacyMetadataStatus });
  const metadata = await store.getQuarantinedMetadata(attachment.objectKey);
  if (metadata.byteLength !== attachment.byteLength || metadata.checksumSha256 !== attachment.checksumSha256 || metadata.mimeType !== attachment.mimeType) throw new ExpenseDomainError("Expense receipt integrity verification failed.", "EXPENSE_RECEIPT_INTEGRITY_FAILED");
  const bytes = await store.readQuarantined({ objectKey: attachment.objectKey, expectedChecksumSha256: attachment.checksumSha256 });
  return { bytes, fileName: attachment.sanitizedFileName, mimeType: attachment.mimeType };
}

export function expenseErrorMessage(error: unknown) {
  if (error instanceof ExpenseDomainError) return error.message;
  if (isUniqueViolation(error)) return "A conflicting Expense record already exists. Refresh and try again.";
  return error instanceof Error ? error.message : "Unable to complete the Expense action.";
}

function normalizeFacts(input: ExpenseFactsInput) {
  const amount = money(input.amount);
  const branchId = input.branchId || null;
  const categoryId = requiredText(input.categoryId, 100, "Category");
  const description = requiredText(input.description, 500, "Description");
  const expenseDate = dateOnly(input.expenseDate, "Expense date");
  const notes = optionalText(input.notes, 2000);
  const payeeName = optionalText(input.payeeName, 160);
  return { amount, branchId, categoryId, description, expenseDate, notes, payeeName, fingerprint: { amount: amount.toFixed(2), branchId, categoryId, description, expenseDate: expenseDate.toISOString().slice(0, 10), notes, payeeName } };
}

function normalizePayment(status: "UNPAID" | "PAID", input: { cashierShiftId?: string | null; paymentDate?: string | Date | null; paymentMethod?: ExpensePaymentMethod | null; paymentSource?: ExpensePaymentSource | null; paymentReference?: string | null }) {
  if (status === "UNPAID") return { cashierShiftId: null, paymentDate: null, paymentMethod: null, paymentSource: null, paymentReference: null };
  if (!input.paymentDate || !input.paymentMethod || !input.paymentSource) throw new ExpenseDomainError("Paid expenses require payment date, payment method and funding source.", "EXPENSE_PAYMENT_DETAILS_REQUIRED");
  const cashierShiftId = input.paymentSource === "POS_DRAWER" ? requiredText(input.cashierShiftId, 100, "Open POS shift") : null;
  return { cashierShiftId, paymentDate: dateOnly(input.paymentDate, "Payment date"), paymentMethod: input.paymentMethod, paymentSource: input.paymentSource, paymentReference: optionalText(input.paymentReference, 160) };
}

async function recordExpenseDrawerPayout(tx: Prisma.TransactionClient, input: {
  actorUserId: string;
  amount: Prisma.Decimal;
  branchId: string | null;
  businessId: string;
  cashierShiftId: string | null;
  paymentEventId: string;
  paymentMethod: ExpensePaymentMethod;
  paymentSource: ExpensePaymentSource;
}) {
  if (input.paymentSource !== "POS_DRAWER") return;
  if (input.paymentMethod !== "CASH") throw new ExpenseDomainError("POS Drawer payments must use the Cash payment method.", "EXPENSE_DRAWER_METHOD_INVALID");
  if (!input.branchId) throw new ExpenseDomainError("Business-wide expenses cannot be paid from a branch POS Drawer.", "EXPENSE_DRAWER_BRANCH_REQUIRED");
  if (!input.cashierShiftId) throw new ExpenseDomainError("Select an open POS shift for this drawer payment.", "EXPENSE_DRAWER_SHIFT_REQUIRED");

  const shift = await tx.cashierShift.findFirst({
    where: { branchId: input.branchId, businessId: input.businessId, id: input.cashierShiftId, status: "OPEN" },
    select: { id: true, openingFloat: true, startedAt: true },
  });
  if (!shift) throw new ExpenseDomainError("The selected POS shift is closed or outside this expense branch.", "EXPENSE_DRAWER_SHIFT_INVALID");
  const shiftActivity = await assertCashierShiftAcceptsActivity(tx, {
    businessId: input.businessId,
    shift,
  });

  const [cashPayments, cashRefunds, priorPayouts] = await Promise.all([
    tx.payment.aggregate({ where: { businessId: input.businessId, method: "CASH", shiftId: shift.id, status: "ACTIVE" }, _sum: { amount: true } }),
    tx.paymentRefund.aggregate({ where: { businessId: input.businessId, method: "CASH", shiftId: shift.id }, _sum: { amount: true } }),
    tx.cashierShiftExpensePayout.aggregate({ where: { businessId: input.businessId, branchId: input.branchId, shiftId: shift.id }, _sum: { amount: true } }),
  ]);
  const available = new Prisma.Decimal(shift.openingFloat)
    .add(cashPayments._sum.amount ?? 0)
    .sub(cashRefunds._sum.amount ?? 0)
    .sub(priorPayouts._sum.amount ?? 0);
  if (input.amount.gt(available)) throw new ExpenseDomainError(`POS Drawer has only RM ${available.toFixed(2)} expected cash available.`, "EXPENSE_DRAWER_INSUFFICIENT_CASH");

  await tx.cashierShiftExpensePayout.create({
    data: {
      amount: input.amount,
      branchId: input.branchId,
      businessId: input.businessId,
      createdById: input.actorUserId,
      paymentEventId: input.paymentEventId,
      occurredAt: shiftActivity.activityAt,
      shiftId: shift.id,
    },
  });
}

function supplierPaymentMethod(method: string): ExpensePaymentMethod {
  if (method === "CASH") return "CASH";
  if (method === "BANK_TRANSFER") return "BANK_TRANSFER";
  if (method === "CARD") return "CARD";
  if (method === "EWALLET") return "EWALLET";
  return "OTHER";
}

function supplierPaymentSource(method: string): ExpensePaymentSource {
  if (method === "BANK_TRANSFER" || method === "CHEQUE") return "BANK_ACCOUNT";
  if (method === "CARD") return "COMPANY_CARD";
  return "OTHER";
}

async function createRevision(tx: Prisma.TransactionClient, expense: Prisma.BusinessExpenseGetPayload<object>, actorUserId: string, revisionType: string, reason: string | null) {
  return tx.businessExpenseRevision.create({ data: { amount: expense.amount, branchId: expense.branchId, branchNameSnapshot: expense.branchNameSnapshot, businessId: expense.businessId, categoryId: expense.categoryId, categoryNameSnapshot: expense.categoryNameSnapshot, createdById: actorUserId, currency: expense.currency, description: expense.description, expenseDate: expense.expenseDate, expenseId: expense.id, notes: expense.notes, payeeName: expense.payeeName, paymentDate: expense.paymentDate, paymentMethod: expense.paymentMethod, paymentReference: expense.paymentReference, paymentStatus: expense.paymentStatus, reason, receiptRequiredSnapshot: expense.receiptRequiredSnapshot, revision: expense.revision, revisionType, status: expense.status } });
}

async function replayCommand(tx: Prisma.TransactionClient, businessId: string, key: string, type: ExpenseCommandType, fingerprint: string) {
  const command = await tx.expenseCommand.findUnique({ where: { businessId_operationKey: { businessId, operationKey: operationKey(key) } } });
  if (!command) return null;
  assertReplay(command, type, fingerprint);
  return command;
}

function assertReplay(command: { commandType: ExpenseCommandType; requestFingerprint: string }, type: ExpenseCommandType, fingerprint: string) {
  if (command.commandType !== type || command.requestFingerprint !== fingerprint) throw new ExpenseDomainError("Idempotency key was reused with a different Expense payload.", "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
}

async function recordCommand(tx: Prisma.TransactionClient, input: { actor: ExpenseActor; businessId: string; operationKey: string }, type: ExpenseCommandType, fingerprint: string, entityType: string, entityId: string) {
  await tx.expenseCommand.create({ data: { actorUserId: input.actor.userId, businessId: input.businessId, commandType: type, operationKey: operationKey(input.operationKey), requestFingerprint: fingerprint, resultEntityId: entityId, resultEntityType: entityType } });
}

function readScopeWhere(input: ExpenseReadScope): Prisma.BusinessExpenseWhereInput {
  if (!input.allowedBranchIds) return {};
  const branchIds = [...new Set(input.allowedBranchIds)];
  return { OR: [...(branchIds.length ? [{ branchId: { in: branchIds } }] : []), ...(input.includeBusinessWide ? [{ branchId: null }] : [])] };
}

function auditExpense(expense: { amount: Prisma.Decimal; branchId: string | null; categoryId: string; currency: string; expenseDate: Date; expenseNumber: string; paymentStatus: string; sourceId: string | null; sourceRevision: string | null; sourceType: string; status: string }, hasReceipt: boolean) {
  return { amount: expense.amount.toFixed(2), branchId: expense.branchId, categoryId: expense.categoryId, currency: expense.currency, expenseDate: expense.expenseDate.toISOString().slice(0, 10), expenseNumber: expense.expenseNumber, hasReceipt, paymentStatus: expense.paymentStatus, sourceId: expense.sourceId, sourceRevision: expense.sourceRevision, sourceType: expense.sourceType, status: expense.status };
}

function parsePeriod(value: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new ExpenseDomainError("Recurring period must use YYYY-MM.", "RECURRING_PERIOD_INVALID");
  return { key: value, date: new Date(`${value}-01T00:00:00.000Z`) };
}
function starterCode(name: string) { return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40); }
function stale() { return new ExpenseDomainError("Expense was updated by another user. Refresh required.", "EXPENSE_UPDATED_REFRESH_REQUIRED"); }
function operationKey(value: string) { return requiredText(value, 180, "Operation key"); }
function requiredText(value: unknown, max: number, label: string) { const text = typeof value === "string" ? value.trim() : ""; if (!text || text.length > max) throw new ExpenseDomainError(`${label} is required and must be ${max} characters or fewer.`); return text; }
function optionalText(value: unknown, max: number) { if (value === null || value === undefined || value === "") return null; const text = String(value).trim(); if (!text) return null; if (text.length > max) throw new ExpenseDomainError(`Text must be ${max} characters or fewer.`); return text; }
function integer(value: number, min: number, max: number, label: string) { if (!Number.isInteger(value) || value < min || value > max) throw new ExpenseDomainError(`${label} is invalid.`); return value; }
function money(value: string | number | Prisma.Decimal) { let amount: Prisma.Decimal; try { amount = new Prisma.Decimal(value); } catch { throw new ExpenseDomainError("Expense amount is invalid.", "EXPENSE_AMOUNT_INVALID"); } if (!amount.isPositive() || amount.decimalPlaces() > 2 || amount.greaterThan("9999999999.99")) throw new ExpenseDomainError("Expense amount must be positive with at most two decimal places.", "EXPENSE_AMOUNT_INVALID"); return amount; }
function dateOnly(value: string | Date, label: string) { const raw = value instanceof Date ? value.toISOString().slice(0, 10) : value; if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ExpenseDomainError(`${label} is invalid.`); const date = new Date(`${raw}T00:00:00.000Z`); if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw) throw new ExpenseDomainError(`${label} is invalid.`); return date; }
function hash(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; }
function moneyString(value: Prisma.Decimal | null | undefined) { return value?.toFixed(2) ?? "0.00"; }
function toCents(value: string) { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2)); }
function centsNumberToMoney(value: number) { return `${value < 0 ? "-" : ""}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, "0")}`; }
function isUniqueViolation(error: unknown) { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"; }
