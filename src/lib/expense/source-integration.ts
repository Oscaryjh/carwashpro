import { createHash } from "node:crypto";
import { ExpenseSourceType, Prisma, type PrismaClient } from "@prisma/client";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { reconcileAccountsPayable } from "@/lib/inventory/supplier-ap-service";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { prisma } from "@/lib/prisma";
import {
  ExpenseDomainError,
  type ExpenseActor,
  materializeSourceExpense,
  markBusinessExpensePaid,
  voidBusinessExpense,
} from "./service";

export const EXPENSE_SOURCE_RECONCILIATION_FAILED =
  "EXPENSE_SOURCE_RECONCILIATION_FAILED";

export type ExpenseSourceSyncResult = Readonly<{
  expenseId?: string;
  status: "MATERIALIZED" | "UPDATED" | "VOIDED" | "IN_SYNC" | "SKIPPED" | "DEFERRED";
  reason?: string;
}>;

export async function saveExpenseIntegrationSettings(
  input: {
    actor: ExpenseActor;
    businessId: string;
    claimDefaultCategoryId: string | null;
    expectedRevision?: number | null;
    inventoryPurchaseCategoryId?: string | null;
    payrollCategoryId: string | null;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
) {
  if (!input.claimDefaultCategoryId && !input.payrollCategoryId && !input.inventoryPurchaseCategoryId) {
    throw new ExpenseDomainError(
      "Choose at least one explicit source category.",
      "EXPENSE_SOURCE_CATEGORY_REQUIRED",
    );
  }
  return database.$transaction(async (tx) => {
    const categoryIds = [input.claimDefaultCategoryId, input.payrollCategoryId, input.inventoryPurchaseCategoryId].filter(
      (value): value is string => Boolean(value),
    );
    const categories = await tx.expenseCategory.findMany({
      where: { active: true, businessId: input.businessId, id: { in: categoryIds } },
      select: { id: true },
    });
    if (categories.length !== new Set(categoryIds).size) {
      throw new ExpenseDomainError(
        "Every source mapping must use an active Expense category in this business.",
        "EXPENSE_SOURCE_CATEGORY_INVALID",
      );
    }
    const before = await tx.expenseIntegrationSetting.findUnique({
      where: { businessId: input.businessId },
    });
    if (before && input.expectedRevision !== null && input.expectedRevision !== undefined && before.revision !== input.expectedRevision) {
      throw new ExpenseDomainError(
        "Expense integration settings changed. Reload and try again.",
        "EXPENSE_INTEGRATION_SETTINGS_STALE",
      );
    }
    const setting = before
      ? await tx.expenseIntegrationSetting.update({
          where: { businessId: input.businessId },
          data: {
            claimDefaultCategoryId: input.claimDefaultCategoryId,
            inventoryPurchaseCategoryId: input.inventoryPurchaseCategoryId,
            payrollCategoryId: input.payrollCategoryId,
            revision: { increment: 1 },
            updatedById: input.actor.userId,
          },
        })
      : await tx.expenseIntegrationSetting.create({
          data: {
            businessId: input.businessId,
            claimDefaultCategoryId: input.claimDefaultCategoryId,
            inventoryPurchaseCategoryId: input.inventoryPurchaseCategoryId,
            payrollCategoryId: input.payrollCategoryId,
            updatedById: input.actor.userId,
          },
        });
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "EXPENSE_SOURCE_MAPPING_UPDATED",
      entityType: "ExpenseIntegrationSetting",
      entityId: input.businessId,
      summary: "Claims, Payroll and Inventory Purchase Expense source mappings updated.",
      before: before ? safeSetting(before) : undefined,
      after: safeSetting(setting),
    }, tx);
    return setting;
  }, { isolationLevel: "Serializable" });
}

export async function synchronizeClaimExpense(
  input: {
    actor: ExpenseActor;
    businessId: string;
    claimId: string;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
): Promise<ExpenseSourceSyncResult> {
  if (!(await isBusinessModuleEnabled(input.businessId, "EXPENSE", { database }))) {
    return { status: "SKIPPED", reason: "EXPENSE_MODULE_DISABLED" };
  }
  const claim = await database.employeeClaim.findFirst({
    where: { businessId: input.businessId, id: input.claimId },
    include: {
      attachments: { select: { id: true } },
      membership: { select: { fullName: true } },
      reimbursement: { include: { payrollSnapshots: { select: { settledAt: true, status: true } } } },
    },
  });
  if (!claim) return { status: "DEFERRED", reason: "CLAIM_NOT_FOUND" };

  const active = await database.businessExpense.findFirst({
    where: {
      businessId: input.businessId,
      sourceType: "CLAIM",
      sourceId: claim.reimbursement?.id,
      status: { not: "VOID" },
    },
  });
  if (claim.status === "CANCELLED" || claim.reimbursement?.status === "CANCELLED") {
    if (!active) return { status: "IN_SYNC" };
    await voidBusinessExpense({
      actor: input.actor,
      allowSystemSource: true,
      businessId: input.businessId,
      expenseId: active.id,
      expectedRevision: active.revision,
      operationKey: `EXPENSE_SOURCE_VOID:CLAIM:${claim.id}:${claim.revision}`,
      reason: "Canonical approved Claim was cancelled before reimbursement.",
      request: input.request,
    }, database);
    return { expenseId: active.id, status: "VOIDED" };
  }
  if (!["APPROVED", "PARTIALLY_APPROVED"].includes(claim.status) || !claim.reimbursement) {
    return { status: "IN_SYNC" };
  }
  const setting = await database.expenseIntegrationSetting.findUnique({
    where: { businessId: input.businessId },
  });
  if (!setting?.claimDefaultCategoryId) {
    return { status: "DEFERRED", reason: "CLAIM_EXPENSE_CATEGORY_NOT_CONFIGURED" };
  }
  const sourceRevision = String(claim.revision);
  const paid = ["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED"].includes(claim.reimbursement.status);
  const settledAt = claim.reimbursement.payrollSnapshots.find((snapshot) => snapshot.status === "SETTLED")?.settledAt;
  const paymentDate = claim.reimbursement.paidAt ?? settledAt ?? null;
  const expense = active?.sourceRevision === sourceRevision ? active : await materializeSourceExpense({
    actor: input.actor,
    amount: claim.reimbursement.amount,
    branchId: claim.branchId,
    businessId: input.businessId,
    categoryId: setting.claimDefaultCategoryId,
    description: `Employee Claim ${claim.claimNumber}`,
    expenseDate: (claim.reviewedAt ?? claim.updatedAt).toISOString().slice(0, 10),
    operationKey: `EXPENSE_SOURCE:CLAIM:${claim.reimbursement.id}:${sourceRevision}`,
    payeeName: claim.membership.fullName,
    paymentDate: paid && paymentDate ? paymentDate : null,
    paymentMethod: paid ? "OTHER" : null,
    paymentReference: paid ? claim.reimbursement.paymentReference : null,
    paymentStatus: paid ? "PAID" : "UNPAID",
    request: input.request,
    sourceId: claim.reimbursement.id,
    sourceRevision,
    sourceType: "CLAIM",
  }, database);
  const sourceDigest = digest({
    approvedAmount: claim.approvedTotal.toFixed(2),
    businessId: claim.businessId,
    claimId: claim.id,
    claimRevision: claim.revision,
    decisionDigest: claim.decisionDigest,
    reimbursementId: claim.reimbursement.id,
  });
  await createExpenseSourceSnapshotOnce(database, {
      approvedAmount: claim.approvedTotal,
      businessId: input.businessId,
      expenseId: expense.id,
      receiptAvailable: claim.attachments.length > 0,
      sourceDigest,
      sourceId: claim.reimbursement.id,
      sourceNumberSnapshot: claim.claimNumber,
      sourceRecordId: claim.id,
      sourceRevision,
      sourceStatusSnapshot: claim.status,
      sourceType: "CLAIM",
      submittedAmount: claim.submittedTotal,
      totalBusinessCost: claim.reimbursement.amount,
  });
  if (paid && expense.paymentStatus === "UNPAID" && paymentDate) {
    const updated = await markBusinessExpensePaid({
      actor: input.actor,
      allowSystemSource: true,
      businessId: input.businessId,
      expenseId: expense.id,
      expectedRevision: expense.revision,
      operationKey: `EXPENSE_SOURCE_PAID:CLAIM:${claim.reimbursement.id}:${claim.reimbursement.revision}`,
      paymentDate,
      paymentMethod: "OTHER",
      paymentReference: claim.reimbursement.paymentReference,
      request: input.request,
    }, database);
    return { expenseId: updated.id, status: "UPDATED" };
  }
  return { expenseId: expense.id, status: active ? "IN_SYNC" : "MATERIALIZED" };
}

export async function synchronizePayrollExpense(
  input: {
    actor: ExpenseActor;
    businessId: string;
    payrollRunId: string;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
): Promise<ExpenseSourceSyncResult> {
  if (!(await isBusinessModuleEnabled(input.businessId, "EXPENSE", { database }))) {
    return { status: "SKIPPED", reason: "EXPENSE_MODULE_DISABLED" };
  }
  const run = await database.payrollRun.findFirst({
    where: { businessId: input.businessId, id: input.payrollRunId },
    include: {
      entries: { select: { employerEis: true, employerEpf: true, employerSocso: true, grossPay: true } },
      claimReimbursementSnapshots: {
        where: { status: { in: ["READY", "SETTLED"] } },
        select: { amount: true },
      },
    },
  });
  if (!run) return { status: "DEFERRED", reason: "PAYROLL_RUN_NOT_FOUND" };
  const active = await database.businessExpense.findFirst({
    where: { businessId: input.businessId, sourceId: run.id, sourceType: "PAYROLL", status: { not: "VOID" } },
  });
  if (run.status !== "FINALIZED" || !run.finalizedAt) {
    if (!active) return { status: "IN_SYNC" };
    await voidBusinessExpense({
      actor: input.actor,
      allowSystemSource: true,
      businessId: input.businessId,
      expenseId: active.id,
      expectedRevision: active.revision,
      operationKey: `EXPENSE_SOURCE_VOID:PAYROLL:${run.id}:${active.sourceRevision}`,
      reason: "Canonical Payroll Run was reopened; the prior frozen cost representation is stale.",
      request: input.request,
    }, database);
    return { expenseId: active.id, status: "VOIDED" };
  }
  const setting = await database.expenseIntegrationSetting.findUnique({ where: { businessId: input.businessId } });
  if (!setting?.payrollCategoryId) {
    return { status: "DEFERRED", reason: "PAYROLL_EXPENSE_CATEGORY_NOT_CONFIGURED" };
  }
  const sourceRevision = run.finalizedAt.toISOString();
  if (active && active.sourceRevision !== sourceRevision) {
    await voidBusinessExpense({
      actor: input.actor,
      allowSystemSource: true,
      businessId: input.businessId,
      expenseId: active.id,
      expectedRevision: active.revision,
      operationKey: `EXPENSE_SOURCE_SUPERSEDE:PAYROLL:${run.id}:${active.sourceRevision}`,
      reason: "A newer finalized Payroll source revision superseded this representation.",
      request: input.request,
    }, database);
  }
  const cost = payrollCost(run.entries, run.claimReimbursementSnapshots);
  if (cost.totalBusinessCost.eq(0)) {
    return { status: "DEFERRED", reason: "PAYROLL_TOTAL_BUSINESS_COST_ZERO" };
  }
  const period = `${run.periodStart.toISOString().slice(0, 10)}..${run.periodEnd.toISOString().slice(0, 10)}`;
  const expense = await materializeSourceExpense({
    actor: input.actor,
    amount: cost.totalBusinessCost,
    branchId: null,
    businessId: input.businessId,
    categoryId: setting.payrollCategoryId,
    description: `Payroll & employer cost · ${period}`,
    expenseDate: run.periodEnd.toISOString().slice(0, 10),
    operationKey: `EXPENSE_SOURCE:PAYROLL:${run.id}:${sourceRevision}`,
    payeeName: "Payroll",
    request: input.request,
    sourceId: run.id,
    sourceRevision,
    sourceType: "PAYROLL",
  }, database);
  const sourceDigest = digest({
    businessId: input.businessId,
    employerContributionTotal: cost.employerContributionTotal.toFixed(2),
    entryCount: run.entries.length,
    excludedPassThrough: cost.excludedPassThrough.toFixed(2),
    finalizedAt: sourceRevision,
    grossRemuneration: cost.grossRemuneration.toFixed(2),
    payrollRunId: run.id,
    totalBusinessCost: cost.totalBusinessCost.toFixed(2),
  });
  await createExpenseSourceSnapshotOnce(database, {
      businessId: input.businessId,
      employerContributionTotal: cost.employerContributionTotal,
      excludedPassThrough: cost.excludedPassThrough,
      expenseId: expense.id,
      grossRemuneration: cost.grossRemuneration,
      otherEmployerCost: cost.otherEmployerCost,
      sourceDigest,
      sourceId: run.id,
      sourceNumberSnapshot: period,
      sourceRecordId: run.id,
      sourceRevision,
      sourceStatusSnapshot: run.status,
      sourceType: "PAYROLL",
      totalBusinessCost: cost.totalBusinessCost,
  });
  return { expenseId: expense.id, status: active?.sourceRevision === sourceRevision ? "IN_SYNC" : "MATERIALIZED" };
}

export async function synchronizeInventoryPurchaseExpense(
  input: {
    actor: ExpenseActor;
    businessId: string;
    supplierBillId: string;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
): Promise<ExpenseSourceSyncResult> {
  if (!(await isBusinessModuleEnabled(input.businessId, "EXPENSE", { database }))) {
    return { status: "SKIPPED", reason: "EXPENSE_MODULE_DISABLED" };
  }
  const bill = await database.supplierBill.findFirst({
    where: { businessId: input.businessId, id: input.supplierBillId },
    include: {
      attachment: { select: { id: true } },
      payments: { select: { amount: true, status: true } },
      supplier: { select: { name: true } },
    },
  });
  if (!bill) return { status: "DEFERRED", reason: "SUPPLIER_BILL_NOT_FOUND" };
  const active = await database.businessExpense.findFirst({
    where: { businessId: input.businessId, sourceType: "INVENTORY_PURCHASE", sourceId: bill.id, status: { not: "VOID" } },
  });
  if (bill.status === "DRAFT") return { status: "IN_SYNC" };
  if (bill.status === "VOID") {
    if (active) {
      await voidBusinessExpense({
        actor: input.actor,
        allowSystemSource: true,
        businessId: input.businessId,
        expenseId: active.id,
        expectedRevision: active.revision,
        operationKey: `EXPENSE_SOURCE_VOID:INVENTORY_PURCHASE:${bill.id}:${bill.revision}`,
        reason: "Canonical unpaid Supplier Bill was voided; historical spending representation retained.",
        request: input.request,
      }, database);
    }
    const expenseId = active?.id ?? (await database.businessExpense.findFirst({
      where: { businessId: input.businessId, sourceType: "INVENTORY_PURCHASE", sourceId: bill.id },
      orderBy: { createdAt: "desc" }, select: { id: true },
    }))?.id;
    if (expenseId) await upsertInventorySettlement(database, expenseId, bill);
    return { expenseId, status: active ? "VOIDED" : "IN_SYNC" };
  }
  if (bill.status !== "CONFIRMED" || bill.confirmedRevision === null) return { status: "DEFERRED", reason: "SUPPLIER_BILL_CONFIRMATION_INCOMPLETE" };
  const setting = await database.expenseIntegrationSetting.findUnique({ where: { businessId: input.businessId } });
  let categoryId = setting?.inventoryPurchaseCategoryId ?? null;
  if (!categoryId) {
    const category = await database.expenseCategory.findFirst({ where: { businessId: input.businessId, active: true, code: "INVENTORY_PURCHASES" }, select: { id: true } });
    categoryId = category?.id ?? null;
  }
  if (!categoryId) return { status: "DEFERRED", reason: "INVENTORY_PURCHASE_EXPENSE_CATEGORY_NOT_CONFIGURED" };
  const sourceRevision = String(bill.confirmedRevision);
  const expense = active?.sourceRevision === sourceRevision ? active : await materializeSourceExpense({
    actor: input.actor,
    amount: bill.totalAmount,
    branchId: bill.branchId,
    businessId: input.businessId,
    categoryId,
    description: `Inventory Purchase · Supplier Bill ${bill.billNumber}`,
    expenseDate: bill.invoiceDate.toISOString().slice(0, 10),
    operationKey: `EXPENSE_SOURCE:INVENTORY_PURCHASE:${bill.id}:${sourceRevision}`,
    payeeName: bill.supplier.name,
    sourceId: bill.id,
    sourceRevision,
    sourceType: "INVENTORY_PURCHASE",
    request: input.request,
  }, database);
  await createExpenseSourceSnapshotOnce(database, {
    businessId: input.businessId,
    expenseId: expense.id,
    receiptAvailable: Boolean(bill.attachment),
    sourceDigest: inventoryPurchaseDigest(bill),
    sourceId: bill.id,
    sourceNumberSnapshot: bill.billNumber,
    sourceRecordId: bill.id,
    sourceRevision,
    sourceStatusSnapshot: bill.status,
    sourceType: "INVENTORY_PURCHASE",
    totalBusinessCost: bill.totalAmount,
  });
  await upsertInventorySettlement(database, expense.id, bill);
  return { expenseId: expense.id, status: active ? "UPDATED" : "MATERIALIZED" };
}

async function upsertInventorySettlement(
  database: PrismaClient,
  expenseId: string,
  bill: { businessId: string; confirmedRevision: number | null; id: string; paymentStatus: string; payments: ReadonlyArray<{ amount: Prisma.Decimal; status: string }>; revision: number; status: string; totalAmount: Prisma.Decimal; updatedAt: Date },
) {
  const sourceRevision = String(bill.confirmedRevision ?? bill.revision);
  const paidAmount = bill.payments.filter((payment) => payment.status === "COMPLETED").reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
  const outstandingAmount = bill.status === "CONFIRMED" ? bill.totalAmount.sub(paidAmount) : new Prisma.Decimal(0);
  const settlementStatus = bill.status === "VOID" ? "VOID" : paidAmount.eq(0) ? "UNPAID" : paidAmount.eq(bill.totalAmount) ? "PAID" : "PARTIALLY_PAID";
  return database.expenseSourceSettlement.upsert({
    where: { expenseId },
    create: { businessId: bill.businessId, expenseId, outstandingAmount, paidAmount, settlementStatus, sourceDigest: digest({ billRevision: bill.revision, outstandingAmount: outstandingAmount.toFixed(2), paidAmount: paidAmount.toFixed(2), settlementStatus }), sourceId: bill.id, sourceRevision, sourceStatus: bill.status, sourceType: "INVENTORY_PURCHASE", sourceUpdatedAt: bill.updatedAt },
    update: { outstandingAmount, paidAmount, settlementStatus, sourceDigest: digest({ billRevision: bill.revision, outstandingAmount: outstandingAmount.toFixed(2), paidAmount: paidAmount.toFixed(2), settlementStatus }), sourceStatus: bill.status, sourceUpdatedAt: bill.updatedAt },
  });
}

function inventoryPurchaseDigest(bill: { branchId: string; businessId: string; confirmedRevision: number | null; id: string; invoiceDate: Date; supplierId: string; totalAmount: Prisma.Decimal }) {
  return digest({ branchId: bill.branchId, businessId: bill.businessId, confirmedRevision: bill.confirmedRevision, invoiceDate: bill.invoiceDate.toISOString().slice(0, 10), supplierBillId: bill.id, supplierId: bill.supplierId, totalAmount: bill.totalAmount.toFixed(2) });
}

export type ExpenseReconciliationIssue = Readonly<{
  code:
    | "MISSING_EXPENSE"
    | "DUPLICATE_ACTIVE_EXPENSE"
    | "WRONG_AMOUNT"
    | "WRONG_BRANCH"
    | "WRONG_PAYMENT_STATE"
    | "WRONG_PAID_AMOUNT"
    | "WRONG_OUTSTANDING_AMOUNT"
    | "MISSING_SETTLEMENT_PROJECTION"
    | "LEGACY_CONFIRMATION_REVISION_REQUIRED"
    | "SOURCE_AP_MATCH_ISSUE"
    | "WRONG_SOURCE_REVISION"
    | "MISSING_SOURCE_SNAPSHOT"
    | "STALE_SOURCE_EXPENSE";
  sourceId: string;
  sourceType: "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE";
}>;

export async function reconcileExpenseSources(
  input: {
    actor?: ExpenseActor;
    businessId: string;
    repair?: boolean;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
) {
  const [claims, runs, bills, expenses] = await Promise.all([
    database.employeeClaim.findMany({
      where: { businessId: input.businessId, status: { in: ["APPROVED", "PARTIALLY_APPROVED", "CANCELLED"] } },
      include: { reimbursement: true },
    }),
    database.payrollRun.findMany({ where: { businessId: input.businessId }, include: { entries: true, claimReimbursementSnapshots: true } }),
    database.supplierBill.findMany({ where: { businessId: input.businessId, status: { in: ["CONFIRMED", "VOID"] } }, include: { payments: true, lines: true } }),
    database.businessExpense.findMany({
      where: { businessId: input.businessId, sourceType: { in: ["CLAIM", "PAYROLL", "INVENTORY_PURCHASE"] } },
      include: { sourceSettlement: true, sourceSnapshot: true },
    }),
  ]);
  const issues: ExpenseReconciliationIssue[] = [];
  for (const claim of claims) {
    if (!claim.reimbursement) continue;
    const active = expenses.filter((expense) => expense.sourceType === "CLAIM" && expense.sourceId === claim.reimbursement!.id && expense.status !== "VOID");
    const expectedActive = claim.status !== "CANCELLED";
    if (expectedActive && !active.length) issues.push({ code: "MISSING_EXPENSE", sourceId: claim.id, sourceType: "CLAIM" });
    if (active.length > 1) issues.push({ code: "DUPLICATE_ACTIVE_EXPENSE", sourceId: claim.id, sourceType: "CLAIM" });
    if (!expectedActive && active.length) issues.push({ code: "STALE_SOURCE_EXPENSE", sourceId: claim.id, sourceType: "CLAIM" });
    for (const expense of active) {
      if (!expense.amount.eq(claim.approvedTotal)) issues.push({ code: "WRONG_AMOUNT", sourceId: claim.id, sourceType: "CLAIM" });
      if (expense.branchId !== claim.branchId) issues.push({ code: "WRONG_BRANCH", sourceId: claim.id, sourceType: "CLAIM" });
      if (expense.sourceRevision !== String(claim.revision)) issues.push({ code: "WRONG_SOURCE_REVISION", sourceId: claim.id, sourceType: "CLAIM" });
      const shouldBePaid = ["OUTSIDE_PAYROLL_PAID", "PAYROLL_SETTLED"].includes(claim.reimbursement.status);
      if ((expense.paymentStatus === "PAID") !== shouldBePaid) issues.push({ code: "WRONG_PAYMENT_STATE", sourceId: claim.id, sourceType: "CLAIM" });
      if (!expense.sourceSnapshot) issues.push({ code: "MISSING_SOURCE_SNAPSHOT", sourceId: claim.id, sourceType: "CLAIM" });
    }
  }
  for (const run of runs) {
    const active = expenses.filter((expense) => expense.sourceType === "PAYROLL" && expense.sourceId === run.id && expense.status !== "VOID");
    const expectedActive = run.status === "FINALIZED" && Boolean(run.finalizedAt);
    if (expectedActive && !active.length) issues.push({ code: "MISSING_EXPENSE", sourceId: run.id, sourceType: "PAYROLL" });
    if (active.length > 1) issues.push({ code: "DUPLICATE_ACTIVE_EXPENSE", sourceId: run.id, sourceType: "PAYROLL" });
    if (!expectedActive && active.length) issues.push({ code: "STALE_SOURCE_EXPENSE", sourceId: run.id, sourceType: "PAYROLL" });
    if (expectedActive) {
      const expected = payrollCost(run.entries, run.claimReimbursementSnapshots.filter((snapshot) => ["READY", "SETTLED"].includes(snapshot.status)));
      for (const expense of active) {
        if (!expense.amount.eq(expected.totalBusinessCost)) issues.push({ code: "WRONG_AMOUNT", sourceId: run.id, sourceType: "PAYROLL" });
        if (expense.branchId !== null) issues.push({ code: "WRONG_BRANCH", sourceId: run.id, sourceType: "PAYROLL" });
        if (expense.sourceRevision !== run.finalizedAt!.toISOString()) issues.push({ code: "WRONG_SOURCE_REVISION", sourceId: run.id, sourceType: "PAYROLL" });
        if (!expense.sourceSnapshot) issues.push({ code: "MISSING_SOURCE_SNAPSHOT", sourceId: run.id, sourceType: "PAYROLL" });
      }
    }
  }
  for (const bill of bills) {
    const active = expenses.filter((expense) => expense.sourceType === "INVENTORY_PURCHASE" && expense.sourceId === bill.id && expense.status !== "VOID");
    const expectedActive = bill.status === "CONFIRMED";
    if (bill.confirmedRevision === null) issues.push({ code: "LEGACY_CONFIRMATION_REVISION_REQUIRED", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
    if (expectedActive && !active.length) issues.push({ code: "MISSING_EXPENSE", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
    if (active.length > 1) issues.push({ code: "DUPLICATE_ACTIVE_EXPENSE", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
    if (!expectedActive && active.length) issues.push({ code: "STALE_SOURCE_EXPENSE", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
    const paid = bill.payments.filter((payment) => payment.status === "COMPLETED").reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
    const outstanding = bill.status === "CONFIRMED" ? bill.totalAmount.sub(paid) : new Prisma.Decimal(0);
    for (const expense of active) {
      if (!expense.amount.eq(bill.totalAmount)) issues.push({ code: "WRONG_AMOUNT", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      if (expense.branchId !== bill.branchId) issues.push({ code: "WRONG_BRANCH", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      if (expense.sourceRevision !== String(bill.confirmedRevision)) issues.push({ code: "WRONG_SOURCE_REVISION", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      if (!expense.sourceSnapshot) issues.push({ code: "MISSING_SOURCE_SNAPSHOT", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      if (!expense.sourceSettlement) issues.push({ code: "MISSING_SETTLEMENT_PROJECTION", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      else {
        if (!expense.sourceSettlement.paidAmount.eq(paid)) issues.push({ code: "WRONG_PAID_AMOUNT", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
        if (!expense.sourceSettlement.outstandingAmount.eq(outstanding)) issues.push({ code: "WRONG_OUTSTANDING_AMOUNT", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
        if (expense.sourceSettlement.settlementStatus !== bill.paymentStatus) issues.push({ code: "WRONG_PAYMENT_STATE", sourceId: bill.id, sourceType: "INVENTORY_PURCHASE" });
      }
    }
  }
  const apReport = await reconcileAccountsPayable({ businessId: input.businessId, allowedBranchIds: null });
  for (const issue of apReport.issues) {
    issues.push({ code: "SOURCE_AP_MATCH_ISSUE", sourceId: issue.entityId, sourceType: "INVENTORY_PURCHASE" });
  }
  if (input.repair) {
    if (!input.actor) throw new ExpenseDomainError("Repair requires an authorised actor.", "EXPENSE_REPAIR_ACTOR_REQUIRED");
    for (const claim of claims) await synchronizeClaimExpense({ ...input, actor: input.actor, claimId: claim.id }, database);
    for (const run of runs) await synchronizePayrollExpense({ ...input, actor: input.actor, payrollRunId: run.id }, database);
    for (const bill of bills) await synchronizeInventoryPurchaseExpense({ ...input, actor: input.actor, supplierBillId: bill.id }, database);
    await writeAuditLog({
      businessId: input.businessId,
      actor: input.actor,
      request: input.request,
      action: "EXPENSE_SOURCE_RECONCILIATION_REPAIRED",
      entityType: "ExpenseSourceReconciliation",
      entityId: input.businessId,
      summary: `Expense source reconciliation repair processed ${issues.length} detected issue(s).`,
      after: { detectedIssueCount: issues.length, sourceTypes: ["CLAIM", "PAYROLL", "INVENTORY_PURCHASE"] },
    }, database);
  }
  return { healthy: issues.length === 0, issues, repairApplied: Boolean(input.repair) };
}

export async function assertExpenseSourceReconciliation(businessId: string, database: PrismaClient = prisma) {
  const report = await reconcileExpenseSources({ businessId }, database);
  if (!report.healthy) throw new ExpenseDomainError(EXPENSE_SOURCE_RECONCILIATION_FAILED, EXPENSE_SOURCE_RECONCILIATION_FAILED);
  return report;
}

export async function trySynchronizeClaimExpense(input: Parameters<typeof synchronizeClaimExpense>[0]) {
  try { return await synchronizeClaimExpense(input); }
  catch (error) { return { status: "DEFERRED", reason: safeReason(error) } as const; }
}

export async function trySynchronizePayrollExpense(input: Parameters<typeof synchronizePayrollExpense>[0]) {
  try { return await synchronizePayrollExpense(input); }
  catch (error) { return { status: "DEFERRED", reason: safeReason(error) } as const; }
}

export async function trySynchronizeInventoryPurchaseExpense(input: Parameters<typeof synchronizeInventoryPurchaseExpense>[0]) {
  try { return await synchronizeInventoryPurchaseExpense(input); }
  catch (error) { return { status: "DEFERRED", reason: safeReason(error) } as const; }
}

function payrollCost(
  entries: ReadonlyArray<{ employerEis: Prisma.Decimal; employerEpf: Prisma.Decimal; employerSocso: Prisma.Decimal; grossPay: Prisma.Decimal }>,
  reimbursements: ReadonlyArray<{ amount: Prisma.Decimal }>,
) {
  const wages = entries.reduce((sum, entry) => sum.add(entry.grossPay), new Prisma.Decimal(0));
  const excludedPassThrough = reimbursements.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
  const grossRemuneration = wages.add(excludedPassThrough);
  const employerContributionTotal = entries.reduce(
    (sum, entry) => sum.add(entry.employerEpf).add(entry.employerSocso).add(entry.employerEis),
    new Prisma.Decimal(0),
  );
  const otherEmployerCost = new Prisma.Decimal(0);
  return {
    employerContributionTotal,
    excludedPassThrough,
    grossRemuneration,
    otherEmployerCost,
    totalBusinessCost: grossRemuneration.add(employerContributionTotal).add(otherEmployerCost).sub(excludedPassThrough),
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
async function createExpenseSourceSnapshotOnce(
  database: PrismaClient,
  data: Prisma.ExpenseSourceSnapshotUncheckedCreateInput,
) {
  try {
    return await database.expenseSourceSnapshot.create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return database.expenseSourceSnapshot.findUniqueOrThrow({ where: { expenseId: data.expenseId } });
    }
    throw error;
  }
}
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
function safeReason(error: unknown) {
  return error instanceof ExpenseDomainError ? error.code : "EXPENSE_SOURCE_ADAPTER_FAILED";
}
function safeSetting(value: { claimDefaultCategoryId: string | null; inventoryPurchaseCategoryId: string | null; payrollCategoryId: string | null; revision: number }) {
  return { claimDefaultCategoryId: value.claimDefaultCategoryId, inventoryPurchaseCategoryId: value.inventoryPurchaseCategoryId, payrollCategoryId: value.payrollCategoryId, revision: value.revision };
}

export function expenseSourceLabel(sourceType: ExpenseSourceType) {
  if (sourceType === "CLAIM") return "Claims";
  if (sourceType === "PAYROLL") return "Payroll";
  if (sourceType === "INVENTORY_PURCHASE") return "Inventory Purchases";
  if (sourceType === "MANUAL") return "Manual";
  return sourceType.replaceAll("_", " ");
}
