import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modulesForCapability } from "../../src/lib/modules/registry";

test("Expense capabilities remain inside the independent EXPENSE entitlement", () => {
  for (const capability of ["VIEW_EXPENSE", "CREATE_EXPENSE", "EDIT_EXPENSE_DRAFT", "CONFIRM_EXPENSE", "VOID_EXPENSE", "MARK_EXPENSE_PAID", "MANAGE_EXPENSE_CATEGORY", "VIEW_EXPENSE_RECEIPT"] as const) {
    assert.deepEqual(modulesForCapability(capability, "SALON_BEAUTY"), ["EXPENSE"]);
  }
});

test("Expense schema separates lifecycle, payment, source identity and immutable history", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811210000_expense_phase1_business_foundation/migration.sql", "utf8");
  for (const model of ["ExpenseCategory", "BusinessExpense", "BusinessExpenseRevision", "BusinessExpensePaymentEvent", "BusinessExpenseAttachment", "ExpenseCommand", "RecurringExpenseTemplate"]) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /expenseSequence\s+Int\s+@default\(0\)/);
  assert.match(schema, /sourceType\s+ExpenseSourceType/);
  assert.match(schema, /paymentStatus\s+ExpensePaymentStatus/);
  assert.match(migration, /business_expenses_source_check/);
  assert.match(migration, /business_expenses_payment_check/);
  assert.match(migration, /business_expense_revisions_prevent_update/);
  assert.match(migration, /expense_actor_scope_guard/);
});

test("Expense service does not create Claim, Payroll, PO, Goods Receive, Inventory or POS facts", () => {
  const service = readFileSync("src/lib/expense/service.ts", "utf8");
  assert.doesNotMatch(service, /employeeClaim\.(create|update)|payrollRun\.(create|update)|purchaseOrder\.(create|update)|goodsReceipt\.(create|update)|inventoryMovement\.(create|update)|invoice\.(create|update)|payment\.(create|update)/);
  assert.match(service, /sourceType: "MANUAL"/);
  assert.match(service, /System-sourced expenses require stable source identity/);
  assert.match(service, /recurringTemplateId: template\.id/);
});

test("Expense dashboard uses recorded-spending wording and never claims accounting profit", () => {
  const page = readFileSync("src/app/(business)/expenses/page.tsx", "utf8");
  assert.match(page, /Recorded Business Spending/);
  assert.match(page, /Business spending/);
  assert.doesNotMatch(page, /Accounting Profit|Official P&L/);
  assert.match(page, /No Net Profit is inferred/);
  assert.match(page, /approved Claim obligations, and finalized Payroll employer cost/);
  assert.match(page, /PO, Goods Receive, Stock Count, supplier bills, COGS/);
});

test("Expense routes enforce module capability and private receipt access", () => {
  const actions = readFileSync("src/app/(business)/expenses/actions.ts", "utf8");
  const receipt = readFileSync("src/app/api/expenses/attachments/[attachmentId]/route.ts", "utf8");
  for (const capability of ["CREATE_EXPENSE", "EDIT_EXPENSE_DRAFT", "CONFIRM_EXPENSE", "VOID_EXPENSE", "MARK_EXPENSE_PAID", "MANAGE_EXPENSE_CATEGORY"]) assert.match(actions, new RegExp(capability));
  assert.match(receipt, /VIEW_EXPENSE_RECEIPT/);
  assert.match(receipt, /private, no-store/);
  assert.doesNotMatch(receipt, /objectKey|signedUrl|publicUrl/);
});

test("Expense Server Actions preserve Next redirect control flow and the 390px layout contract", () => {
  const actions = readFileSync("src/app/(business)/expenses/actions.ts", "utf8");
  const newExpense = readFileSync("src/app/(business)/expenses/new/page.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  assert.match(actions, /String\(error\.digest\)\.startsWith\("NEXT_REDIRECT"\)/);
  assert.doesNotMatch(newExpense, /encType=/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /\.heroActions a, \.heroActions button \{ width: 100%/);
});
