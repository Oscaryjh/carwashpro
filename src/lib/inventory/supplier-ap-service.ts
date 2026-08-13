import { createHash } from "node:crypto";
import {
  Prisma,
  type SupplierApCommandType,
  type SupplierBillMatchStatus,
  type SupplierPaymentMethod,
} from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import { runInventorySerializable } from "@/lib/inventory/service";
import { prisma as PrismaClientLike } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export type SupplierApActor = {
  userId: string;
  name?: string | null;
  email?: string | null;
};

export type SupplierApContext = {
  actor: SupplierApActor;
  businessId: string;
  allowedBranchIds: readonly string[] | null;
  operationKey: string;
};

export type SupplierBillLineInput = {
  purchaseOrderLineId: string;
  billedQuantity: number;
  unitPrice: number | string;
};

export type SupplierApAuthorization = (
  transaction: Tx,
) => Promise<Record<string, unknown>>;

export class SupplierApConflictError extends Error {
  readonly code = "SUPPLIER_AP_CONFLICT";
}

export class SupplierApScopeError extends Error {
  readonly code = "SUPPLIER_AP_SCOPE_DENIED";
}

export function normalizeSupplierInvoiceNumber(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export async function createSupplierBillDraft(
  input: SupplierApContext & {
    branchId: string;
    dueDate: Date;
    invoiceDate: Date;
    lines: SupplierBillLineInput[];
    notes?: string | null;
    purchaseOrderId: string;
    supplierInvoiceNumber: string;
  },
) {
  validateOperation(input.operationKey);
  validateBillFacts(input);
  const payload = billPayload(input);
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CREATE_BILL", payload);
    if (replay) return getBill(tx, input.businessId, replay);
    assertBranchScope(input.allowedBranchIds, input.branchId);
    const purchaseOrder = await purchaseOrderForBilling(
      tx,
      input.businessId,
      input.purchaseOrderId,
    );
    assertPoScope(purchaseOrder, input.branchId);
    const normalized = normalizeSupplierInvoiceNumber(
      input.supplierInvoiceNumber,
    );
    await assertInvoiceNumberAvailable(
      tx,
      input.businessId,
      purchaseOrder.supplierId,
      normalized,
    );
    const facts = await canonicalLineFacts(
      tx,
      input.businessId,
      purchaseOrder,
      input.lines,
    );
    const subtotal = totalLines(facts);
    const sequence = await tx.business.update({
      where: { id: input.businessId },
      data: { supplierBillSequence: { increment: 1 } },
      select: { supplierBillSequence: true },
    });
    const created = await tx.supplierBill.create({
      data: {
        businessId: input.businessId,
        branchId: purchaseOrder.branchId,
        supplierId: purchaseOrder.supplierId,
        purchaseOrderId: purchaseOrder.id,
        billNumber: `SB-${String(sequence.supplierBillSequence).padStart(6, "0")}`,
        supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
        supplierInvoiceNumberNormalized: normalized,
        invoiceDate: dateOnly(input.invoiceDate),
        dueDate: dateOnly(input.dueDate),
        subtotal,
        totalAmount: subtotal,
        notes: cleanNullable(input.notes),
        createdById: input.actor.userId,
      },
    });
    await tx.supplierBillLine.createMany({ data: facts.map((line) => ({ ...lineData(input.businessId, line), supplierBillId: created.id })) });
    const bill = await getBill(tx, input.businessId, created.id);
    await recordCommand(tx, input, "CREATE_BILL", payload, "SUPPLIER_BILL", bill.id);
    await audit(tx, input, "SUPPLIER_BILL_DRAFT_CREATED", "SupplierBill", bill.id, `${bill.billNumber} draft created; AP, stock and expenses unchanged.`, null, bill, bill.branchId);
    return bill;
  });
}

export async function updateSupplierBillDraft(
  input: SupplierApContext & {
    billId: string;
    dueDate: Date;
    expectedRevision: number;
    invoiceDate: Date;
    lines: SupplierBillLineInput[];
    notes?: string | null;
    supplierInvoiceNumber: string;
  },
) {
  validateOperation(input.operationKey);
  validateBillFacts(input);
  const payload = billPayload(input);
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "UPDATE_DRAFT_BILL", payload);
    if (replay) return getBill(tx, input.businessId, replay);
    const before = await getBill(tx, input.businessId, input.billId);
    assertBranchScope(input.allowedBranchIds, before.branchId);
    if (before.status !== "DRAFT") throw new Error("Only draft supplier bills can be edited.");
    if (before.revision !== input.expectedRevision) throw new SupplierApConflictError("Supplier bill changed after this form was opened.");
    const normalized = normalizeSupplierInvoiceNumber(input.supplierInvoiceNumber);
    await assertInvoiceNumberAvailable(tx, input.businessId, before.supplierId, normalized, before.id);
    const purchaseOrder = await purchaseOrderForBilling(tx, input.businessId, before.purchaseOrderId);
    const facts = await canonicalLineFacts(tx, input.businessId, purchaseOrder, input.lines);
    const subtotal = totalLines(facts);
    const updated = await tx.supplierBill.updateMany({
      where: { id: before.id, businessId: input.businessId, revision: input.expectedRevision, status: "DRAFT" },
      data: {
        supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
        supplierInvoiceNumberNormalized: normalized,
        invoiceDate: dateOnly(input.invoiceDate),
        dueDate: dateOnly(input.dueDate),
        subtotal,
        totalAmount: subtotal,
        notes: cleanNullable(input.notes),
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new SupplierApConflictError("Concurrent supplier bill update detected.");
    await tx.supplierBillLine.deleteMany({ where: { businessId: input.businessId, supplierBillId: before.id } });
    await tx.supplierBillLine.createMany({ data: facts.map((line) => ({ ...lineData(input.businessId, line), supplierBillId: before.id })) });
    const bill = await getBill(tx, input.businessId, before.id);
    await recordCommand(tx, input, "UPDATE_DRAFT_BILL", payload, "SUPPLIER_BILL", bill.id);
    await audit(tx, input, "SUPPLIER_BILL_DRAFT_UPDATED", "SupplierBill", bill.id, `${bill.billNumber} draft updated; AP, stock and expenses unchanged.`, before, bill, bill.branchId);
    return bill;
  });
}

export async function confirmSupplierBill(
  input: SupplierApContext & {
    allowOwnerSelfConfirm: boolean;
    billId: string;
    expectedRevision: number;
    priceVarianceAcknowledged: boolean;
    priceVarianceReason?: string | null;
  },
) {
  validateOperation(input.operationKey);
  const payload = {
    billId: input.billId,
    expectedRevision: input.expectedRevision,
    priceVarianceAcknowledged: input.priceVarianceAcknowledged,
    priceVarianceReason: cleanNullable(input.priceVarianceReason),
  };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "CONFIRM_BILL", payload);
    if (replay) return getBill(tx, input.businessId, replay);
    const before = await getBill(tx, input.businessId, input.billId);
    assertBranchScope(input.allowedBranchIds, before.branchId);
    if (before.status !== "DRAFT") throw new Error("Only a draft supplier bill can be confirmed.");
    if (before.revision !== input.expectedRevision) throw new SupplierApConflictError("Supplier bill changed after this form was opened.");
    if (before.createdById === input.actor.userId && !input.allowOwnerSelfConfirm) {
      throw new Error("Supplier bill confirmation requires a different authorised user.");
    }
    await assertInvoiceNumberAvailable(tx, input.businessId, before.supplierId, before.supplierInvoiceNumberNormalized, before.id);
    const purchaseOrder = await purchaseOrderForBilling(tx, input.businessId, before.purchaseOrderId);
    const canonical = await canonicalLineFacts(
      tx,
      input.businessId,
      purchaseOrder,
      before.lines.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        billedQuantity: line.billedQuantity,
        unitPrice: line.unitPrice.toString(),
      })),
      before.id,
    );
    const hasPriceVariance = canonical.some((line) => !line.unitPrice.equals(line.expectedUnitCost));
    if (hasPriceVariance && (!input.priceVarianceAcknowledged || !cleanNullable(input.priceVarianceReason))) {
      throw new Error("Price variance requires an explicit acknowledgement and reason before confirmation.");
    }
    for (const line of canonical) {
      if (line.previouslyBilled + line.billedQuantity > line.netReceived) {
        throw new SupplierApConflictError(`Over-bill blocked for ${line.descriptionSnapshot}: received ${line.netReceived}, already billed ${line.previouslyBilled}.`);
      }
    }
    const subtotal = totalLines(canonical);
    if (!subtotal.equals(before.totalAmount)) throw new SupplierApConflictError("Draft bill total is stale; reopen and review its lines.");
    for (const line of canonical) {
      await tx.supplierBillLine.update({
        where: { id: before.lines.find((candidate) => candidate.purchaseOrderLineId === line.purchaseOrderLineId)!.id },
        data: {
          orderedQuantitySnapshot: line.orderedQuantity,
          netReceivedSnapshot: line.netReceived,
          previouslyBilledSnapshot: line.previouslyBilled,
        },
      });
    }
    const matchStatus: SupplierBillMatchStatus = hasPriceVariance ? "PRICE_VARIANCE" : "MATCHED";
    const transitioned = await tx.supplierBill.updateMany({
      where: { id: before.id, businessId: input.businessId, revision: input.expectedRevision, status: "DRAFT" },
      data: {
        status: "CONFIRMED",
        matchStatus,
        confirmedById: input.actor.userId,
        confirmedAt: new Date(),
        confirmedRevision: input.expectedRevision + 1,
        priceVarianceAcknowledged: hasPriceVariance,
        priceVarianceReason: hasPriceVariance ? cleanNullable(input.priceVarianceReason) : null,
        revision: { increment: 1 },
      },
    });
    if (transitioned.count !== 1) throw new SupplierApConflictError("Concurrent supplier bill confirmation detected.");
    const bill = await getBill(tx, input.businessId, before.id);
    await recordCommand(tx, input, "CONFIRM_BILL", payload, "SUPPLIER_BILL", bill.id);
    await audit(tx, input, "SUPPLIER_BILL_CONFIRMED", "SupplierBill", bill.id, `${bill.billNumber} confirmed; AP increased by ${bill.totalAmount.toFixed(2)}. Stock unchanged; Expense adapter follows after commit.`, before, bill, bill.branchId);
    return bill;
  });
}

export async function voidSupplierBill(
  input: SupplierApContext & {
    billId: string;
    expectedRevision: number;
    reason: string;
  },
) {
  validateOperation(input.operationKey);
  const reason = requiredReason(input.reason);
  const payload = { billId: input.billId, expectedRevision: input.expectedRevision, reason };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "VOID_BILL", payload);
    if (replay) return getBill(tx, input.businessId, replay);
    const before = await getBill(tx, input.businessId, input.billId);
    assertBranchScope(input.allowedBranchIds, before.branchId);
    if (before.status !== "CONFIRMED") throw new Error("Only a confirmed supplier bill can be voided.");
    if (before.revision !== input.expectedRevision) throw new SupplierApConflictError("Supplier bill changed after this form was opened.");
    const paid = await validPaymentTotal(tx, input.businessId, before.id);
    if (!paid.isZero()) throw new Error("A supplier bill with valid payments cannot be voided; reverse payments first.");
    const changed = await tx.supplierBill.updateMany({
      where: { id: before.id, businessId: input.businessId, revision: input.expectedRevision, status: "CONFIRMED" },
      data: { status: "VOID", voidedById: input.actor.userId, voidedAt: new Date(), voidReason: reason, revision: { increment: 1 } },
    });
    if (changed.count !== 1) throw new SupplierApConflictError("Concurrent supplier bill transition detected.");
    const bill = await getBill(tx, input.businessId, before.id);
    await recordCommand(tx, input, "VOID_BILL", payload, "SUPPLIER_BILL", bill.id);
    await audit(tx, input, "SUPPLIER_BILL_VOIDED", "SupplierBill", bill.id, `${bill.billNumber} voided; AP removed. Stock unchanged; Expense adapter follows after commit.`, before, bill, bill.branchId);
    return bill;
  });
}

export async function recordSupplierPayment(
  input: SupplierApContext & {
    authorize: SupplierApAuthorization;
    billId: string;
    amount: number | string;
    paymentDate: Date;
    paymentMethod: SupplierPaymentMethod;
    paymentReference?: string | null;
    notes?: string | null;
  },
) {
  validateOperation(input.operationKey);
  const amount = money(input.amount);
  if (amount.lessThanOrEqualTo(0)) throw new Error("Supplier payment amount must be greater than zero.");
  const payload = {
    billId: input.billId,
    amount: amount.toFixed(2),
    paymentDate: dateOnly(input.paymentDate).toISOString(),
    paymentMethod: input.paymentMethod,
    paymentReference: cleanNullable(input.paymentReference),
    notes: cleanNullable(input.notes),
  };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "RECORD_PAYMENT", payload);
    if (replay) return tx.supplierPayment.findFirstOrThrow({ where: { id: replay, businessId: input.businessId }, include: { reversal: true } });
    const bill = await getBill(tx, input.businessId, input.billId);
    assertBranchScope(input.allowedBranchIds, bill.branchId);
    if (bill.status !== "CONFIRMED") throw new Error("Supplier payments require a confirmed bill.");
    const paid = await validPaymentTotal(tx, input.businessId, bill.id);
    const outstanding = bill.totalAmount.minus(paid);
    if (amount.greaterThan(outstanding)) throw new SupplierApConflictError(`Overpayment blocked. Canonical outstanding is ${outstanding.toFixed(2)}.`);
    const authorization = await input.authorize(tx);
    const sequence = await tx.business.update({
      where: { id: input.businessId },
      data: { supplierPaymentSequence: { increment: 1 } },
      select: { supplierPaymentSequence: true },
    });
    const payment = await tx.supplierPayment.create({
      data: {
        businessId: input.businessId,
        branchId: bill.branchId,
        supplierId: bill.supplierId,
        supplierBillId: bill.id,
        paymentNumber: `SP-${String(sequence.supplierPaymentSequence).padStart(6, "0")}`,
        paymentDate: dateOnly(input.paymentDate),
        amount,
        paymentMethod: input.paymentMethod,
        paymentReference: cleanNullable(input.paymentReference),
        notes: cleanNullable(input.notes),
        createdById: input.actor.userId,
      },
      include: { reversal: true },
    });
    const nextPaid = paid.plus(amount);
    const paymentStatus = nextPaid.equals(bill.totalAmount) ? "PAID" : "PARTIALLY_PAID";
    await tx.supplierBill.update({ where: { id: bill.id }, data: { paymentStatus, revision: { increment: 1 } } });
    await recordCommand(tx, input, "RECORD_PAYMENT", payload, "SUPPLIER_PAYMENT", payment.id);
    await audit(tx, input, "SUPPLIER_PAYMENT_RECORDED", "SupplierPayment", payment.id, `${payment.paymentNumber} completed; AP reduced by ${amount.toFixed(2)}. This settles AP and does not create another Expense or change stock.`, null, { ...payment, authorization }, bill.branchId);
    return payment;
  });
}

export async function reverseSupplierPayment(
  input: SupplierApContext & {
    authorize: SupplierApAuthorization;
    paymentId: string;
    reason: string;
  },
) {
  validateOperation(input.operationKey);
  const reason = requiredReason(input.reason);
  const payload = { paymentId: input.paymentId, reason };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "REVERSE_PAYMENT", payload);
    if (replay) return tx.supplierPayment.findFirstOrThrow({ where: { id: replay, businessId: input.businessId }, include: { reversal: true } });
    const payment = await tx.supplierPayment.findFirst({ where: { id: input.paymentId, businessId: input.businessId }, include: { supplierBill: true, reversal: true } });
    if (!payment) throw new Error("Supplier payment not found.");
    assertBranchScope(input.allowedBranchIds, payment.branchId);
    if (payment.status !== "COMPLETED" || payment.reversal) throw new Error("Supplier payment was already reversed.");
    const authorization = await input.authorize(tx);
    await tx.supplierPaymentReversal.create({ data: { businessId: input.businessId, supplierPaymentId: payment.id, reason, createdById: input.actor.userId } });
    await tx.supplierPayment.update({ where: { id: payment.id }, data: { status: "REVERSED" } });
    const remainingPaid = (await validPaymentTotal(tx, input.businessId, payment.supplierBillId));
    const paymentStatus = remainingPaid.isZero() ? "UNPAID" : remainingPaid.equals(payment.supplierBill.totalAmount) ? "PAID" : "PARTIALLY_PAID";
    await tx.supplierBill.update({ where: { id: payment.supplierBillId }, data: { paymentStatus, revision: { increment: 1 } } });
    await recordCommand(tx, input, "REVERSE_PAYMENT", payload, "SUPPLIER_PAYMENT", payment.id);
    const result = await tx.supplierPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { reversal: true } });
    await audit(tx, input, "SUPPLIER_PAYMENT_REVERSED", "SupplierPayment", payment.id, `${payment.paymentNumber} reversed; AP restored by ${payment.amount.toFixed(2)}. This does not create another Expense or change stock.`, payment, { ...result, authorization }, payment.branchId);
    return result;
  });
}

export async function attachSupplierInvoice(
  input: SupplierApContext & {
    billId: string;
    stored: {
      objectKey: string;
      originalFileName: string;
      sanitizedFileName: string;
      mimeType: string;
      byteLength: number;
      checksumSha256: string;
      malwareStatus: string;
      privacyMetadataStatus: string;
    };
  },
) {
  validateOperation(input.operationKey);
  const payload = { billId: input.billId, checksumSha256: input.stored.checksumSha256 };
  return runInventorySerializable(async (tx) => {
    const replay = await commandReplay(tx, input, "ATTACH_INVOICE", payload);
    if (replay) return tx.supplierBillAttachment.findFirstOrThrow({ where: { businessId: input.businessId, id: replay } });
    const bill = await getBill(tx, input.businessId, input.billId);
    assertBranchScope(input.allowedBranchIds, bill.branchId);
    if (bill.status !== "DRAFT") throw new Error("Supplier invoice attachments must be added before confirmation.");
    if (bill.attachment) throw new Error("This supplier bill already has an invoice attachment.");
    const attachment = await tx.supplierBillAttachment.create({
      data: {
        businessId: input.businessId,
        supplierBillId: bill.id,
        objectKey: input.stored.objectKey,
        originalFileName: input.stored.originalFileName.slice(0, 160),
        sanitizedFileName: input.stored.sanitizedFileName,
        mimeType: input.stored.mimeType,
        byteLength: input.stored.byteLength,
        checksumSha256: input.stored.checksumSha256,
        malwareStatus: input.stored.malwareStatus,
        privacyMetadataStatus: input.stored.privacyMetadataStatus,
        uploadedById: input.actor.userId,
      },
    });
    await recordCommand(tx, input, "ATTACH_INVOICE", payload, "SUPPLIER_BILL_ATTACHMENT", attachment.id);
    await audit(tx, input, "SUPPLIER_INVOICE_ATTACHED", "SupplierBillAttachment", attachment.id, `${bill.billNumber} supplier invoice attachment stored in private quarantine.`, null, { checksumSha256: attachment.checksumSha256, byteLength: attachment.byteLength, mimeType: attachment.mimeType }, bill.branchId);
    return attachment;
  });
}

export async function getAuthorizedSupplierInvoiceAttachment(input: {
  attachmentId: string;
  businessId: string;
  allowedBranchIds: readonly string[] | null;
}) {
  const attachment = await PrismaClientLike.supplierBillAttachment.findFirst({
    where: {
      id: input.attachmentId,
      businessId: input.businessId,
      supplierBill: input.allowedBranchIds ? { branchId: { in: [...input.allowedBranchIds] } } : undefined,
    },
  });
  if (!attachment) throw new SupplierApScopeError("Supplier invoice attachment is outside your authorised scope.");
  return attachment;
}

export async function getSupplierBillDetail(input: {
  businessId: string;
  billId: string;
  allowedBranchIds: readonly string[] | null;
}) {
  const bill = await getBill(PrismaClientLike, input.businessId, input.billId);
  assertBranchScope(input.allowedBranchIds, bill.branchId);
  const paid = bill.payments.filter((payment) => payment.status === "COMPLETED").reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  const trace = await purchaseOrderTrace({ businessId: input.businessId, purchaseOrderId: bill.purchaseOrderId });
  return {
    ...bill,
    validPaidAmount: paid,
    outstandingAmount: bill.status === "CONFIRMED" ? bill.totalAmount.minus(paid) : new Prisma.Decimal(0),
    derivedPaymentStatus: paid.isZero() ? "UNPAID" : paid.equals(bill.totalAmount) ? "PAID" : "PARTIALLY_PAID",
    trace,
  };
}

export async function listSupplierBills(input: {
  businessId: string;
  allowedBranchIds: readonly string[] | null;
  status?: "DRAFT" | "CONFIRMED" | "VOID";
}) {
  const bills = await PrismaClientLike.supplierBill.findMany({
    where: {
      businessId: input.businessId,
      ...(input.allowedBranchIds ? { branchId: { in: [...input.allowedBranchIds] } } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: { supplier: true, branch: true, purchaseOrder: true, payments: true, lines: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
  });
  return bills.map((bill) => withOutstanding(bill));
}

export async function getAccountsPayableOverview(input: {
  businessId: string;
  allowedBranchIds: readonly string[] | null;
  now?: Date;
}) {
  const now = dateOnly(input.now ?? new Date());
  const dueSoonEnd = new Date(now); dueSoonEnd.setUTCDate(dueSoonEnd.getUTCDate() + 7);
  const bills = (await listSupplierBills(input)).filter((bill) => bill.status === "CONFIRMED" && bill.outstandingAmount.greaterThan(0));
  const supplierMap = new Map<string, { supplierId: string; supplierName: string; outstanding: Prisma.Decimal }>();
  for (const bill of bills) {
    const current = supplierMap.get(bill.supplierId) ?? { supplierId: bill.supplierId, supplierName: bill.supplier.name, outstanding: new Prisma.Decimal(0) };
    current.outstanding = current.outstanding.plus(bill.outstandingAmount);
    supplierMap.set(bill.supplierId, current);
  }
  return {
    totalOutstanding: bills.reduce((sum, bill) => sum.plus(bill.outstandingAmount), new Prisma.Decimal(0)),
    dueSoon: bills.filter((bill) => bill.dueDate >= now && bill.dueDate <= dueSoonEnd),
    overdue: bills.filter((bill) => bill.dueDate < now),
    bills,
    suppliers: [...supplierMap.values()].sort((a, b) => b.outstanding.comparedTo(a.outstanding)),
  };
}

export async function purchaseOrderTrace(input: { businessId: string; purchaseOrderId: string }) {
  const po = await purchaseOrderForBilling(PrismaClientLike, input.businessId, input.purchaseOrderId, false);
  const facts = await lineAggregates(PrismaClientLike, input.businessId, po.lines.map((line) => line.id));
  return po.lines.map((line) => ({
    purchaseOrderLineId: line.id,
    productId: line.productId,
    productName: line.product.name,
    ordered: line.orderedQuantity,
    received: facts.get(line.id)?.netReceived ?? 0,
    billed: facts.get(line.id)?.billed ?? 0,
    expectedUnitCost: line.expectedUnitCost,
  }));
}

export async function reconcileAccountsPayable(input: {
  businessId: string;
  allowedBranchIds: readonly string[] | null;
}) {
  const bills = await listSupplierBills(input);
  const issues: Array<{ code: string; entityId: string; detail: string }> = [];
  const receiptIssueKeys = new Set<string>();
  for (const bill of bills) {
    const lineTotal = bill.lines?.reduce?.((sum: Prisma.Decimal, line: { lineTotal: Prisma.Decimal }) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
    if (lineTotal && !lineTotal.equals(bill.totalAmount)) issues.push({ code: "BILL_TOTAL_MISMATCH", entityId: bill.id, detail: `${bill.billNumber} line total differs from bill total.` });
    const paid = bill.payments.filter((payment) => payment.status === "COMPLETED").reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
    const derived = paid.isZero() ? "UNPAID" : paid.equals(bill.totalAmount) ? "PAID" : paid.lessThan(bill.totalAmount) ? "PARTIALLY_PAID" : "OVERPAID";
    if (derived === "OVERPAID") issues.push({ code: "OVERPAYMENT", entityId: bill.id, detail: `${bill.billNumber} valid payments exceed confirmed amount.` });
    if (derived !== "OVERPAID" && bill.status === "CONFIRMED" && derived !== bill.paymentStatus) issues.push({ code: "PAYMENT_STATUS_MISMATCH", entityId: bill.id, detail: `${bill.billNumber} materialized payment status is stale.` });
    if (bill.status === "CONFIRMED") {
      const trace = await purchaseOrderTrace({ businessId: input.businessId, purchaseOrderId: bill.purchaseOrderId });
      trace.filter((line) => line.billed > line.received).forEach((line) => {
        const key = `${bill.purchaseOrderId}:${line.purchaseOrderLineId}`;
        if (receiptIssueKeys.has(key)) return;
        receiptIssueKeys.add(key);
        issues.push({ code: "RECEIPT_REVERSAL_AFTER_BILL", entityId: bill.id, detail: `${line.productName}: billed ${line.billed}, net received ${line.received}.` });
      });
    }
  }
  return { status: issues.length ? "ISSUES" as const : "BALANCED" as const, issues };
}

const billInclude = {
  attachment: true,
  branch: true,
  createdBy: { select: { id: true, name: true, email: true } },
  confirmedBy: { select: { id: true, name: true, email: true } },
  voidedBy: { select: { id: true, name: true, email: true } },
  supplier: true,
  purchaseOrder: true,
  lines: { include: { product: true, purchaseOrderLine: true }, orderBy: { createdAt: "asc" as const } },
  payments: { include: { reversal: true, createdBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.SupplierBillInclude;

async function getBill(tx: Tx | typeof PrismaClientLike, businessId: string, id: string) {
  return tx.supplierBill.findFirstOrThrow({ where: { businessId, id }, include: billInclude });
}

async function purchaseOrderForBilling(tx: Tx | typeof PrismaClientLike, businessId: string, id: string, requireApproved = true) {
  const po = await tx.purchaseOrder.findFirst({
    where: { id, businessId },
    include: { supplier: true, branch: true, lines: { include: { product: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!po) throw new Error("Purchase order not found.");
  if (requireApproved && !['APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(po.status)) throw new Error("Supplier bills require an approved purchase order.");
  return po;
}

type BillablePo = Awaited<ReturnType<typeof purchaseOrderForBilling>>;

async function canonicalLineFacts(
  tx: Tx,
  businessId: string,
  purchaseOrder: BillablePo,
  inputs: SupplierBillLineInput[],
  excludingBillId?: string,
) {
  validateLines(inputs);
  const poLines = new Map(purchaseOrder.lines.map((line) => [line.id, line]));
  if (inputs.some((line) => !poLines.has(line.purchaseOrderLineId))) throw new SupplierApScopeError("A supplier bill line is outside its purchase order.");
  const aggregates = await lineAggregates(tx, businessId, inputs.map((line) => line.purchaseOrderLineId), excludingBillId);
  return inputs.map((input) => {
    const poLine = poLines.get(input.purchaseOrderLineId)!;
    const aggregate = aggregates.get(poLine.id) ?? { netReceived: 0, billed: 0 };
    const unitPrice = money(input.unitPrice);
    return {
      purchaseOrderLineId: poLine.id,
      productId: poLine.productId,
      descriptionSnapshot: poLine.product.name,
      billedQuantity: input.billedQuantity,
      unitPrice,
      expectedUnitCost: poLine.expectedUnitCost,
      lineTotal: unitPrice.mul(input.billedQuantity),
      orderedQuantity: poLine.orderedQuantity,
      netReceived: aggregate.netReceived,
      previouslyBilled: aggregate.billed,
    };
  });
}

async function lineAggregates(
  tx: Tx | typeof PrismaClientLike,
  businessId: string,
  lineIds: string[],
  excludingBillId?: string,
) {
  const [received, reversed, billed] = await Promise.all([
    tx.goodsReceiptLine.groupBy({ by: ["purchaseOrderLineId"], where: { businessId, purchaseOrderLineId: { in: lineIds } }, _sum: { receivedQuantity: true } }),
    tx.goodsReceiptReversal.groupBy({ by: ["purchaseOrderLineId"], where: { businessId, purchaseOrderLineId: { in: lineIds } }, _sum: { reversedQuantity: true } }),
    tx.supplierBillLine.groupBy({ by: ["purchaseOrderLineId"], where: { businessId, purchaseOrderLineId: { in: lineIds }, supplierBill: { status: "CONFIRMED", ...(excludingBillId ? { id: { not: excludingBillId } } : {}) } }, _sum: { billedQuantity: true } }),
  ]);
  const map = new Map<string, { netReceived: number; billed: number }>();
  for (const id of lineIds) map.set(id, { netReceived: 0, billed: 0 });
  for (const row of received) map.get(row.purchaseOrderLineId)!.netReceived += row._sum.receivedQuantity ?? 0;
  for (const row of reversed) map.get(row.purchaseOrderLineId)!.netReceived -= row._sum.reversedQuantity ?? 0;
  for (const row of billed) map.get(row.purchaseOrderLineId)!.billed += row._sum.billedQuantity ?? 0;
  return map;
}

async function validPaymentTotal(tx: Tx, businessId: string, supplierBillId: string) {
  const result = await tx.supplierPayment.aggregate({ where: { businessId, supplierBillId, status: "COMPLETED" }, _sum: { amount: true } });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

async function assertInvoiceNumberAvailable(tx: Tx, businessId: string, supplierId: string, normalized: string, excludingId?: string) {
  const duplicate = await tx.supplierBill.findFirst({ where: { businessId, supplierId, supplierInvoiceNumberNormalized: normalized, status: { not: "VOID" }, ...(excludingId ? { id: { not: excludingId } } : {}) }, select: { billNumber: true } });
  if (duplicate) throw new SupplierApConflictError(`Duplicate supplier invoice blocked; already used by ${duplicate.billNumber}.`);
}

function withOutstanding<T extends { status: string; totalAmount: Prisma.Decimal; payments: Array<{ amount: Prisma.Decimal; status: string }> }>(bill: T) {
  const validPaidAmount = bill.payments.filter((payment) => payment.status === "COMPLETED").reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
  return { ...bill, validPaidAmount, outstandingAmount: bill.status === "CONFIRMED" ? bill.totalAmount.minus(validPaidAmount) : new Prisma.Decimal(0) };
}

function lineData(businessId: string, line: Awaited<ReturnType<typeof canonicalLineFacts>>[number]) {
  return {
    businessId,
    purchaseOrderLineId: line.purchaseOrderLineId,
    productId: line.productId,
    descriptionSnapshot: line.descriptionSnapshot,
    billedQuantity: line.billedQuantity,
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    orderedQuantitySnapshot: line.orderedQuantity,
    netReceivedSnapshot: line.netReceived,
    previouslyBilledSnapshot: line.previouslyBilled,
  };
}

function billPayload(input: { billId?: string; branchId?: string; dueDate: Date; expectedRevision?: number; invoiceDate: Date; lines: SupplierBillLineInput[]; notes?: string | null; purchaseOrderId?: string; supplierInvoiceNumber: string }) {
  return {
    billId: input.billId,
    branchId: input.branchId,
    purchaseOrderId: input.purchaseOrderId,
    expectedRevision: input.expectedRevision,
    dueDate: dateOnly(input.dueDate).toISOString(),
    invoiceDate: dateOnly(input.invoiceDate).toISOString(),
    supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
    notes: cleanNullable(input.notes),
    lines: input.lines.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, billedQuantity: line.billedQuantity, unitPrice: money(line.unitPrice).toFixed(2) })),
  };
}

async function commandReplay(tx: Tx, context: SupplierApContext, type: SupplierApCommandType, payload: unknown) {
  const existing = await tx.supplierApCommand.findUnique({ where: { businessId_operationKey: { businessId: context.businessId, operationKey: context.operationKey } } });
  if (!existing) return null;
  if (existing.commandType !== type || existing.requestFingerprint !== fingerprint(payload)) throw new SupplierApConflictError("Supplier AP operation ID was reused with different details.");
  return existing.resultEntityId;
}

async function recordCommand(tx: Tx, context: SupplierApContext, type: SupplierApCommandType, payload: unknown, resultEntityType: string, resultEntityId: string) {
  await tx.supplierApCommand.create({ data: { actorUserId: context.actor.userId, businessId: context.businessId, commandType: type, operationKey: context.operationKey, requestFingerprint: fingerprint(payload), resultEntityId, resultEntityType } });
}

async function audit(tx: Tx, context: SupplierApContext, action: string, entityType: string, entityId: string, summary: string, before: unknown, after: unknown, branchId?: string) {
  await writeAuditLog({ action, actor: { email: context.actor.email ?? "", name: context.actor.name ?? "System", userId: context.actor.userId }, after, before, branchId, businessId: context.businessId, entityId, entityType, summary }, tx);
}

function validateBillFacts(input: { dueDate: Date; invoiceDate: Date; lines: SupplierBillLineInput[]; supplierInvoiceNumber: string }) {
  if (!normalizeSupplierInvoiceNumber(input.supplierInvoiceNumber) || input.supplierInvoiceNumber.trim().length > 120) throw new Error("A valid supplier invoice number is required.");
  if (dateOnly(input.dueDate) < dateOnly(input.invoiceDate)) throw new Error("Due date cannot be before invoice date.");
  validateLines(input.lines);
}

function validateLines(lines: SupplierBillLineInput[]) {
  if (!lines.length || lines.length > 100) throw new Error("Supplier bill requires 1 to 100 lines.");
  if (new Set(lines.map((line) => line.purchaseOrderLineId)).size !== lines.length) throw new Error("Duplicate purchase order lines are not allowed.");
  for (const line of lines) {
    if (!Number.isInteger(line.billedQuantity) || line.billedQuantity <= 0) throw new Error("Billed quantity must be a positive whole number.");
    money(line.unitPrice);
  }
}

function assertPoScope(po: { branchId: string }, branchId: string) {
  if (po.branchId !== branchId) throw new SupplierApScopeError("Supplier bill branch must match its purchase order.");
}

function assertBranchScope(allowedBranchIds: readonly string[] | null, branchId: string) {
  if (allowedBranchIds && !allowedBranchIds.includes(branchId)) throw new SupplierApScopeError("Supplier AP record is outside your branch scope.");
}

function totalLines(lines: Array<{ lineTotal: Prisma.Decimal }>) {
  return lines.reduce((sum, line) => sum.plus(line.lineTotal), new Prisma.Decimal(0));
}

function money(value: number | string | Prisma.Decimal) {
  const amount = new Prisma.Decimal(value);
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 2 || amount.greaterThan("9999999999.99")) throw new Error("A valid MYR amount with no more than two decimals is required.");
  return amount;
}

function dateOnly(value: Date) {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new Error("A valid date is required.");
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function requiredReason(value: string) {
  const reason = cleanNullable(value);
  if (!reason || reason.length < 3 || reason.length > 500) throw new Error("A reason between 3 and 500 characters is required.");
  return reason;
}

function validateOperation(operationKey: string) {
  if (operationKey.trim().length < 16 || operationKey.length > 180) throw new Error("A valid supplier AP operation ID is required.");
}

function cleanNullable(value?: string | null) {
  const clean = value?.trim(); return clean || null;
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sortValue(entry)]));
  return value;
}

export function mapSupplierApError(error: unknown) {
  if (error instanceof SupplierApConflictError || error instanceof SupplierApScopeError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "Duplicate supplier invoice or operation blocked.";
  return error instanceof Error ? error.message : "Unable to complete supplier accounts-payable operation.";
}
