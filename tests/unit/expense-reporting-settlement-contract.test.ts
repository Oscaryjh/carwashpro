import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXPENSE_PAYMENT_ACCOUNTS, expensePaymentAccountValue, resolveExpensePaymentAccount } from "../../src/lib/expense/payment-account";

test("combined Expense payment accounts preserve canonical method and funding source facts", () => {
  assert.deepEqual(resolveExpensePaymentAccount("POS_DRAWER_CASH"), {
    label: "POS drawer cash", paymentMethod: "CASH", paymentSource: "POS_DRAWER", value: "POS_DRAWER_CASH",
  });
  assert.equal(expensePaymentAccountValue("EWALLET", "BANK_ACCOUNT"), "BUSINESS_DUITNOW");
  assert.equal(expensePaymentAccountValue("CARD", "COMPANY_CARD"), "COMPANY_CARD");
  assert.equal(resolveExpensePaymentAccount("UNKNOWN"), null);
  assert.ok(EXPENSE_PAYMENT_ACCOUNTS.every((option) => option.paymentMethod && option.paymentSource));
});

test("Expense settlement schema keeps recognition, payment amount and funding source separate", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260814120000_expense_reporting_settlement/migration.sql", "utf8");

  assert.match(schema, /enum ExpensePaymentSource/);
  assert.match(schema, /PARTIALLY_PAID/);
  assert.match(schema, /amount\s+Decimal\s+@db\.Decimal\(12, 2\)/);
  assert.match(schema, /paymentSource\s+ExpensePaymentSource/);
  assert.doesNotMatch(schema, /@@unique\(\[expenseId, paymentStatus\]\)/);
  assert.match(migration, /ADD COLUMN "amount" DECIMAL\(12,2\)/);
  assert.match(migration, /ADD COLUMN "payment_source" "ExpensePaymentSource"/);
});

test("Expense service derives outstanding as-of the report end and requires an explicit drawer shift", () => {
  const service = readFileSync("src/lib/expense/service.ts", "utf8");

  assert.match(service, /expense\.amount\.sub\(alreadyPaid\)/);
  assert.match(service, /EXPENSE_OVERPAYMENT_BLOCKED/);
  assert.match(service, /EXPENSE_DRAWER_SHIFT_REQUIRED/);
  assert.match(service, /recordExpenseDrawerPayout/);
  assert.match(service, /cashierShiftExpensePayout\.create/);
  assert.match(service, /paymentDate:\s*\{\s*lte:\s*toDate/);
  assert.match(service, /paymentsInPeriod/);
  assert.match(service, /paymentBySource/);
  assert.match(service, /recurringTemplateId\s*\?/);
});

test("Expense and report pages distinguish recognition, settlement and simple operating balance", () => {
  const overview = readFileSync("src/app/(business)/expenses/page.tsx", "utf8");
  const reports = readFileSync("src/app/(business)/reports/page.tsx", "utf8");
  const detail = readFileSync("src/app/(business)/expenses/[expenseId]/page.tsx", "utf8");
  const paymentForm = readFileSync("src/components/expense-payment-form.tsx", "utf8");
  const drawerBalance = readFileSync("src/lib/expense/drawer-balance.ts", "utf8");

  const advanced = readFileSync("src/components/reports/advanced-details.tsx", "utf8");
  assert.match(reports, /Operating Balance/);
  assert.match(advanced, /Payments in Period/);
  assert.match(reports, /Outstanding/);
  assert.match(overview, /money\(dashboard\.recorded\)/);
  assert.match(overview, /money\(dashboard\.paid\)/);
  assert.match(overview, /money\(dashboard\.unpaid\)/);
  assert.ok(reports.includes('money(Number(fromCents(dailySalesReport.summary.netSalesCents)) - Number(expenseSummary.recorded))'));
  assert.match(reports, /Expense settlement follows payment date and does not recognise spending again/);
  assert.match(detail, /ExpensePaymentForm/);
  assert.match(detail, /Payment history/);
  assert.match(paymentForm, /Drawer available/);
  assert.match(paymentForm, /Short by/);
  assert.match(paymentForm, /expense remains Unpaid/);
  assert.match(paymentForm, /disabled=\{drawerBlocked\}/);
  assert.match(paymentForm, /Paid from \/ payment account/);
  assert.match(paymentForm, /automaticDrawerShift/);
  assert.match(paymentForm, /currentUserShifts\.length === 1/);
  assert.match(paymentForm, /Selected automatically/);
  assert.match(paymentForm, /name="cashierShiftId" value=\{shift\.id\}/);
  assert.match(paymentForm, /More than one drawer is open/);
  assert.doesNotMatch(paymentForm, /How was it paid\?/);
  assert.doesNotMatch(paymentForm, /Where did the money come from\?/);
  assert.match(drawerBalance, /openingFloat/);
  assert.match(drawerBalance, /paymentRefund\.groupBy/);
  assert.match(drawerBalance, /cashierShiftExpensePayout\.groupBy/);
  assert.match(overview, /This is not accounting profit/);
  assert.match(reports, /Not accounting profit\./);
});
