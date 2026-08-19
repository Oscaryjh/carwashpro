import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories, getExpenseDashboard } from "@/lib/expense/service";
import styles from "./expense.module.css";

type Query = { branchId?: string; from?: string; message?: string; range?: string; sourceType?: string; to?: string; type?: string };
type SourceType = "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE" | "SYSTEM";

const sourceOptions: Array<{ label: string; value: SourceType }> = [
  { label: "Manual", value: "MANUAL" },
  { label: "Claims", value: "CLAIM" },
  { label: "Payroll", value: "PAYROLL" },
  { label: "Inventory Purchases", value: "INVENTORY_PURCHASE" },
  { label: "Recurring", value: "SYSTEM" },
];

export default async function ExpenseOverviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope] = await Promise.all([searchParams, resolveExpenseReadScope(context)]);
  const dates = resolveDates(query);
  const selectedBranch = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId : null;
  const sourceType = sourceOptions.some((option) => option.value === query.sourceType) ? query.sourceType as SourceType : null;
  const dashboard = await getExpenseDashboard({ businessId: context.businessId, branchId: selectedBranch, dateFrom: dates.from, dateTo: dates.to, sourceType, ...scope });
  const canCreate = hasBusinessCapability(context.access, "CREATE_EXPENSE");
  const canManageCategories = hasBusinessCapability(context.access, "MANAGE_EXPENSE_CATEGORY");
  const hasFilters = Boolean(query.branchId || query.sourceType || query.range === "last-month" || query.range === "custom");
  const recorded = Number(dashboard.recorded);
  const operatingBalance = dashboard.netSales === null ? null : Number(dashboard.netSales) - recorded;

  return <section className={`content ${styles.expensePage}`}>
    <header className={`page-header ${styles.pageHeader}`}>
      <div className={styles.headerCopy}>
        <span className={styles.eyebrow}>Expenses</span>
        <h1>Business spending</h1>
        <p>Track confirmed operating spending, payment status and source facts in one place.</p>
      </div>
      <div className={styles.heroActions}>
        {canCreate ? <Link className="button-link" href="/expenses/new">Add Expense</Link> : null}
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

    <details className={styles.scopeNotice}>
      <summary>
        <span>What is included in Business spending?</span>
        <small>Operational spending only — not accounting profit</small>
      </summary>
      <div className={styles.scopeColumns}>
        <div><strong>Included</strong><p>Manual operating expenses, approved Claim obligations, and finalized Payroll employer cost; confirmed Supplier Bills are recognized as Inventory Purchases.</p></div>
        <div><strong>Not included</strong><p>PO, Goods Receive, Stock Count, unconfirmed supplier bills, COGS, inventory valuation, depreciation, tax accounting, General Ledger and Supplier Credit Notes.</p></div>
      </div>
      <p className={styles.scopeFootnote}>No Net Profit is inferred. Inventory Purchases are recorded obligations, not COGS.</p>
    </details>

    <form className={`panel ${styles.filters}`} aria-label="Filter business spending">
      <div className={styles.filterHeading}>
        <div><h2>Filter spending</h2><p>{formatDateRange(dates.from, dates.to)}</p></div>
        {hasFilters ? <Link href="/expenses">Reset filters</Link> : null}
      </div>
      <div className={styles.filterGrid}>
        <label>Period<select name="range" defaultValue={query.range ?? "this-month"}><option value="this-month">This month</option><option value="last-month">Last month</option><option value="custom">Custom date range</option></select></label>
        <label>From<input type="date" name="from" defaultValue={dates.from} /></label>
        <label>To<input type="date" name="to" defaultValue={dates.to} /></label>
        <label>Source<select name="sourceType" defaultValue={sourceType ?? ""}><option value="">All sources</option>{sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {scope.branches.length > 1 || scope.includeBusinessWide ? <label>Scope<select name="branchId" defaultValue={selectedBranch ?? ""}><option value="">All authorised scope</option>{scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
        <button type="submit" className={styles.applyButton}>Apply filters</button>
      </div>
    </form>

    <section aria-labelledby="spending-summary-heading">
      <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>Summary</span><h2 id="spending-summary-heading">Spending at a glance</h2></div><span>{dashboard.count} confirmed transaction{dashboard.count === 1 ? "" : "s"}</span></div>
      <div className={styles.summaryGrid}>
        <Metric className={styles.primaryMetric} label="Recorded Business Spending" value={money(dashboard.recorded)} hint="Confirmed expenses in this filter" />
        <Metric tone="paid" label="Paid" value={money(dashboard.paid)} hint="Settlement recorded" />
        <Metric tone="unpaid" label="Outstanding expenses" value={money(dashboard.unpaid)} hint="Confirmed amount less valid applied payments" />
      </div>
      <div className={styles.insightStrip}>
        <Insight label="Average expense" value={money(dashboard.average)} />
        <Insight label="Highest expense" value={money(dashboard.highest)} />
        <Insight label="Top category" value={dashboard.topCategory ?? "No data yet"} />
        {dashboard.netSales !== null ? <Insight label="Net Sales" value={money(dashboard.netSales)} hint="Comparison only" /> : <Insight label="Coverage" value="Recorded facts only" />}
      </div>
    </section>

    <div className={styles.grid}>
      <section className={`panel ${styles.breakdownPanel}`} aria-labelledby="operating-balance-heading"><div className="section-header"><div><h2 id="operating-balance-heading">Business performance</h2><p className={styles.sectionDescription}>Recognition follows Expense Date</p></div></div><div className={styles.stack}><Insight label="Net Sales" value={dashboard.netSales === null ? "Not available" : money(dashboard.netSales)} /><Insight label="Confirmed Expenses" value={money(dashboard.recorded)} /><Insight label="One-off Expenses" value={money(dashboard.oneOff)} /><Insight label="Recurring Expenses" value={money(dashboard.recurring)} /><Insight label="Simple Operating Balance" value={operatingBalance === null ? "Not available" : money(operatingBalance.toFixed(2))} hint="Net Sales minus confirmed spending; not accounting profit" /></div></section>
      <section className={`panel ${styles.breakdownPanel}`} aria-labelledby="expense-settlement-heading"><div className="section-header"><div><h2 id="expense-settlement-heading">Expense settlement</h2><p className={styles.sectionDescription}>Payment activity follows Payment Date</p></div></div><div className={styles.stack}><Insight label="Expense Payments in Period" value={money(dashboard.paymentsInPeriod)} /><Insight label="Paid against selected expenses" value={money(dashboard.paid)} /><Insight label="Outstanding selected expenses" value={money(dashboard.unpaid)} /></div><p className={styles.panelNote}>Payment changes cash or bank settlement only. It never records the expense a second time, and Cash does not mean POS drawer cash.</p></section>
    </div>

    <section className="panel" aria-labelledby="expense-source-heading">
      <div className="section-header"><div><h2 id="expense-source-heading">Spending by source</h2><p className={styles.sectionDescription}>Where each confirmed spending fact came from</p></div><span>Materialized facts only</span></div>
      <div className={styles.sourceGrid}>{sourceOptions.map((option) => {
        const row = dashboard.bySource.find((item) => item.sourceType === option.value);
        const amount = Number(row?.amount ?? 0);
        const percentage = recorded > 0 ? Math.min(100, (amount / recorded) * 100) : 0;
        return <article className={styles.sourceCard} key={option.value}>
          <div><span>{option.label}</span><strong>{money(row?.amount ?? "0.00")}</strong></div>
          <div className={styles.progress} aria-label={`${option.label}: ${percentage.toFixed(1)}% of recorded spending`}><span style={{ width: `${percentage}%` }} /></div>
          <small>{row?.count ?? 0} record{row?.count === 1 ? "" : "s"}</small>
        </article>;
      })}</div>
      <p className={styles.panelNote}>{dashboard.netSales !== null ? "Net Sales and Recorded Business Spending are shown side by side only. No Net Profit, Gross Profit or official P&L is inferred." : "Net Sales comparison is unavailable for branch-restricted scope or when canonical analytics facts are unavailable."}</p>
    </section>

    <div className={styles.grid}>
      <section className={`panel ${styles.breakdownPanel}`} aria-labelledby="expense-category-heading"><div className="section-header"><div><h2 id="expense-category-heading">Top categories</h2><p className={styles.sectionDescription}>Share of recorded expenses</p></div></div><div className={styles.stack}>{dashboard.byCategory.length ? dashboard.byCategory.map((row, index) => <div className={styles.breakdownRow} key={row.categoryId}><div className={styles.breakdownLabel}><span>{index + 1}</span><div><strong>{row.categoryName}</strong><small>{row.count} record{row.count === 1 ? "" : "s"}</small></div></div><strong>{money(row.amount)}</strong><div className={styles.breakdownProgress}><div className={styles.progress}><span style={{ width: `${Math.min(100, row.percentage)}%` }} /></div><small>{row.percentage.toFixed(1)}%</small></div></div>) : <EmptyState title="No category spending yet" description="Confirmed expenses will appear here for the selected period." />}</div></section>
      <section className={`panel ${styles.breakdownPanel}`} aria-labelledby="expense-branch-heading"><div className="section-header"><div><h2 id="expense-branch-heading">Spending by branch</h2><p className={styles.sectionDescription}>Business-wide spending remains separate</p></div></div><div className={styles.stack}>{dashboard.byBranch.length ? dashboard.byBranch.map((row) => <div className={styles.branchRow} key={row.branchId ?? "business"}><div className={styles.branchIdentity}><span aria-hidden="true">B</span><div><strong>{row.branchName}</strong><small>{row.count} record{row.count === 1 ? "" : "s"}</small></div></div><div className={styles.branchAmount}><strong>{money(row.amount)}</strong><small>Recorded spending</small></div></div>) : <EmptyState title="No branch spending yet" description="There are no confirmed expenses in this scope and period." />}</div></section>
    </div>

    <section className={`panel ${styles.recentPanel}`} aria-labelledby="recent-expenses-heading">
      <div className="section-header"><div><h2 id="recent-expenses-heading">Recent expenses</h2><p className={styles.sectionDescription}>Latest confirmed records in the selected scope</p></div><Link href="/expenses/history">View all</Link></div>
      {dashboard.recent.length ? <>
        <div className={styles.desktopTable}><div className={styles.recentTableWrap}><table className={styles.recentTable}><caption className={styles.srOnly}>Recent recorded expenses</caption><thead><tr><th>Expense</th><th>Date</th><th>Payee</th><th>Category</th><th>Branch</th><th>Amount</th></tr></thead><tbody>{dashboard.recent.map((expense) => <tr key={expense.id}><td><Link className={styles.recordLink} href={`/expenses/${expense.id}`}>{expense.expenseNumber}</Link></td><td><time dateTime={expense.expenseDate.toISOString()}>{formatDate(expense.expenseDate)}</time></td><td>{expense.payeeName ?? "—"}</td><td>{expense.categoryNameSnapshot}</td><td>{expense.branchNameSnapshot ?? "Business-wide"}</td><td className={styles.amountCell}>{money(expense.amount.toFixed(2))}</td></tr>)}</tbody></table></div></div>
        <div className={styles.mobileList}>{dashboard.recent.map((expense) => <Link className={styles.expenseCard} href={`/expenses/${expense.id}`} key={expense.id}><div><strong>{expense.categoryNameSnapshot}</strong><span>{expense.expenseNumber} · {formatDate(expense.expenseDate)}</span></div><strong>{money(expense.amount.toFixed(2))}</strong><div><span>{expense.payeeName ?? "No payee"}</span><span>{expense.branchNameSnapshot ?? "Business-wide"}</span></div><span className={styles.historyCardLink}>View details →</span></Link>)}</div>
      </> : <EmptyState title="No confirmed expenses yet" description="Create a manual expense or wait for a canonical source to materialize." action={canCreate ? <Link className="button-link" href="/expenses/new">Add first expense</Link> : undefined} />}
    </section>
  </section>;
}

function Metric({ className = "", hint, label, tone = "default", value }: { className?: string; hint: string; label: string; tone?: "default" | "paid" | "unpaid"; value: string }) {
  return <article className={`${styles.metric} ${styles[`metric_${tone}`]} ${className}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function Insight({ hint, label, value }: { hint?: string; label: string; value: string }) {
  return <div className={styles.insight}><span>{label}</span><strong>{value}</strong>{hint ? <small>{hint}</small> : null}</div>;
}

function EmptyState({ action, description, title }: { action?: React.ReactNode; description: string; title: string }) {
  return <div className={styles.emptyState}><strong>{title}</strong><p>{description}</p>{action}</div>;
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
