import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories, listBusinessExpenses } from "@/lib/expense/service";
import { prisma } from "@/lib/prisma";
import styles from "../expense.module.css";

type Query = { branchId?: string; categoryId?: string; from?: string; page?: string; paymentStatus?: string; q?: string; sourceType?: string; status?: string; to?: string };

export default async function ExpenseHistoryPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope, categories] = await Promise.all([searchParams, resolveExpenseReadScope(context), prisma.expenseCategory.findMany({ where: { businessId: context.businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const status = ["DRAFT", "CONFIRMED", "VOID"].includes(query.status ?? "") ? query.status as "DRAFT" | "CONFIRMED" | "VOID" : null;
  const paymentStatus = ["UNPAID", "PARTIALLY_PAID", "PAID"].includes(query.paymentStatus ?? "") ? query.paymentStatus as "UNPAID" | "PARTIALLY_PAID" | "PAID" : null;
  const sourceType = ["MANUAL", "CLAIM", "PAYROLL", "INVENTORY_PURCHASE"].includes(query.sourceType ?? "") ? query.sourceType as "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE" : null;
  const branchId = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId : null;
  const result = await listBusinessExpenses({ businessId: context.businessId, branchId, categoryId: categories.some((category) => category.id === query.categoryId) ? query.categoryId : null, dateFrom: query.from || null, dateTo: query.to || null, page: Number(query.page) || 1, paymentStatus, q: query.q, sourceType, status, ...scope });
  const canCreate = hasBusinessCapability(context.access, "CREATE_EXPENSE");
  const exportParams = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
  const hasFilters = Object.entries(query).some(([key, value]) => key !== "page" && Boolean(value));

  return <section className={`content ${styles.expensePage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}><span className={styles.eyebrow}>Expenses</span><h1>Expense history</h1><p>Find draft, confirmed, paid, unpaid and void records within your authorised scope.</p></div>
      <div className={styles.heroActions}><Link className="secondary-link-button" href="/expenses">Overview</Link>{canCreate ? <Link href="/expenses/new" className="button-link">Add Expense</Link> : null}<a className={styles.exportLink} href={`/expenses/export?${exportParams.toString()}`}>Export CSV</a></div>
    </header>

    <form className={`panel ${styles.filters} ${styles.historyFilters}`} aria-label="Filter expense history">
      <div className={styles.filterHeading}><div><span className={styles.eyebrow}>Find records</span><h2>Search and filter</h2><p>{result.total} matching record{result.total === 1 ? "" : "s"}</p></div>{hasFilters ? <Link href="/expenses/history">Clear all</Link> : null}</div>
      <div className={`${styles.filterGrid} ${styles.historyFilterGrid}`}>
        <label className={styles.searchField}>Search<input name="q" defaultValue={query.q ?? ""} placeholder="Expense no., payee or description" /></label>
        <label>From<input type="date" name="from" defaultValue={query.from ?? ""} /></label>
        <label>To<input type="date" name="to" defaultValue={query.to ?? ""} /></label>
        {scope.branches.length > 1 || scope.includeBusinessWide ? <label>Scope<select name="branchId" defaultValue={branchId ?? ""}><option value="">All authorised scope</option>{scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        <label>Category<select name="categoryId" defaultValue={query.categoryId ?? ""}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label>Source<select name="sourceType" defaultValue={sourceType ?? ""}><option value="">All sources</option><option value="MANUAL">Manual</option><option value="CLAIM">Claims</option><option value="PAYROLL">Payroll</option><option value="INVENTORY_PURCHASE">Inventory Purchases</option></select></label>
        <label>Payment<select name="paymentStatus" defaultValue={paymentStatus ?? ""}><option value="">All payment states</option><option value="PAID">Paid</option><option value="PARTIALLY_PAID">Partially paid</option><option value="UNPAID">Unpaid</option></select></label>
        <label>Status<select name="status" defaultValue={status ?? ""}><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="CONFIRMED">Confirmed</option><option value="VOID">Void</option></select></label>
        <div className={styles.filterActions}><button type="submit" className={styles.applyButton}>Show results</button>{hasFilters ? <Link href="/expenses/history">Reset</Link> : null}</div>
      </div>
    </form>

    <section className={`panel ${styles.historyResults}`} aria-labelledby="expense-history-heading">
      <div className={styles.historyResultsHeader}><div><span className={styles.eyebrow}>Results</span><h2 id="expense-history-heading">Expense records</h2><p className={styles.sectionDescription}>Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</p></div><span>{result.total} record{result.total === 1 ? "" : "s"}</span></div>
      {result.items.length ? <>
        <div className={styles.desktopTable}><div className={styles.historyTableWrap}><table className={styles.historyTable}><caption className={styles.srOnly}>Filtered expense history</caption><thead><tr><th>Expense</th><th>Date</th><th>Category / Payee</th><th>Branch</th><th>Amount</th><th>Payment</th><th>Source</th><th>Status</th></tr></thead><tbody>{result.items.map((expense) => <tr key={expense.id}><td><Link className={styles.recordLink} href={`/expenses/${expense.id}`}>{expense.expenseNumber}</Link>{expense.attachments.length ? <small className={styles.tableMeta}>Receipt attached</small> : null}</td><td><time dateTime={expense.expenseDate.toISOString()}>{formatDate(expense.expenseDate)}</time></td><td><strong>{expense.categoryNameSnapshot}</strong><small className={styles.tableMeta}>{expense.payeeName ?? "No payee"}</small></td><td>{expense.branchNameSnapshot ?? "Business-wide"}</td><td className={styles.amountCell}>RM {expense.amount.toFixed(2)}</td><td>{expense.sourceSettlement ? <><StatusBadge value={expense.sourceSettlement.settlementStatus} /><small className={styles.tableMeta}>RM {expense.sourceSettlement.outstandingAmount.toFixed(2)} outstanding</small></> : <StatusBadge value={expense.paymentStatus} />}</td><td><span className={styles.sourceBadge}>{sourceLabel(expense.sourceType)}</span></td><td><StatusBadge value={expense.status} /></td></tr>)}</tbody></table></div></div>
        <div className={styles.mobileList}>{result.items.map((expense) => <Link className={styles.historyCard} href={`/expenses/${expense.id}`} key={expense.id}><div className={styles.historyCardTop}><div><strong>{expense.categoryNameSnapshot}</strong><span>{expense.expenseNumber} · {formatDate(expense.expenseDate)}</span></div><strong>RM {expense.amount.toFixed(2)}</strong></div><div className={styles.historyBadges}><StatusBadge value={expense.status} /><StatusBadge value={expense.sourceSettlement?.settlementStatus ?? expense.paymentStatus} /><span className={styles.sourceBadge}>{sourceLabel(expense.sourceType)}</span></div><div className={styles.historyMeta}><span>{expense.payeeName ?? "No payee"}</span><span>{expense.branchNameSnapshot ?? "Business-wide"}</span>{expense.attachments.length ? <span>Receipt attached</span> : null}</div><span className={styles.historyCardLink}>View details →</span></Link>)}</div>
      </> : <div className={styles.emptyState}><strong>No expenses match these filters</strong><p>Try clearing one or more filters, or create a new manual expense.</p><div className={styles.emptyActions}>{hasFilters ? <Link className="secondary-link-button" href="/expenses/history">Clear filters</Link> : null}{canCreate ? <Link className="button-link" href="/expenses/new">Add Expense</Link> : null}</div></div>}
    </section>

    {result.total > result.pageSize ? <nav className={styles.pagination} aria-label="Expense history pages">{result.page > 1 ? <Link href={`?${withPage(query, result.page - 1)}`}>Previous</Link> : <span aria-disabled="true">Previous</span>}<strong>Page {result.page} of {Math.ceil(result.total / result.pageSize)}</strong>{result.page * result.pageSize < result.total ? <Link href={`?${withPage(query, result.page + 1)}`}>Next</Link> : <span aria-disabled="true">Next</span>}</nav> : null}
  </section>;
}

function StatusBadge({ value }: { value: string }) { return <span className={`${styles.statusBadge} ${styles[`status_${value.toLowerCase()}`] ?? ""}`}>{value.replaceAll("_", " ")}</span>; }
function sourceLabel(value: string) { return value === "MANUAL" ? "Manual" : value === "INVENTORY_PURCHASE" ? "Inventory Purchase" : value === "SYSTEM" ? "Recurring" : value.charAt(0) + value.slice(1).toLowerCase(); }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "2-digit", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }); }
function withPage(query: Query, page: number) { const params = new URLSearchParams(); Object.entries(query).forEach(([key, value]) => { if (value && key !== "page") params.set(key, value); }); params.set("page", String(page)); return params.toString(); }
