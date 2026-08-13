import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../src/lib/prisma";
import { getBusinessPerformanceReadModel, getAuthorizedGroupPerformanceSpending } from "../../src/lib/business-performance/read-model";

test("business performance aggregates canonical Sales, Expense, Inventory and AP without double-counting", async () => {
  const token = Math.random().toString(36).slice(2, 10);
  const business = await prisma.business.create({ data: { name: `Performance ${token}`, slug: `performance-${token}`, timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Main" } });
  const user = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, email: `performance-${token}@test.local`, name: "Owner", passwordHash: "test", role: "BUSINESS_OWNER" } });
  try {
    await prisma.businessModuleEntitlement.createMany({ data: ["POS", "INVENTORY", "EXPENSE"].map((moduleKey) => ({ businessId: business.id, moduleKey: moduleKey as "POS", status: "ENABLED" as const, enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL" as const, createdById: user.id, updatedById: user.id })) });
    const invoice = await prisma.invoice.create({ data: { businessId: business.id, branchId: branch.id, invoiceNumber: `INV-${token}`, subtotal: 100, total: 100, paidAmount: 100, balance: 0, status: "PAID", issuedAt: new Date("2026-08-12T04:00:00Z") } });
    await prisma.payment.create({ data: { businessId: business.id, branchId: branch.id, invoiceId: invoice.id, amount: 100, method: "CASH", status: "ACTIVE", paidAt: new Date("2026-08-12T04:00:00Z"), cashierId: user.id } });
    const category = await prisma.expenseCategory.create({ data: { businessId: business.id, name: "Inventory Purchases", code: `INV-${token}` } });
    await prisma.businessExpense.create({ data: { businessId: business.id, branchId: branch.id, expenseNumber: `EXP-${token}`, sourceType: "MANUAL", categoryId: category.id, categoryNameSnapshot: category.name, branchNameSnapshot: branch.name, expenseDate: new Date("2026-08-12T00:00:00Z"), amount: 40, description: "Canonical recorded spending", status: "CONFIRMED", paymentStatus: "UNPAID", createdById: user.id, confirmedById: user.id, confirmedAt: new Date() } });
    await prisma.product.create({ data: { businessId: business.id, name: "Product", price: 25, trackInventory: true, stocks: { create: { branchId: branch.id, quantity: 2, reorderLevel: 2 } } } });
    const result = await getBusinessPerformanceReadModel({ businessId: business.id, allowedBranchIds: [branch.id], includeBusinessWide: true, range: "today", now: new Date("2026-08-12T08:00:00Z") });
    assert.equal(result.sales?.netSalesCents, 10_000);
    assert.equal(result.sales?.transactions, 1);
    assert.equal(result.businessSpending?.recorded, "40.00");
    assert.equal(result.businessSpending?.incomeVsRecordedSpending, "60.00");
    assert.equal(result.inventory?.lowStock, 1);
    assert.equal(result.coverage.accountingProfit, false);
  } finally { /* deterministic token keeps this Local integration fixture isolated */ }
});

test("group spending totals only supplied authorised businesses and preserves missing coverage", async () => {
  const token = Math.random().toString(36).slice(2, 10);
  const included = await prisma.business.create({ data: { name: "Included", slug: `included-${token}` } });
  const excluded = await prisma.business.create({ data: { name: "Excluded", slug: `excluded-${token}` } });
  const owner = await prisma.user.create({ data: { businessId: included.id, email: `group-performance-${token}@test.local`, name: "Owner", passwordHash: "test", role: "BUSINESS_OWNER" } });
  try {
    await prisma.businessModuleEntitlement.create({ data: { businessId: included.id, moduleKey: "EXPENSE", status: "ENABLED", enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL", createdById: owner.id, updatedById: owner.id } });
    const branch = await prisma.branch.create({ data: { businessId: included.id, name: "Main" } });
    const category = await prisma.expenseCategory.create({ data: { businessId: included.id, name: "Manual", code: `M-${token}` } });
    await prisma.businessExpense.create({ data: { businessId: included.id, branchId: branch.id, expenseNumber: `EXP-${token}`, categoryId: category.id, categoryNameSnapshot: category.name, branchNameSnapshot: branch.name, expenseDate: new Date("2026-08-12T00:00:00Z"), amount: 55, description: "Included", status: "CONFIRMED", paymentStatus: "UNPAID", createdById: owner.id, confirmedById: owner.id, confirmedAt: new Date() } });
    const report = await getAuthorizedGroupPerformanceSpending({ businesses: [{ businessId: included.id, from: "2026-08-01", to: "2026-08-31" }] });
    assert.equal(report.knownTotal, "55.00"); assert.equal(report.rows.length, 1); assert.ok(!report.rows.some((row) => row.businessId === excluded.id));
    const mixed = await getAuthorizedGroupPerformanceSpending({ businesses: [{ businessId: included.id, from: "2026-08-01", to: "2026-08-31" }, { businessId: excluded.id, from: "2026-08-01", to: "2026-08-31" }] });
    assert.equal(mixed.completeCoverage, false); assert.equal(mixed.rows.find((row) => row.businessId === excluded.id)?.recorded, null);
  } finally { /* deterministic token keeps this Local integration fixture isolated */ }
});

test("branch scope excludes other branches while business-wide spending remains owner-only", async () => {
  const token = Math.random().toString(36).slice(2, 10);
  const business = await prisma.business.create({ data: { name: `Branch Performance ${token}`, slug: `branch-performance-${token}`, timezone: "Asia/Kuching", businessDayCutoffTime: "02:00" } });
  const [branch, otherBranch] = await Promise.all([
    prisma.branch.create({ data: { businessId: business.id, name: "Scoped branch" } }),
    prisma.branch.create({ data: { businessId: business.id, name: "Other branch" } }),
  ]);
  const user = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, email: `branch-performance-${token}@test.local`, name: "Owner", passwordHash: "test", role: "BUSINESS_OWNER" } });
  await prisma.businessModuleEntitlement.create({ data: { businessId: business.id, moduleKey: "EXPENSE", status: "ENABLED", enabledFrom: new Date("2026-01-01T00:00:00Z"), source: "MANUAL", createdById: user.id, updatedById: user.id } });
  const category = await prisma.expenseCategory.create({ data: { businessId: business.id, name: "Operations", code: `OPS-${token}` } });
  const expenseBase = { businessId: business.id, categoryId: category.id, categoryNameSnapshot: category.name, expenseDate: new Date("2026-08-12T00:00:00Z"), status: "CONFIRMED" as const, paymentStatus: "UNPAID" as const, createdById: user.id, confirmedById: user.id, confirmedAt: new Date("2026-08-12T01:00:00Z") };
  await prisma.businessExpense.createMany({ data: [
    { ...expenseBase, branchId: branch.id, branchNameSnapshot: branch.name, expenseNumber: `EXP-SCOPED-${token}`, amount: 1_720, description: "Scoped branch spending" },
    { ...expenseBase, branchId: otherBranch.id, branchNameSnapshot: otherBranch.name, expenseNumber: `EXP-OTHER-${token}`, amount: 900, description: "Other branch spending" },
    { ...expenseBase, branchId: null, branchNameSnapshot: null, expenseNumber: `EXP-WHOLE-${token}`, amount: 3_000, description: "Whole-business spending" },
  ] });
  const owner = await getBusinessPerformanceReadModel({ businessId: business.id, allowedBranchIds: [branch.id], includeBusinessWide: true, range: "custom", from: "2026-08-01", to: "2026-08-31", now: new Date("2026-08-12T08:00:00Z") });
  const manager = await getBusinessPerformanceReadModel({ businessId: business.id, allowedBranchIds: [branch.id], includeBusinessWide: false, selectedBranchId: branch.id, range: "custom", from: "2026-08-01", to: "2026-08-31", now: new Date("2026-08-12T08:00:00Z") });
  assert.equal(owner.businessSpending?.recorded, "4720.00");
  assert.equal(owner.coverage.unallocatedBusinessWideSpending, "3000.00");
  assert.equal(manager.businessSpending?.recorded, "1720.00");
  assert.equal(manager.coverage.unallocatedBusinessWideSpending, null);
});
