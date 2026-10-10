import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { resolveExpenseOutletContext } from "@/lib/expense/outlet-scope";
import { ensureStarterExpenseCategories, getExpenseDashboard } from "@/lib/expense/service";
import { ExpenseHomeFilters } from "./expense-home-filters";
import styles from "./expense.module.css";

type Query = { branchId?: string; from?: string; message?: string; range?: string; sourceType?: string; to?: string; type?: string };
type SourceType = "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE" | "SYSTEM";

const expenseSourceOptions: Array<{ label: string; value: SourceType }> = [
  { label: "Manual Expenses", value: "MANUAL" },
  { label: "Staff Claims", value: "CLAIM" },
  { label: "Payroll", value: "PAYROLL" },
  { label: "Inventory Purchases", value: "INVENTORY_PURCHASE" },
  { label: "Recurring Expenses", value: "SYSTEM" },
];

export default async function ExpenseOverviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope] = await Promise.all([searchParams, resolveExpenseReadScope(context)]);
  const outlet = await resolveExpenseOutletContext({ businessId: context.businessId, actorUserId: context.user.userId, capability: "VIEW_EXPENSE", operation: "read" });
  if (outlet.context.kind === "denied" || (query.branchId && !scope.branches.some(branch => branch.id === query.branchId))) throw new Error("Expense location is outside your authorised scope.");
  const dates = resolveDates(query);
  const selectedBranch = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId : null;
  const sourceType = expenseSourceOptions.some((option) => option.value === query.sourceType) ? query.sourceType as SourceType : null;
  const dashboard = await getExpenseDashboard({ businessId: context.businessId, branchId: selectedBranch, dateFrom: dates.from, dateTo: dates.to, sourceType, ...scope });
  // Reuse scoped, period-bound facts. An active filter remains clearable even
  // when its result is empty; clearing it restores the other available sources.
  const sourceOptions = expenseSourceOptions.filter((option) =>
    option.value === sourceType || dashboard.bySource.some((row) => row.sourceType === option.value && row.count > 0 && Number(row.amount) > 0),
  );
  const canCreate = hasBusinessCapability(context.access, "CREATE_EXPENSE");
  const canManageCategories = hasBusinessCapability(context.access, "MANAGE_EXPENSE_CATEGORY");
  const showBranches = outlet.context.kind === "legacy_multi_branch";
  const sources = expenseSourceOptions.flatMap((option) => {
    const row = dashboard.bySource.find((item) => item.sourceType === option.value);
    return row && (Number(row.amount) > 0 || row.count > 0) ? [{ ...row, label: option.label }] : [];
  });

  return <section className={`content ${styles.expensePage} ${styles.homePage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}>
        <div className={styles.homeTitle}>
          <h1>Expenses</h1>
          <details className={styles.homeInfo}>
            <summary aria-label="About expenses">ⓘ</summary>
            <p>Operational spending only. This is not accounting profit.</p>
          </details>
        </div>
        <p>Track and manage your business expenses.</p>
      </div>
      <div className={styles.heroActions}>
        {canCreate ? <Link className="button-link" href="/expenses/new">+ Add Expense</Link> : null}
        <Link className="secondary-link-button" href="/expenses/history">View history</Link>
        {canManageCategories ? <details className={styles.manageMenu}>
          <summary>Manage</summary>
          <div className={styles.manageMenuPanel}>
            <Link href="/expenses/categories">Categories</Link>
            <Link href="/expenses/recurring">Recurring expenses</Link>
            <Link href="/expenses/integrations">Source integrations</Link>
          </div>
        </details> : null}
      </div>
    </header>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`} role={query.type === "error" ? "alert" : "status"}>{query.message}</p> : null}
    <ExpenseHomeFilters key={JSON.stringify([query.range, dates, sourceType, selectedBranch])}
      range={query.range === "custom" || query.range === "last-month" ? query.range : "this-month"}
      from={dates.from} to={dates.to} dateLabel={formatDateRange(dates.from, dates.to)}
      sourceType={sourceType ?? ""} branchId={selectedBranch ?? ""} branches={scope.branches} sourceOptions={sourceOptions} showBranchSelector={showBranches} />

    <section className={styles.summaryGrid} aria-label="Expense summary">
      <Metric label="Total Expenses" value={money(dashboard.recorded)} hint="All confirmed expenses in this period" />
      <Metric tone="paid" label="Paid" value={money(dashboard.paid)} hint="Payments recorded" />
      <Metric tone="unpaid" label="Outstanding" value={money(dashboard.unpaid)} hint="Amount still unpaid" />
    </section>

    <section className={`panel ${styles.recentPanel}`} aria-labelledby="recent-expenses-heading">
      <div className="section-header"><h2 id="recent-expenses-heading">Recent expenses</h2><Link href="/expenses/history">View all</Link></div>
      {dashboard.recent.length ? <>
        <div className={styles.desktopTable}><div className={styles.recentTableWrap}>
          <table className={`${styles.recentTable} ${styles.homeRecentTable}`}>
            <caption className={styles.srOnly}>Recent expenses</caption>
            <thead><tr><th>Date</th><th>Expense / Payee</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>{dashboard.recent.map((expense) => <tr key={expense.id}>
              <td><time dateTime={expense.expenseDate.toISOString()}>{formatDate(expense.expenseDate)}</time></td>
              <td><Link className={styles.recordLink} href={`/expenses/${expense.id}`}>{expense.expenseNumber}</Link><span className={styles.homePayee}>{expense.payeeName ?? "—"}</span></td>
              <td>{expense.categoryNameSnapshot}</td>
              <td className={styles.amountCell}>{money(expense.amount.toFixed(2))}</td>
              <td><span className={styles.statusBadge}>Confirmed</span></td>
            </tr>)}</tbody>
          </table>
        </div></div>
        <div className={styles.mobileList}>{dashboard.recent.map((expense) => <Link className={styles.expenseCard} href={`/expenses/${expense.id}`} key={expense.id}>
          <div><strong>{expense.payeeName ?? expense.expenseNumber}</strong><span>{expense.expenseNumber} · {formatDate(expense.expenseDate)}</span></div>
          <strong>{money(expense.amount.toFixed(2))}</strong>
          <div><span>{expense.categoryNameSnapshot}</span><span>Confirmed</span></div>
        </Link>)}</div>
      </> : <div className={styles.emptyState}>
        <strong>No expenses yet</strong>
        <p>Add your first expense to start tracking business spending.</p>
        {canCreate ? <Link className="button-link" href="/expenses/new">Add Expense</Link> : null}
      </div>}
    </section>

    {Number(dashboard.oneOff) !== 0 || Number(dashboard.recurring) !== 0 ? <section className="panel" aria-labelledby="expense-breakdown-heading">
      <div className="section-header"><h2 id="expense-breakdown-heading">Expense breakdown</h2></div>
      <div className={styles.homeBreakdown}>
        <div><span>One-off expenses</span><strong>{money(dashboard.oneOff)}</strong></div>
        <div><span>Recurring expenses</span><strong>{money(dashboard.recurring)}</strong></div>
      </div>
    </section> : null}

    {dashboard.byCategory.length ? <section className="panel" aria-labelledby="expense-category-heading">
      <div className="section-header"><h2 id="expense-category-heading">Top categories</h2></div>
      <div className={styles.stack}>{dashboard.byCategory.map((row, index) => <div className={styles.breakdownRow} key={row.categoryId}>
        <div className={styles.breakdownLabel}><span>{index + 1}</span><strong>{row.categoryName}</strong></div><strong>{money(row.amount)}</strong>
      </div>)}</div>
    </section> : null}

    {sources.length ? <section className="panel" aria-labelledby="expense-source-heading">
      <div className="section-header"><h2 id="expense-source-heading">Where your expenses came from</h2></div>
      <div className={styles.sourceGrid}>{sources.map((row) => <article className={styles.sourceCard} key={row.sourceType}>
        <div><span>{row.label}</span><strong>{money(row.amount)}</strong></div>
        <small>{row.count} record{row.count === 1 ? "" : "s"}</small>
      </article>)}</div>
    </section> : null}

    {showBranches && dashboard.byBranch.length ? <section className="panel" aria-labelledby="expense-branch-heading">
      <div className="section-header"><h2 id="expense-branch-heading">Spending by branch</h2></div>
      <div className={styles.stack}>{dashboard.byBranch.map((row) => <div className={styles.branchRow} key={row.branchId ?? "business"}>
        <strong>{row.branchName}</strong><strong>{money(row.amount)}</strong>
      </div>)}</div>
    </section> : null}
  </section>;
}

function Metric({ hint, label, tone = "default", value }: { hint: string; label: string; tone?: "default" | "paid" | "unpaid"; value: string }) {
  return <article className={`${styles.metric} ${styles[`metric_${tone}`]}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function money(value: string) { return `RM ${value}`; }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { day: "2-digit", month: "short", timeZone: "Asia/Kuala_Lumpur", year: "numeric" }); }
function formatDateRange(from: string, to: string) { return `${formatInputDate(from)} – ${formatInputDate(to)}`; }
function formatInputDate(value: string) { return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-MY", { day: "2-digit", month: "short", timeZone: "UTC", year: "numeric" }); }
function resolveDates(query: Query) {
  const now = new Date();
  const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  if (query.range === "last-month") { const start = new Date(Date.UTC(year, month - 1, 1)); const end = new Date(Date.UTC(year, month, 0)); return { from: iso(start), to: iso(end) }; }
  if (query.range === "custom" && validDate(query.from) && validDate(query.to) && query.from! <= query.to!) return { from: query.from!, to: query.to! };
  return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(new Date(Date.UTC(year, month + 1, 0))) };
}
function validDate(value?: string) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function iso(value: Date) { return value.toISOString().slice(0, 10); }
