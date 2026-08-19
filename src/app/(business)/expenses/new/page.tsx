import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { listOpenExpenseDrawerShifts } from "@/lib/expense/drawer-balance";
import { getExpenseDocumentAiConfiguration } from "@/lib/expense/document-ai/config";
import { ensureStarterExpenseCategories } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { ExpenseDocumentAutofillForm } from "@/components/expense-document-autofill-form";
import styles from "../expense.module.css";

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ message?: string; type?: string }> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "CREATE_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope, categories] = await Promise.all([
    searchParams,
    resolveExpenseReadScope(context),
    prisma.expenseCategory.findMany({ where: { active: true, businessId: context.businessId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const autofill = getExpenseDocumentAiConfiguration();
  const openShifts = await listOpenExpenseDrawerShifts({ branchIds: scope.branches.map((branch) => branch.id), businessId: context.businessId });
  const defaultBranchId = scope.branches.some((branch) => branch.id === context.user.branchId)
    ? context.user.branchId
    : scope.branches.length === 1
      ? scope.branches[0].id
      : null;

  return <section className={`content ${styles.expensePage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}><span className={styles.eyebrow}>Expenses</span><h1>Add Business Expense</h1><p>Scan a receipt or enter manually.</p></div>
      <Link className="secondary-link-button" href="/expenses">Back to overview</Link>
    </header>

    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`} role={query.type === "error" ? "alert" : "status"}>{query.message}</p> : null}

    <ExpenseDocumentAutofillForm
      operationKey={`CREATE_EXPENSE:${randomUUID()}`}
      categories={categories.map(({ id, name, requiresReceipt }) => ({ id, name, requiresReceipt }))}
      branches={scope.branches}
      defaultBranchId={defaultBranchId}
      includeBusinessWide={Boolean(scope.includeBusinessWide)}
      autofillEnabled={autofill.enabled}
      openShifts={openShifts.map((shift) => ({ ...shift, isCurrentUser: shift.cashierId === context.access.userId, startedAt: shift.startedAt.toISOString() }))}
    />
  </section>;
}
