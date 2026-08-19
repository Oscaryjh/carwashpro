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
  assert.match(page, /PO, Goods Receive, Stock Count, unconfirmed supplier bills, COGS/);
});

test("Expense overview and history have labelled filters, clear hierarchy and mobile records", () => {
  const dashboard = readFileSync("src/app/(business)/expenses/page.tsx", "utf8");
  const history = readFileSync("src/app/(business)/expenses/history/page.tsx", "utf8");
  const detail = readFileSync("src/app/(business)/expenses/[expenseId]/page.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  assert.match(dashboard, /aria-label="Filter business spending"/);
  assert.match(dashboard, /What is included in Business spending\?/);
  assert.match(dashboard, /Spending at a glance/);
  assert.match(dashboard, /styles\.mobileList/);
  assert.match(history, /aria-label="Filter expense history"/);
  assert.match(history, /Clear filters/);
  assert.match(history, /StatusBadge/);
  assert.match(detail, /aria-label="Expense summary"/);
  assert.match(detail, /Preview not available yet/);
  assert.match(detail, /Source & audit trail/);
  assert.match(detail, /Entered by mistake\? Void it so it no longer counts as spending/);
  assert.match(detail, /This does not delete the record/);
  assert.doesNotMatch(detail, /MALWARE_SCANNER_NOT_CONFIGURED|Malware \{attachment\.malwareStatus\}/, "internal attachment states should not dominate the expense detail UI");
  assert.match(styles, /\.filterGrid/);
  assert.match(styles, /\.mobileList/);
  assert.match(styles, /\.detailHero/);
  assert.match(styles, /\.auditDisclosure/);
  assert.match(styles, /@media \(max-width: 480px\)/);
});

test("Add Expense uses a card workflow without changing canonical form facts", () => {
  const page = readFileSync("src/app/(business)/expenses/new/page.tsx", "utf8");
  const actions = readFileSync("src/app/(business)/expenses/actions.ts", "utf8");
  const form = readFileSync("src/components/expense-document-autofill-form.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  for (const section of ["Receipt autofill", "Ready to confirm", "Edit expense details", "Payment", "Receipt & note"]) assert.match(form, new RegExp(section));
  for (const fact of ["expenseDate", "branchId", "categoryId", "amount", "paymentStatus", "paymentMethod", "paymentDate", "paymentReference", "receipt", "intent"]) assert.match(form, new RegExp(`name=\\"${fact}\\"`));
  assert.match(form, /value="CONFIRMED"/);
  assert.match(form, /value="DRAFT"/);
  assert.match(form, /aria-controls="expense-details-section"/);
  assert.match(form, /aria-pressed=\{selected\}/);
  assert.match(form, /Skip scanning and fill in the form/);
  assert.match(form, /useState\(props\.defaultBranchId \?\? ""\)/);
  assert.match(form, /scrollIntoView/);
  assert.match(form, /expenseDateRef\.current\?\.focus/);
  assert.match(form, /Manual entry selected/);
  assert.doesNotMatch(page, /Use the correct source|Scanning never creates or confirms/, "routing guidance should not permanently occupy the primary form");
  assert.match(actions, /createBusinessExpense/, "the compact UI must continue through the canonical Expense action");
  assert.match(page, /scope\.branches\.some\(\(branch\) => branch\.id === context\.user\.branchId\)/);
  assert.match(page, /scope\.branches\.length === 1/);
  assert.match(page, /defaultBranchId=\{defaultBranchId\}/);
  assert.match(page, /isCurrentUser: shift\.cashierId === context\.access\.userId/);
  assert.match(form, /effectiveCashierShiftId/);
  assert.match(form, /Selected automatically/);
  assert.match(styles, /\.cardForm/);
  assert.match(styles, /\.formAside/);
  assert.match(styles, /\.fieldGrid/);
  assert.match(styles, /\.manualEntryButtonSelected/);
});

test("Expense receipt autofill uses compact exception-based review without weakening canonical submission", () => {
  const service = readFileSync("src/lib/expense/document-ai/service.ts", "utf8");
  const form = readFileSync("src/components/expense-document-autofill-form.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  assert.match(form, /scan && !routed && !automaticFailure/);
  assert.match(form, /compactReady/);
  assert.match(form, /buildReviewIssues/);
  assert.match(form, /BLOCKING/);
  assert.match(form, /NEEDS attention|Needs attention/i);
  assert.match(form, /manualEntrySelected \|\| detailsExpanded/);
  assert.match(form, /Confirm Expense/);
  assert.match(form, /suggested\.paymentReference \?\? ""/);
  assert.doesNotMatch(form, /suggested\.paymentReference \?\? suggested\.invoiceNumber/, "receipt number must not become a payment reference");
  assert.match(form, /humanDate\(expenseDate\)/);
  assert.match(form, /Confirm \{humanDate\(expenseDate\)\}/);
  assert.match(form, /Change date/);
  assert.match(styles, /\.dateReviewSummary/);
  assert.match(form, /Receipt attached/);
  assert.match(form, /\+ Add internal note/);
  assert.match(form, /RoutedDocumentCard/);
  assert.match(form, /DuplicateReview/);
  assert.match(form, /retainReceiptForManualEntry/);
  assert.match(form, /Reading merchant/);
  assert.doesNotMatch(form, /Review expense details|Review payment details|Attachment & notes/);
  assert.match(service, /rawDocumentDate: extraction\.rawDocumentDate/);
  assert.match(service, /paymentStatus: extraction\.fieldConfidence\.paymentStatus/);
  assert.match(styles, /\.compactReviewCard/);
  assert.match(styles, /\.reviewBoxBlocking/);
  assert.match(styles, /\.routedDocumentCard/);
});

test("Add Expense webcam capture stays client-side and feeds the existing document scan", () => {
  const form = readFileSync("src/components/expense-document-autofill-form.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  assert.match(form, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(form, /facingMode: \{ ideal: "environment" \}/);
  assert.match(form, /canvas\.toBlob/);
  assert.match(form, /new File\(\[blob\]/);
  assert.match(form, /await scanDocument\(file\)/);
  assert.match(form, /cameraStreamRef\.current\?\.getTracks\(\)\.forEach/);
  assert.match(form, /Upload instead/);
  assert.match(styles, /\.cameraOverlay/);
  assert.match(styles, /\.cameraViewport/);
});

test("Expense Categories separates creation, discovery and on-demand editing", () => {
  const page = readFileSync("src/app/(business)/expenses/categories/page.tsx", "utf8");
  const actions = readFileSync("src/app/(business)/expenses/actions.ts", "utf8");
  const reorder = readFileSync("src/components/expense-category-reorder.tsx", "utf8");
  const service = readFileSync("src/lib/expense/service.ts", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  for (const section of ["Category summary", "Add a category", "Manage categories", "Filter expense categories"]) assert.match(page, new RegExp(section));
  for (const fact of ["name", "code", "group", "sortOrder", "description", "requiresReceipt"]) assert.match(page, new RegExp(`name=\\"${fact}\\"`));
  assert.match(page, /<details className=\{styles\.categoryCard\}/);
  assert.match(page, /Used categories are kept for historical reporting and are never hard deleted/);
  assert.match(actions, /requireBusinessUserForModule\("EXPENSE", "MANAGE_EXPENSE_CATEGORY"\)/);
  assert.match(actions, /reorderExpenseCategoriesAction/);
  assert.match(reorder, /draggable/);
  assert.match(reorder, /Move \$\{category\.name\} up/);
  assert.match(reorder, /Save category order/);
  assert.match(service, /EXPENSE_CATEGORY_ORDER_SCOPE_INVALID/);
  assert.match(service, /TransactionIsolationLevel\.Serializable/);
  assert.match(styles, /\.categorySummaryGrid/);
  assert.match(styles, /\.categoryFilterGrid/);
  assert.match(styles, /\.categoryCard\[open\]/);
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
  const recurringExpense = readFileSync("src/app/(business)/expenses/recurring/page.tsx", "utf8");
  const styles = readFileSync("src/app/(business)/expenses/expense.module.css", "utf8");
  assert.match(actions, /String\(error\.digest\)\.startsWith\("NEXT_REDIRECT"\)/);
  assert.doesNotMatch(newExpense, /encType=/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(styles, /\.heroActions > a/);
  assert.match(styles, /width: 100%/);
  assert.match(recurringExpense, /scope\.branches\.some\(\(branch\) => branch\.id === context\.user\.branchId\)/);
  assert.match(recurringExpense, /defaultValue=\{defaultBranchId \?\? ""\}/);
  assert.match(recurringExpense, /Recurring expenses/);
  assert.match(recurringExpense, /Create a draft when due/);
  assert.match(recurringExpense, /Nothing is generated or paid automatically/);
  assert.match(recurringExpense, /Save recurring template/);
  assert.match(recurringExpense, /Create draft expense/);
  assert.match(recurringExpense, /aria-label="Filter recurring expenses"/);
  assert.match(recurringExpense, /pageSize = 10/);
  assert.match(recurringExpense, /No matching templates/);
  assert.match(recurringExpense, /open=\{allTemplates\.length === 0\}/);
  assert.doesNotMatch(recurringExpense, /Recurring Expense foundation|Create Monthly Template|Generate Due Expense/);
});
