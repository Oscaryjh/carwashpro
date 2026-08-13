import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  reconcileExpenseSources,
  saveExpenseIntegrationSettings,
  synchronizeClaimExpense,
  synchronizeInventoryPurchaseExpense,
  synchronizePayrollExpense,
} from "../../src/lib/expense/source-integration";
import {
  createBusinessExpense,
  ensureStarterExpenseCategories,
  getExpenseDashboard,
  markBusinessExpensePaid,
} from "../../src/lib/expense/service";
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder } from "../../src/lib/inventory/purchasing-service";
import { confirmSupplierBill, createSupplierBillDraft } from "../../src/lib/inventory/supplier-ap-service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("Claim and finalized Payroll materialize exactly once with payment, reversal, pass-through exclusion and reconciliation", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { industryType: "SALON_BEAUTY", name: `Expense P2A ${token}`, slug: `expense-p2a-${token}` } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: `P2A Branch ${token}` } });
  const owner = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.p2a.${token}@local.test`, name: "Expense P2A Owner", role: "BUSINESS_OWNER" } });
  const actor = { email: owner.email!, name: owner.name, userId: owner.id };
  const inventoryReviewer = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.p2b.reviewer.${token}@local.test`, name: "Expense P2B Reviewer", role: "BUSINESS_OWNER" } });
  const inventoryReviewerActor = { email: inventoryReviewer.email!, name: inventoryReviewer.name, userId: inventoryReviewer.id };
  await prisma.businessModuleEntitlement.createMany({ data: ["POS", "HR", "CLAIMS", "PAYROLL", "INVENTORY", "EXPENSE"].map((moduleKey) => ({ businessId: business.id, moduleKey: moduleKey as "HR", status: "ENABLED" as const, enabledFrom: new Date("2026-01-01T00:00:00.000Z"), source: "MANUAL" as const })) });
  await ensureStarterExpenseCategories(business.id, prisma);
  const [claimCategory, payrollCategory, inventoryPurchaseCategory, manualCategory] = await Promise.all([
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Employee Claims" } }),
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Payroll & Employee Cost" } }),
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Inventory Purchases" } }),
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Marketing" } }),
  ]);
  await saveExpenseIntegrationSettings({ actor, businessId: business.id, claimDefaultCategoryId: claimCategory.id, inventoryPurchaseCategoryId: inventoryPurchaseCategory.id, payrollCategoryId: payrollCategory.id }, prisma);
  const phone = `+6017${String(Date.now()).slice(-8)}`;
  const account = await prisma.employeeAccount.create({ data: { name: "P2A Employee", phoneNumber: phone, phoneNormalized: phone } });
  const membership = await prisma.employeeBusinessMembership.create({ data: { employeeAccountId: account.id, businessId: business.id, employeeCode: `P2A-${token}`, fullName: "P2A Employee", phoneNumber: phone, phoneNumberNormalized: phone, joinedAt: new Date("2025-01-01T00:00:00.000Z") } });
  await prisma.employeeBranchAssignment.create({ data: { branchId: branch.id, businessId: business.id, canClockIn: false, effectiveFrom: new Date("2025-01-01T00:00:00.000Z"), isPrimary: true, membershipId: membership.id } });

  const claim = await createApprovedClaim({ businessId: business.id, branchId: branch.id, membershipId: membership.id, number: `CLM-P2A-${token}`, amount: "100.00" });
  const first = await synchronizeClaimExpense({ actor, businessId: business.id, claimId: claim.id }, prisma);
  const replay = await synchronizeClaimExpense({ actor, businessId: business.id, claimId: claim.id }, prisma);
  assert.equal(first.expenseId, replay.expenseId);
  const claimExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: first.expenseId }, include: { sourceSnapshot: true } });
  assert.equal(claimExpense.amount.toFixed(2), "100.00");
  assert.equal(claimExpense.branchId, branch.id);
  assert.equal(claimExpense.paymentStatus, "UNPAID");
  assert.equal(claimExpense.sourceSnapshot?.approvedAmount?.toFixed(2), "100.00");
  await assert.rejects(
    prisma.$executeRaw`UPDATE "expense_source_snapshots" SET "source_status_snapshot" = 'MUTATED' WHERE "expense_id" = ${claimExpense.id}::uuid`,
    /ExpenseSourceSnapshot is immutable/,
  );

  await prisma.claimReimbursement.update({ where: { claimId: claim.id }, data: { channel: "OUTSIDE_PAYROLL", paidAt: new Date("2026-08-12T03:00:00.000Z"), paymentReference: "LOCAL-P2A-PAID", revision: { increment: 1 }, status: "OUTSIDE_PAYROLL_PAID" } });
  await synchronizeClaimExpense({ actor, businessId: business.id, claimId: claim.id }, prisma);
  const paidClaimExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: first.expenseId } });
  assert.equal(paidClaimExpense.paymentStatus, "PAID");
  await assert.rejects(markBusinessExpensePaid({ actor, businessId: business.id, expenseId: paidClaimExpense.id, expectedRevision: paidClaimExpense.revision, operationKey: `MANUAL-SOURCE-PAY:${token}`, paymentDate: "2026-08-12", paymentMethod: "OTHER" }, prisma), /source domain/i);

  const cancelledClaim = await createApprovedClaim({ businessId: business.id, branchId: branch.id, membershipId: membership.id, number: `CLM-CANCEL-${token}`, amount: "40.00" });
  const cancelledExpense = await synchronizeClaimExpense({ actor, businessId: business.id, claimId: cancelledClaim.id }, prisma);
  await prisma.$transaction([
    prisma.employeeClaim.update({ where: { id: cancelledClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
    prisma.claimReimbursement.update({ where: { claimId: cancelledClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
  ]);
  await synchronizeClaimExpense({ actor, businessId: business.id, claimId: cancelledClaim.id }, prisma);
  assert.equal((await prisma.businessExpense.findUniqueOrThrow({ where: { id: cancelledExpense.expenseId } })).status, "VOID");

  const run = await createFinalizedPayroll({ businessId: business.id, membershipId: membership.id, ownerId: owner.id, token });
  const payroll = await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: run.id }, prisma);
  const payrollExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: payroll.expenseId }, include: { sourceSnapshot: true } });
  assert.equal(payrollExpense.amount.toFixed(2), "3000.00");
  assert.equal(payrollExpense.branchId, null);
  assert.equal(payrollExpense.paymentStatus, "UNPAID");
  assert.equal(payrollExpense.sourceSnapshot?.employerContributionTotal?.toFixed(2), "0.00");

  await createBusinessExpense({ actor, amount: "1500.00", branchId: branch.id, businessId: business.id, categoryId: manualCategory.id, description: "Phase 2A dashboard fixture", desiredStatus: "CONFIRMED", expenseDate: "2026-08-11", operationKey: `P2A-MANUAL:${token}`, paymentStatus: "PAID", paymentDate: "2026-08-11", paymentMethod: "CARD" }, prisma);
  const inventoryProduct = await prisma.product.create({ data: { businessId: business.id, costPrice: 20, name: `P2B Dashboard Product ${token}`, price: 30, sku: `P2B-${token}`, trackInventory: true } });
  const inventorySupplier = await createSupplier({ actor, businessId: business.id, name: `P2B Dashboard Supplier ${token}`, operationKey: `P2B:${token}:SUPPLIER:001` });
  const inventoryPo = await createPurchaseOrder({ actor, branchId: branch.id, businessId: business.id, lines: [{ expectedUnitCost: 20, orderedQuantity: 6, productId: inventoryProduct.id }], operationKey: `P2B:${token}:PO:00000001`, orderDate: new Date("2026-08-11T00:00:00.000Z"), supplierId: inventorySupplier.id });
  const approvedInventoryPo = await approvePurchaseOrder({ actor: inventoryReviewerActor, businessId: business.id, expectedRevision: inventoryPo.revision, operationKey: `P2B:${token}:PO-APPROVE:01`, purchaseOrderId: inventoryPo.id });
  await receivePurchaseOrder({ actor, businessId: business.id, lines: [{ purchaseOrderLineId: approvedInventoryPo.lines[0].id, quantity: 6 }], operationKey: `P2B:${token}:RECEIPT:0001`, purchaseOrderId: inventoryPo.id });
  const inventoryBill = await createSupplierBillDraft({ actor, allowedBranchIds: [branch.id], branchId: branch.id, businessId: business.id, dueDate: new Date("2026-09-11T00:00:00.000Z"), invoiceDate: new Date("2026-08-11T00:00:00.000Z"), lines: [{ purchaseOrderLineId: approvedInventoryPo.lines[0].id, billedQuantity: 6, unitPrice: 20 }], operationKey: `P2B:${token}:BILL:000001`, purchaseOrderId: inventoryPo.id, supplierInvoiceNumber: `P2B-${token}-INV-1` });
  await confirmSupplierBill({ actor: inventoryReviewerActor, allowedBranchIds: [branch.id], allowOwnerSelfConfirm: false, billId: inventoryBill.id, businessId: business.id, expectedRevision: inventoryBill.revision, operationKey: `P2B:${token}:CONFIRM:001`, priceVarianceAcknowledged: false });
  await synchronizeInventoryPurchaseExpense({ actor: inventoryReviewerActor, businessId: business.id, supplierBillId: inventoryBill.id }, prisma);
  const dashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma);
  assert.equal(dashboard.recorded, "4720.00");
  assert.equal(dashboard.bySource.find((row) => row.sourceType === "MANUAL")?.amount, "1500.00");
  assert.equal(dashboard.bySource.find((row) => row.sourceType === "CLAIM")?.amount, "100.00");
  assert.equal(dashboard.bySource.find((row) => row.sourceType === "PAYROLL")?.amount, "3000.00");
  assert.equal(dashboard.bySource.find((row) => row.sourceType === "INVENTORY_PURCHASE")?.amount, "120.00");

  const payrollClaim = await createApprovedClaim({ businessId: business.id, branchId: branch.id, membershipId: membership.id, number: `CLM-PASS-${token}`, amount: "100.00" });
  await prisma.claimReimbursement.update({ where: { claimId: payrollClaim.id }, data: { channel: "PAYROLL", revision: { increment: 1 }, status: "PAYROLL_LINKED" } });
  await synchronizeClaimExpense({ actor, businessId: business.id, claimId: payrollClaim.id }, prisma);
  const passThroughRun = await createPassThroughPayroll({ businessId: business.id, claimId: payrollClaim.id, claimNumber: payrollClaim.claimNumber, membershipId: membership.id, ownerId: owner.id, reimbursementId: payrollClaim.reimbursement!.id, token });
  const passThrough = await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: passThroughRun.id }, prisma);
  const passThroughExpense = await prisma.businessExpense.findUniqueOrThrow({ where: { id: passThrough.expenseId }, include: { sourceSnapshot: true } });
  assert.equal(passThroughExpense.sourceSnapshot?.grossRemuneration?.toFixed(2), "3100.00");
  assert.equal(passThroughExpense.sourceSnapshot?.employerContributionTotal?.toFixed(2), "450.00");
  assert.equal(passThroughExpense.sourceSnapshot?.excludedPassThrough?.toFixed(2), "100.00");
  assert.equal(passThroughExpense.amount.toFixed(2), "3450.00");

  const concurrentClaim = await createApprovedClaim({ businessId: business.id, branchId: branch.id, membershipId: membership.id, number: `CLM-RACE-${token}`, amount: "25.00" });
  const concurrentResults = await Promise.allSettled([
    synchronizeClaimExpense({ actor, businessId: business.id, claimId: concurrentClaim.id }, prisma),
    synchronizeClaimExpense({ actor, businessId: business.id, claimId: concurrentClaim.id }, prisma),
  ]);
  assert.ok(concurrentResults.some((result) => result.status === "fulfilled"));
  assert.equal(await prisma.businessExpense.count({
    where: { businessId: business.id, sourceType: "CLAIM", sourceId: concurrentClaim.reimbursement!.id, status: { not: "VOID" } },
  }), 1);

  const health = await reconcileExpenseSources({ businessId: business.id }, prisma);
  assert.equal(health.healthy, true, JSON.stringify(health.issues));
  assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id, sourceType: "CLAIM", sourceId: claim.reimbursement!.id, status: { not: "VOID" } } }), 1);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${run.id}, TRUE)`;
    await tx.payrollRun.update({ where: { id: run.id }, data: { finalizedAt: null, finalizedById: null, status: "DRAFT", submittedAt: null, submittedById: null } });
  });
  await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: run.id }, prisma);
  assert.equal((await prisma.businessExpense.findUniqueOrThrow({ where: { id: payrollExpense.id } })).status, "VOID");

  await prisma.payrollRun.update({
    where: { id: run.id },
    data: { status: "REVIEW", submittedAt: new Date("2026-09-01T08:00:00.000Z"), submittedById: owner.id },
  });
  await prisma.payrollRun.update({
    where: { id: run.id },
    data: { finalizedAt: new Date("2026-09-01T09:00:00.000Z"), finalizedById: owner.id, status: "FINALIZED" },
  });
  const refinalized = await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: run.id }, prisma);
  assert.notEqual(refinalized.expenseId, payrollExpense.id);
  assert.equal(await prisma.businessExpense.count({
    where: { businessId: business.id, sourceType: "PAYROLL", sourceId: run.id, status: { not: "VOID" } },
  }), 1);

  await prisma.$transaction([
    prisma.employeeClaim.update({ where: { id: payrollClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
    prisma.claimReimbursement.update({ where: { claimId: payrollClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
    prisma.employeeClaim.update({ where: { id: concurrentClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
    prisma.claimReimbursement.update({ where: { claimId: concurrentClaim.id }, data: { revision: { increment: 1 }, status: "CANCELLED" } }),
  ]);
  await synchronizeClaimExpense({ actor, businessId: business.id, claimId: payrollClaim.id }, prisma);
  await synchronizeClaimExpense({ actor, businessId: business.id, claimId: concurrentClaim.id }, prisma);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('tetamu.payroll_reopen', ${passThroughRun.id}, TRUE)`;
    await tx.payrollRun.update({ where: { id: passThroughRun.id }, data: { finalizedAt: null, finalizedById: null, status: "DRAFT", submittedAt: null, submittedById: null } });
  });
  await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: passThroughRun.id }, prisma);
  const finalDashboard = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: true }, prisma);
  assert.equal(finalDashboard.recorded, "4720.00");
  assert.equal((await reconcileExpenseSources({ businessId: business.id }, prisma)).healthy, true);
});

test("Claims and Payroll adapters skip safely while Expense entitlement is disabled", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { industryType: "SALON_BEAUTY", name: `Expense Disabled ${token}`, slug: `expense-disabled-${token}` } });
  await prisma.businessModuleEntitlement.createMany({
    data: ["HR", "CLAIMS", "PAYROLL"].map((moduleKey) => ({
      businessId: business.id,
      enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
      moduleKey: moduleKey as "HR",
      source: "MANUAL" as const,
      status: "ENABLED" as const,
    })),
  });
  const actor = { email: `disabled.${token}@local.test`, name: "Disabled Adapter QA", userId: randomUUID() };
  assert.deepEqual(await synchronizeClaimExpense({ actor, businessId: business.id, claimId: randomUUID() }, prisma), {
    reason: "EXPENSE_MODULE_DISABLED",
    status: "SKIPPED",
  });
  assert.deepEqual(await synchronizePayrollExpense({ actor, businessId: business.id, payrollRunId: randomUUID() }, prisma), {
    reason: "EXPENSE_MODULE_DISABLED",
    status: "SKIPPED",
  });
  assert.equal(await prisma.businessExpense.count({ where: { businessId: business.id } }), 0);
});

async function createApprovedClaim(input: { amount: string; branchId: string; businessId: string; membershipId: string; number: string }) {
  return prisma.employeeClaim.create({
    data: {
      approvedTotal: input.amount,
      branchId: input.branchId,
      businessId: input.businessId,
      claimNumber: input.number,
      clientRequestId: randomUUID(),
      decisionDigest: "a".repeat(64),
      membershipId: input.membershipId,
      purpose: "Local Phase 2A fixture",
      reimbursement: { create: { amount: input.amount, status: "AWAITING_CHANNEL" } },
      reviewedAt: new Date("2026-08-11T02:00:00.000Z"),
      revision: 2,
      status: "APPROVED",
      submittedAt: new Date("2026-08-10T02:00:00.000Z"),
      submittedTotal: input.amount,
    },
    include: { reimbursement: true },
  });
}

async function createFinalizedPayroll(input: { businessId: string; membershipId: string; ownerId: string; token: string }) {
  const run = await prisma.payrollRun.create({ data: { attendanceSource: "LEGACY_OPERATIONAL_SESSION", breakMinutesPerDaySnapshot: 60, businessId: input.businessId, createdById: input.ownerId, normalWorkMinutesPerDaySnapshot: 480, overtimeMultiplierSnapshot: "1.50", periodEnd: new Date("2026-08-31T00:00:00.000Z"), periodStart: new Date("2026-08-01T00:00:00.000Z"), publicHolidayExtraMultiplierSnapshot: "2.00", status: "DRAFT", workingDaysPerMonthSnapshot: 26 } });
  await prisma.$transaction(async (tx) => {
    const entry = await tx.payrollEntry.create({ data: { baseRateSnapshot: "3000.00", basicPay: "3000.00", businessId: input.businessId, employeeCodeSnapshot: `P2A-${input.token}`, fullNameSnapshot: "P2A Employee", grossPay: "3000.00", membershipId: input.membershipId, netPay: "3000.00", normalWorkMinutesSnapshot: 480, payBasisSnapshot: "MONTHLY", payrollRunId: run.id, workingDaysSnapshot: 26 } });
    await tx.payrollEntryComponent.create({ data: { amount: "3000.00", businessId: input.businessId, calculationBasis: "LOCAL_PHASE_2A", code: "P2A_FIXTURE", createdById: input.ownerId, lineKey: "SYSTEM:P2A_FIXTURE", membershipId: input.membershipId, name: "P2A fixture wage", origin: "SYSTEM", payrollEntryId: entry.id, payrollRunId: run.id, sortOrder: 100, sourceType: "PAYROLL_CALCULATION", type: "EARNING" } });
  });
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "REVIEW", submittedAt: new Date("2026-08-30T10:00:00.000Z"), submittedById: input.ownerId } });
  return prisma.payrollRun.update({ where: { id: run.id }, data: { finalizedAt: new Date("2026-08-31T10:00:00.000Z"), finalizedById: input.ownerId, status: "FINALIZED" } });
}

async function createPassThroughPayroll(input: { businessId: string; claimId: string; claimNumber: string; membershipId: string; ownerId: string; reimbursementId: string; token: string }) {
  const run = await prisma.payrollRun.create({ data: { attendanceSource: "LEGACY_OPERATIONAL_SESSION", breakMinutesPerDaySnapshot: 60, businessId: input.businessId, createdById: input.ownerId, normalWorkMinutesPerDaySnapshot: 480, overtimeMultiplierSnapshot: "1.50", periodEnd: new Date("2026-09-30T00:00:00.000Z"), periodStart: new Date("2026-09-01T00:00:00.000Z"), publicHolidayExtraMultiplierSnapshot: "2.00", status: "DRAFT", workingDaysPerMonthSnapshot: 26 } });
  await prisma.$transaction(async (tx) => {
    const entry = await tx.payrollEntry.create({ data: { baseRateSnapshot: "3000.00", basicPay: "3000.00", businessId: input.businessId, employeeCodeSnapshot: `P2A-${input.token}`, employerEis: "10.00", employerEpf: "390.00", employerSocso: "50.00", fullNameSnapshot: "P2A Employee", grossPay: "3000.00", membershipId: input.membershipId, netPay: "3100.00", normalWorkMinutesSnapshot: 480, payBasisSnapshot: "MONTHLY", payrollRunId: run.id, workingDaysSnapshot: 26 } });
    await tx.payrollEntryComponent.create({ data: { amount: "3000.00", businessId: input.businessId, calculationBasis: "LOCAL_PHASE_2A", code: "P2A_FIXTURE", createdById: input.ownerId, lineKey: "SYSTEM:P2A_FIXTURE", membershipId: input.membershipId, name: "P2A fixture wage", origin: "SYSTEM", payrollEntryId: entry.id, payrollRunId: run.id, sortOrder: 100, sourceType: "PAYROLL_CALCULATION", type: "EARNING" } });
    await tx.payrollClaimReimbursementSnapshot.create({ data: { amount: "100.00", approvedClaimRevision: 2, businessId: input.businessId, claimId: input.claimId, claimNumberSnapshot: input.claimNumber, createdById: input.ownerId, membershipId: input.membershipId, payrollEntryId: entry.id, payrollRunId: run.id, reimbursementId: input.reimbursementId, sourceDigest: "b".repeat(64), statutoryTreatmentStatus: "VERIFIED_NON_WAGE", status: "READY" } });
  });
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "REVIEW", submittedAt: new Date("2026-09-29T10:00:00.000Z"), submittedById: input.ownerId } });
  return prisma.payrollRun.update({ where: { id: run.id }, data: { finalizedAt: new Date("2026-09-30T10:00:00.000Z"), finalizedById: input.ownerId, status: "FINALIZED" } });
}

function assertLocalDatabase() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Expense Phase 2A integration requires Local database.");
}
