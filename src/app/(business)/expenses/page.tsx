import Link from "next/link";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { ensureStarterExpenseCategories, getExpenseDashboard } from "@/lib/expense/service";
import styles from "./expense.module.css";

type Query = { branchId?: string; from?: string; message?: string; range?: string; sourceType?: string; to?: string; type?: string };

export default async function ExpenseOverviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE");
  await ensureStarterExpenseCategories(context.businessId);
  const [query, scope] = await Promise.all([searchParams, resolveExpenseReadScope(context)]);
  const dates = resolveDates(query);
  const selectedBranch = scope.branches.some((branch) => branch.id === query.branchId) ? query.branchId : null;
  const sourceType = ["MANUAL", "CLAIM", "PAYROLL", "INVENTORY_PURCHASE"].includes(query.sourceType ?? "") ? query.sourceType as "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE" : null;
  const dashboard = await getExpenseDashboard({ businessId: context.businessId, branchId: selectedBranch, dateFrom: dates.from, dateTo: dates.to, sourceType, ...scope });
  const canCreate = hasBusinessCapability(context.access, "CREATE_EXPENSE");
  const canManageCategories = hasBusinessCapability(context.access, "MANAGE_EXPENSE_CATEGORY");
  return <section className="content">
    <div className="page-header"><div><h1>Business spending</h1><p>Recorded operating spending only. This is not Accounting, COGS, Accounts Payable, official profit, or tax reporting.</p></div><div className={styles.heroActions}>{canCreate ? <Link className="button-link" href="/expenses/new">Add Expense</Link> : null}<Link className="secondary-link-button" href="/expenses/history">Expense history</Link>{canManageCategories ? <><Link href="/expenses/categories">Categories</Link><Link href="/expenses/recurring">Recurring</Link><Link href="/expenses/integrations">Source integrations</Link></> : null}</div></div>
    {query.message ? <p className={`form-message ${query.type === "error" ? "error" : "success"}`}>{query.message}</p> : null}
    <div className={styles.notice}><strong>Included and excluded</strong><div>Included: Manual operating expenses, approved Claim obligations, and finalized Payroll employer cost, plus confirmed Supplier Bills / Inventory Purchases. Excluded: PO, Goods Receive, Stock Count, supplier bills, COGS, inventory valuation, depreciation, tax accounting, General Ledger and Supplier Credit Notes—except that confirmed Supplier Bills are recognized explicitly as Inventory Purchases. No Net Profit is inferred.</div></div>
    <form className="filter-bar"><select name="range" defaultValue={query.range ?? "this-month"}><option value="this-month">This Month</option><option value="last-month">Last Month</option><option value="custom">Custom Date Range</option></select><input type="date" name="from" defaultValue={dates.from} /><input type="date" name="to" defaultValue={dates.to} /><select name="sourceType" defaultValue={sourceType ?? ""}><option value="">All sources</option><option value="MANUAL">Manual</option><option value="CLAIM">Claims</option><option value="PAYROLL">Payroll</option><option value="INVENTORY_PURCHASE">Inventory Purchases</option></select>{scope.branches.length > 1 || scope.includeBusinessWide ? <select name="branchId" defaultValue={selectedBranch ?? ""}><option value="">All authorised scope</option>{scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select> : null}<button>Apply</button></form>
    <div className={styles.metrics}><Metric label="Recorded Business Spending" value={money(dashboard.recorded)} /><Metric label="Paid Spending" value={money(dashboard.paid)} /><Metric label="Unpaid Spending" value={money(dashboard.unpaid)} />{dashboard.netSales !== null ? <Metric label="Net Sales (comparison only)" value={money(dashboard.netSales)} /> : null}<Metric label="Transactions" value={String(dashboard.count)} /><Metric label="Average Expense" value={money(dashboard.average)} /><Metric label="Highest Expense" value={money(dashboard.highest)} /><Metric label="Top Category" value={dashboard.topCategory ?? "—"} /></div>
    <div className="panel"><div className="section-header"><h2>Spending by source</h2><span>Materialized facts only</span></div><div className={styles.metrics}>{["MANUAL", "CLAIM", "PAYROLL", "INVENTORY_PURCHASE"].map((key) => { const row = dashboard.bySource.find((item) => item.sourceType === key); return <Metric key={key} label={key === "MANUAL" ? "Manual" : key === "CLAIM" ? "Claims" : key === "PAYROLL" ? "Payroll" : "Inventory Purchases"} value={money(row?.amount ?? "0.00")} />; })}</div>{dashboard.netSales !== null ? <p>Net Sales and Recorded Business Spending are shown side by side only. No Net Profit, Gross Profit or official P&amp;L is inferred.</p> : <p>Net Sales comparison is unavailable for branch-restricted scope or when canonical analytics facts are unavailable.</p>}<p>Inventory Purchases are recorded obligations, not COGS.</p></div>
    <div className={styles.grid}>
      <div className="panel"><div className="section-header"><h2>Spending by category</h2><span>% of recorded expenses</span></div><div className={styles.stack}>{dashboard.byCategory.length ? dashboard.byCategory.map((row) => <div className={styles.barRow} key={row.categoryId}><span>{row.categoryName} · {row.count}</span><div className={styles.bar}><span style={{ width: `${Math.min(100, row.percentage)}%` }} /></div><strong>{money(row.amount)} · {row.percentage.toFixed(1)}%</strong></div>) : <p className="empty-state">No confirmed Expenses in this range.</p>}</div></div>
      <div className="panel"><div className="section-header"><h2>Expense by branch</h2><span>Business-wide remains separate</span></div><div className={styles.stack}>{dashboard.byBranch.length ? dashboard.byBranch.map((row) => <div className={styles.barRow} key={row.branchId ?? "business"}><span>{row.branchName} · {row.count}</span><div /><strong>{money(row.amount)}</strong></div>) : <p className="empty-state">No branch spending in this range.</p>}</div></div>
    </div>
    <div className="panel"><div className="section-header"><h2>Recent recorded Expenses</h2><Link href="/expenses/history">View all</Link></div>{dashboard.recent.length ? <div className="table-wrap"><table><thead><tr><th>Expense</th><th>Date</th><th>Payee</th><th>Category</th><th>Branch</th><th>Amount</th></tr></thead><tbody>{dashboard.recent.map((expense) => <tr key={expense.id}><td><Link href={`/expenses/${expense.id}`}>{expense.expenseNumber}</Link></td><td>{formatDate(expense.expenseDate)}</td><td>{expense.payeeName ?? "—"}</td><td>{expense.categoryNameSnapshot}</td><td>{expense.branchNameSnapshot ?? "Business-wide"}</td><td>{money(expense.amount.toFixed(2))}</td></tr>)}</tbody></table></div> : <p className="empty-state">No confirmed Expenses yet.</p>}</div>
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function money(value: string) { return `RM ${value}`; }
function formatDate(value: Date) { return value.toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }); }
function resolveDates(query: Query) {
  const now = new Date();
  const year = now.getUTCFullYear(); const month = now.getUTCMonth();
  if (query.range === "last-month") { const start = new Date(Date.UTC(year, month - 1, 1)); const end = new Date(Date.UTC(year, month, 0)); return { from: iso(start), to: iso(end) }; }
  if (query.range === "custom" && validDate(query.from) && validDate(query.to) && query.from! <= query.to!) return { from: query.from!, to: query.to! };
  return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(new Date(Date.UTC(year, month + 1, 0))) };
}
function validDate(value?: string) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function iso(value: Date) { return value.toISOString().slice(0, 10); }
