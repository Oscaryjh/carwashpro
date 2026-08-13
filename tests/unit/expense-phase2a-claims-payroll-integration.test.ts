import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Phase 2A schema has explicit mappings, immutable source facts and one-active-source guard", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260811233000_expense_phase2a_claims_payroll_integration/migration.sql", "utf8");
  const immutabilityMigration = readFileSync("prisma/migrations/20260811235000_expense_phase2a_snapshot_immutability/migration.sql", "utf8");
  assert.match(schema, /model ExpenseIntegrationSetting/);
  assert.match(schema, /claimDefaultCategoryId/);
  assert.match(schema, /payrollCategoryId/);
  assert.match(schema, /model ExpenseSourceSnapshot/);
  assert.match(schema, /grossRemuneration/);
  assert.match(schema, /excludedPassThrough/);
  assert.match(schema, /receiptAvailable/);
  assert.match(migration, /business_expenses_one_active_system_source/);
  assert.match(migration, /source_type" IN \('CLAIM', 'PAYROLL'\)/);
  assert.match(immutabilityMigration, /BEFORE UPDATE OR DELETE ON "expense_source_snapshots"/);
  assert.match(immutabilityMigration, /ExpenseSourceSnapshot is immutable/);
});

test("Claims and Payroll own lifecycle while Expense adapters run after canonical actions", () => {
  const claimsActions = readFileSync("src/app/(business)/team/claims/actions.ts", "utf8");
  const payrollActions = readFileSync("src/app/(business)/team/payroll/actions.ts", "utf8");
  const integration = readFileSync("src/lib/expense/source-integration.ts", "utf8");
  assert.ok(claimsActions.indexOf("reviewEmployeeClaim") < claimsActions.indexOf("trySynchronizeClaimExpense"));
  assert.ok(payrollActions.indexOf("finalizePayrollRun({") < payrollActions.lastIndexOf("trySynchronizePayrollExpense"));
  assert.match(integration, /EXPENSE_SOURCE_RECONCILIATION_FAILED/);
  assert.match(integration, /status: "DEFERRED"/);
  assert.doesNotMatch(integration, /employeeClaim\.(create|update)|payrollRun\.(create|update)/);
});

test("Payroll cost formula excludes Claim pass-through and never adds employee deductions", () => {
  const integration = readFileSync("src/lib/expense/source-integration.ts", "utf8");
  assert.match(integration, /grossRemuneration = wages\.add\(excludedPassThrough\)/);
  assert.match(integration, /totalBusinessCost: grossRemuneration\.add\(employerContributionTotal\)\.add\(otherEmployerCost\)\.sub\(excludedPassThrough\)/);
  for (const employeeDeduction of ["epfEmployee", "socsoEmployee", "eisEmployee", "lindung24Employee", "pcb"]) {
    assert.doesNotMatch(integration, new RegExp(`entry\\.${employeeDeduction}`));
  }
});

test("System source UX is read-only with source filters, source cards and no profit claim", () => {
  const detail = readFileSync("src/app/(business)/expenses/[expenseId]/page.tsx", "utf8");
  const dashboard = readFileSync("src/app/(business)/expenses/page.tsx", "utf8");
  const settings = readFileSync("src/app/(business)/expenses/integrations/page.tsx", "utf8");
  assert.match(detail, /expense\.sourceType === "MANUAL"/);
  assert.match(detail, /Read-only representation/);
  assert.match(detail, /Available in Claims \(not copied\)/);
  assert.match(dashboard, /All sources/);
  assert.match(dashboard, /Spending by source/);
  assert.match(dashboard, /No Net Profit is inferred/);
  assert.match(settings, /Repair\/backfill is an internal controlled workflow/);
  assert.doesNotMatch(dashboard, />Net Profit</);
});

test("PO, Goods Receive and Stock Count remain outside Expense Phase 2A", () => {
  for (const file of [
    "src/lib/inventory/purchasing-service.ts",
    "src/lib/inventory/stock-count-service.ts",
    "src/lib/inventory/service.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /businessExpense\.(create|update)|materializeSourceExpense|synchronizeClaimExpense|synchronizePayrollExpense/);
  }
});
