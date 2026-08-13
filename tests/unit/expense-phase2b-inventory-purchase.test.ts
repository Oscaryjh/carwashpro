import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd());
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve(root, "prisma/migrations/20260812050000_expense_phase2b_inventory_purchase/migration.sql"), "utf8");
const adapter = readFileSync(resolve(root, "src/lib/expense/source-integration.ts"), "utf8");
const supplierActions = readFileSync(resolve(root, "src/app/(business)/inventory/supplier-ap-actions.ts"), "utf8");
const expenseDetail = readFileSync(resolve(root, "src/app/(business)/expenses/[expenseId]/page.tsx"), "utf8");

test("inventory purchase reuses the Expense source integration and exact-one identity", () => {
  assert.match(schema, /INVENTORY_PURCHASE/);
  assert.match(schema, /model ExpenseSourceSettlement/);
  assert.match(migration, /business_expenses_one_active_system_source/);
  assert.match(migration, /confirmed supplier bill revision/i);
  assert.match(adapter, /synchronizeInventoryPurchaseExpense/);
  assert.doesNotMatch(adapter, /current product cost/i);
});

test("only confirmed Supplier Bill is recognized and settlement never changes recorded amount", () => {
  assert.match(adapter, /bill\.status === "DRAFT"/);
  assert.match(adapter, /bill\.status === "VOID"/);
  assert.match(adapter, /amount: bill\.totalAmount/);
  assert.match(adapter, /expenseDate: bill\.invoiceDate/);
  assert.match(adapter, /branchId: bill\.branchId/);
  assert.match(adapter, /paidAmount/);
  assert.match(adapter, /outstandingAmount/);
  assert.match(supplierActions, /trySynchronizeInventoryPurchaseExpense/);
});

test("system source remains read-only and AP drill-down requires AP authority", () => {
  assert.match(expenseDetail, /System Generated · Read-only/);
  assert.match(expenseDetail, /VIEW_SUPPLIER_BILL/);
  assert.match(expenseDetail, /enabledModules\.has\("INVENTORY"\)/);
  assert.match(expenseDetail, /sourceSettlement\.paidAmount/);
  assert.match(expenseDetail, /sourceSettlement\.outstandingAmount/);
});

test("migration performs no silent business transaction backfill", () => {
  assert.match(migration, /Business transactions are intentionally not backfilled/);
  assert.match(migration, /controlled reconciliation instead of guessing/);
  assert.match(adapter, /LEGACY_CONFIRMATION_REVISION_REQUIRED/);
  assert.doesNotMatch(migration, /INSERT INTO "business_expenses"/i);
});
