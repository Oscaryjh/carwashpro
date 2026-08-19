import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import { getBusinessPerformanceReadModel } from "../../src/lib/business-performance/read-model";
import {
  confirmBusinessExpense,
  createBusinessExpense,
  createRecurringExpenseTemplate,
  ensureStarterExpenseCategories,
  generateRecurringExpense,
  getExpenseDashboard,
  markBusinessExpensePaid,
  voidBusinessExpense,
} from "../../src/lib/expense/service";

const prisma = new PrismaClient();
after(async () => prisma.$disconnect());

test("recognition, partial settlement, recurring source and POS drawer payout remain separate", async () => {
  assertLocalDatabase();
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { businessDayCutoffTime: "00:00", industryType: "SALON_BEAUTY", name: `Expense Reporting ${token}`, slug: `expense-reporting-${token}`, timezone: "Asia/Kuala_Lumpur" } });
  const [branch, otherBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: `Main ${token}` } }),
    prisma.branch.create({ data: { businessId: business.id, name: `Other ${token}` } }),
  ]);
  const user = await prisma.user.create({ data: { branchId: branch.id, businessId: business.id, email: `expense.reporting.${token}@local.test`, name: "Expense Reporting QA", role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.createMany({ data: ["POS", "EXPENSE"].map((moduleKey) => ({ businessId: business.id, moduleKey: moduleKey as "POS" | "EXPENSE", status: "ENABLED" as const, enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL" as const, createdById: user.id, updatedById: user.id })) });
  await ensureStarterExpenseCategories(business.id, prisma);
  const [utilities, rental] = await Promise.all([
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Utilities" } }),
    prisma.expenseCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Rental" } }),
  ]);
  const actor = { email: user.email!, name: user.name, userId: user.id };
  const drawerShift = await prisma.cashierShift.create({ data: { branchId: branch.id, businessId: business.id, cashierId: user.id, openingFloat: 100 } });
  const otherBranchShift = await prisma.cashierShift.create({ data: { branchId: otherBranch.id, businessId: business.id, cashierId: user.id, openingFloat: 100 } });

  const invoice = await prisma.invoice.create({ data: { balance: 0, branchId: branch.id, businessId: business.id, invoiceNumber: `REPORT-${token}`, issuedAt: new Date("2026-08-14T04:00:00Z"), paidAmount: 1000, status: "PAID", subtotal: 1000, total: 1000 } });
  await prisma.payment.create({ data: { amount: 1000, branchId: branch.id, businessId: business.id, invoiceId: invoice.id, method: "CASH", paidAt: new Date("2026-08-14T04:00:00Z") } });

  const expense = await createBusinessExpense({ actor, amount: 200, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "CASE A unpaid expense", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:A` }, prisma);
  const draft = await createBusinessExpense({ actor, amount: 300, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "Excluded draft", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:DRAFT` }, prisma);
  const voidable = await createBusinessExpense({ actor, amount: 400, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "Excluded void", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:VOID` }, prisma);
  await voidBusinessExpense({ actor, businessId: business.id, expenseId: voidable.id, expectedRevision: voidable.revision, operationKey: `EXP-REPORT:${token}:VOID:ACTION`, reason: "Duplicate local QA fixture" }, prisma);

  let summary = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-14", dateTo: "2026-08-14", includeBusinessWide: false }, prisma);
  assert.equal(summary.recorded, "200.00");
  assert.equal(summary.paid, "0.00");
  assert.equal(summary.unpaid, "200.00");
  assert.equal(summary.paymentsInPeriod, "0.00");
  assert.equal((await prisma.businessExpense.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");

  const performance = await getBusinessPerformanceReadModel({ allowedBranchIds: [branch.id], businessId: business.id, from: "2026-08-14", includeBusinessWide: false, now: new Date("2026-08-14T08:00:00Z"), range: "custom", selectedBranchId: branch.id, to: "2026-08-14" }, prisma);
  assert.equal(performance.sales?.netSalesCents, 100_000);
  assert.equal(performance.businessSpending?.recorded, "200.00");
  assert.equal(performance.businessSpending?.incomeVsRecordedSpending, "800.00");

  const partial = await markBusinessExpensePaid({ actor, amount: 50, businessId: business.id, expenseId: expense.id, expectedRevision: expense.revision, operationKey: `EXP-REPORT:${token}:PAY:50`, paymentDate: "2026-08-14", paymentMethod: "BANK_TRANSFER", paymentSource: "BANK_ACCOUNT" }, prisma);
  assert.equal(partial.paymentStatus, "PARTIALLY_PAID");
  await assert.rejects(markBusinessExpensePaid({ actor, amount: 151, businessId: business.id, expenseId: expense.id, expectedRevision: partial.revision, operationKey: `EXP-REPORT:${token}:OVERPAY`, paymentDate: "2026-08-14", paymentMethod: "BANK_TRANSFER", paymentSource: "BANK_ACCOUNT" }, prisma), /exceeds the outstanding amount/);
  summary = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-14", dateTo: "2026-08-14", includeBusinessWide: false }, prisma);
  assert.equal(summary.recorded, "200.00");
  assert.equal(summary.paid, "50.00");
  assert.equal(summary.unpaid, "150.00");
  assert.equal(summary.paymentsInPeriod, "50.00");
  assert.equal(summary.paymentBySource.find((row) => row.source === "BANK_ACCOUNT")?.amount, "50.00");

  const paid = await markBusinessExpensePaid({ actor, amount: 150, businessId: business.id, expenseId: expense.id, expectedRevision: partial.revision, operationKey: `EXP-REPORT:${token}:PAY:150`, paymentDate: "2026-08-15", paymentMethod: "BANK_TRANSFER", paymentSource: "BANK_ACCOUNT" }, prisma);
  assert.equal(paid.paymentStatus, "PAID");
  const historical = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-14", dateTo: "2026-08-14", includeBusinessWide: false }, prisma);
  assert.equal(historical.paid, "50.00");
  assert.equal(historical.unpaid, "150.00");
  assert.equal(historical.paymentsInPeriod, "50.00");

  const ownerCash = await createBusinessExpense({ actor, amount: 200, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "CASE C owner cash", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:OWNER` }, prisma);
  await markBusinessExpensePaid({ actor, amount: 200, businessId: business.id, expenseId: ownerCash.id, expectedRevision: ownerCash.revision, operationKey: `EXP-REPORT:${token}:OWNER:PAY`, paymentDate: "2026-08-14", paymentMethod: "CASH", paymentSource: "OWNER_ADVANCE" }, prisma);
  const drawerCandidate = await createBusinessExpense({ actor, amount: 25, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "Drawer-linked expense", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:DRAWER` }, prisma);
  await assert.rejects(markBusinessExpensePaid({ actor, amount: 25, businessId: business.id, expenseId: drawerCandidate.id, expectedRevision: drawerCandidate.revision, operationKey: `EXP-REPORT:${token}:DRAWER:NO-SHIFT`, paymentDate: "2026-08-14", paymentMethod: "CASH", paymentSource: "POS_DRAWER" }, prisma), /Open POS shift/);
  await assert.rejects(markBusinessExpensePaid({ actor, amount: 25, businessId: business.id, cashierShiftId: otherBranchShift.id, expenseId: drawerCandidate.id, expectedRevision: drawerCandidate.revision, operationKey: `EXP-REPORT:${token}:DRAWER:CROSS-BRANCH`, paymentDate: "2026-08-14", paymentMethod: "CASH", paymentSource: "POS_DRAWER" }, prisma), /outside this expense branch/);
  const drawerPaid = await markBusinessExpensePaid({ actor, amount: 25, businessId: business.id, cashierShiftId: drawerShift.id, expenseId: drawerCandidate.id, expectedRevision: drawerCandidate.revision, operationKey: `EXP-REPORT:${token}:DRAWER:PAY`, paymentDate: "2026-08-14", paymentMethod: "CASH", paymentSource: "POS_DRAWER" }, prisma);
  assert.equal(drawerPaid.paymentStatus, "PAID");
  const drawerPayout = await prisma.cashierShiftExpensePayout.findFirstOrThrow({ where: { businessId: business.id, shiftId: drawerShift.id } });
  assert.equal(drawerPayout.amount.toFixed(2), "25.00");
  const insufficientDrawerExpense = await createBusinessExpense({ actor, amount: 80, branchId: branch.id, businessId: business.id, categoryId: utilities.id, description: "Drawer availability guard", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:DRAWER:INSUFFICIENT` }, prisma);
  await assert.rejects(markBusinessExpensePaid({ actor, amount: 80, businessId: business.id, cashierShiftId: drawerShift.id, expenseId: insufficientDrawerExpense.id, expectedRevision: insufficientDrawerExpense.revision, operationKey: `EXP-REPORT:${token}:DRAWER:INSUFFICIENT:PAY`, paymentDate: "2026-08-14", paymentMethod: "CASH", paymentSource: "POS_DRAWER" }, prisma), /only RM 75\.00 expected cash available/);
  assert.equal((await prisma.businessExpense.findUniqueOrThrow({ where: { id: insufficientDrawerExpense.id } })).paymentStatus, "UNPAID");

  const recurringTemplate = await createRecurringExpenseTemplate({ actor, amount: 5000, branchId: branch.id, businessId: business.id, categoryId: rental.id, description: "CASE E monthly rent", operationKey: `EXP-REPORT:${token}:RECURRING`, startDate: "2026-08-01" }, prisma);
  const recurringDraft = await generateRecurringExpense({ actor, businessId: business.id, operationKey: `EXP-REPORT:${token}:RECURRING:AUG`, period: "2026-08", templateId: recurringTemplate.id }, prisma);
  let recurringSummary = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: false }, prisma);
  assert.equal(recurringSummary.recurring, "0.00");
  await confirmBusinessExpense({ actor, businessId: business.id, expenseId: recurringDraft.id, expectedRevision: recurringDraft.revision, operationKey: `EXP-REPORT:${token}:RECURRING:CONFIRM` }, prisma);
  recurringSummary = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-01", dateTo: "2026-08-31", includeBusinessWide: false }, prisma);
  assert.equal(recurringSummary.recurring, "5000.00");

  const otherBranchExpense = await createBusinessExpense({ actor, amount: 999, branchId: otherBranch.id, businessId: business.id, categoryId: utilities.id, description: "Other branch isolation", desiredStatus: "CONFIRMED", expenseDate: "2026-08-14", operationKey: `EXP-REPORT:${token}:OTHER-BRANCH` }, prisma);
  assert.ok(otherBranchExpense.id);
  const branchOnly = await getExpenseDashboard({ allowedBranchIds: [branch.id], businessId: business.id, dateFrom: "2026-08-14", dateTo: "2026-08-14", includeBusinessWide: false }, prisma);
  assert.equal(branchOnly.recorded, "505.00");
});

function assertLocalDatabase() {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(host), "Expense settlement integration requires Local database.");
}
