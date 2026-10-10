import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { resolveExpenseOutletContext } from "@/lib/expense/outlet-scope";
import { ensureStarterExpenseCategories, listBusinessExpenses } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import { HistoryFilters } from "./history-filters";
import { historyDatePeriods } from "./date-periods";
import styles from "../expense.module.css";

type Query = { branchId?: string; categoryId?: string; from?: string; page?: string; paymentStatus?: string; q?: string; sourceType?: string; status?: string; to?: string };

export default async function ExpenseHistoryPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [requestedQuery, scope, categories] = await Promise.all([searchParams, resolveExpenseReadScope(context), prisma.expenseCategory.findMany({ where: { businessId: context.businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const periods = historyDatePeriods();
  const outlet = await resolveExpenseOutletContext({ businessId: context.businessId, actorUserId: context.user.userId, capability: "VIEW_EXPENSE", operation: "read" });
  if (outlet.context.kind === "denied" || (requestedQuery.branchId && !scope.branches.some(branch => branch.id === requestedQuery.branchId))) throw new Error("Expense history location is outside your authorised scope.");
  const query = requestedQuery.from === undefined && requestedQuery.to === undefined ? { ...requestedQuery, ...periods['this-month'] } : requestedQuery;
  const status = ["DRAFT", "CONFIRMED", "VOID"].includes(query.status ?? "") ? query.status as "DRAFT" | "CONFIRMED" | "VOID" : null;
  const paymentStatus = ["UNPAID", "PARTIALLY_PAID", "PAID"].includes(query.paymentStatus ?? "") ? query.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID" : null;
  const sourceType = ["MANUAL", "CLAIM", "PAYROLL", "INVENTORY_PURCHASE"].includes(query.sourceType ?? "") ? query.sourceType as "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE" : null;
  const branchId = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId : null;
  const result = await listBusinessExpenses({ businessId: context.businessId, branchId, categoryId: categories.some((category) => category.id === query.categoryId) ? query.categoryId : null, dateFrom: query.from || null, dateTo: query.to || null, page: Number(query.page) || 1, paymentStatus, q: query.q, sourceType, status, ...scope });
  const hasAnyExpenses = result.total > 0 || (result.items.length === 0 && (await listBusinessExpenses({ businessId: context.businessId, ...scope, pageSize: 1 })).total > 0);
  const canCreate = hasBusinessCapability(context.access, "CREATE_EXPENSE");
  const exportParams = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
  return <section className={`content ${styles.expensePage} ${styles.simpleHistoryPage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}><h1>Expense History</h1><p>View and find past expenses.</p></div>
      <div className={styles.heroActions}><Link className="secondary-link-button" href="/expenses">Back to Expenses</Link>{canCreate ? <Link href="/expenses/new" className="button-link">Add Expense</Link> : null}<a className={styles.exportLink} href={`/expenses/export?${exportParams.toString()}`}>Export CSV</a></div>
    </header>
    <HistoryFilters key={JSON.stringify(query)} query={{...query, branchId: branchId ?? '', sourceType: sourceType ?? '', paymentStatus: paymentStatus ?? '', status: status ?? ''}} periods={periods} branches={scope.branches} categories={categories} showBranchSelector={outlet.context.kind === "legacy_multi_branch"} />
    <section className={`panel ${styles.historyResults}`} aria-labelledby="expense-history-heading">
      <div className={styles.historyResultsHeader}><h2 id="expense-history-heading">Expense records · {result.total}</h2></div>
      {result.items.length ? <>
        <div className={styles.desktopTable}><table className={`${styles.historyTable} ${styles.simpleHistoryTable}`}>
          <caption className={styles.srOnly}>Filtered expense history</caption>
          <thead><tr><th>Date</th><th>Expense</th><th>Category</th><th>Amount</th><th>Payment</th><th>Action</th></tr></thead>
          <tbody>{result.items.map(expense => <tr key={expense.id}>
            <td><time dateTime={expense.expenseDate.toISOString()}>{formatDate(expense.expenseDate)}</time></td>
            <td><strong>{expense.payeeName || expense.expenseNumber}</strong>{expense.description ? <small className={styles.tableMeta}>{expense.description}</small> : null}{outlet.context.kind !== "legacy_multi_branch" && expense.branchId === null ? <small className={styles.tableMeta}>Business-wide</small> : null}</td>
            <td>{expense.categoryNameSnapshot}</td><td className={styles.amountCell}>RM {expense.amount.toFixed(2)}</td>
            <td><StatusBadge value={expense.sourceSettlement?.settlementStatus ?? expense.paymentStatus} />{expense.sourceSettlement ? <small className={styles.tableMeta}>RM {expense.sourceSettlement.outstandingAmount.toFixed(2)} outstanding</small> : null}</td>
            <td><Link className={styles.recordLink} aria-label={`View ${expense.expenseNumber}`} href={`/expenses/${expense.id}`}>View</Link></td>
          </tr>)}</tbody>
        </table></div>
        <div className={styles.mobileList}>{result.items.map(expense => <Link className={styles.historyCard} href={`/expenses/${expense.id}`} key={expense.id}>
          <div className={styles.historyCardTop}><div><strong>{expense.payeeName || expense.expenseNumber}</strong><span>{formatDate(expense.expenseDate)} · {expense.categoryNameSnapshot}</span></div><strong>RM {expense.amount.toFixed(2)}</strong></div>
          {expense.description ? <p>{expense.description}</p> : null}{outlet.context.kind !== "legacy_multi_branch" && expense.branchId === null ? <p>Business-wide</p> : null}<StatusBadge value={expense.sourceSettlement?.settlementStatus ?? expense.paymentStatus} /><span className={styles.historyCardLink}>View details →</span>
        </Link>)}</div>
      </> : <div className={styles.emptyState}>
        <strong>{hasAnyExpenses ? "No matching expenses" : "No expenses yet"}</strong><p>{hasAnyExpenses ? "Try changing or clearing your filters." : "Add your first business expense."}</p>
        <div className={styles.emptyActions}>{hasAnyExpenses ? <Link className="secondary-link-button" href="/expenses/history?from=&to=">Clear filters</Link> : canCreate ? <Link className="button-link" href="/expenses/new">Add Expense</Link> : null}</div>
      </div>}
    </section>
    {result.total > result.pageSize ? <nav className={styles.pagination} aria-label="Expense history pages">{result.page > 1 ? <Link href={`?${withPage(query, result.page - 1)}`}>Previous</Link> : <span aria-disabled="true">Previous</span>}<strong>Page {result.page} of {Math.ceil(result.total / result.pageSize)}</strong>{result.page * result.pageSize < result.total ? <Link href={`?${withPage(query, result.page + 1)}`}>Next</Link> : <span aria-disabled="true">Next</span>}</nav> : null}
  </section>;
}
function StatusBadge({ value }: { value: string }) { return <span className={`${styles.statusBadge} ${styles[`status_${value.toLowerCase()}`] ?? ""}`}>{value.replaceAll("_", " ")}</span>; }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "2-digit", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }); }
function withPage(query: Query, page: number) { const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value !== undefined && key !== "page") params.set(key, value); }); params.set("page", String(page)); return params.toString(); }
