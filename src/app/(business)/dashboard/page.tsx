import Link from "next/link";
import type { ReactNode } from "react";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { getBusinessPerformanceReadModel, type PerformanceRange } from "@/lib/business-performance/read-model";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";

type Props = { searchParams: Promise<{ branchId?: string; range?: string; from?: string; to?: string }> };
const ranges: Array<{ key: PerformanceRange; label: string }> = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" }, { key: "last_week", label: "Last Week" },
  { key: "month", label: "This Month" }, { key: "last_month", label: "Last Month" },
];

export default async function DashboardPage({ searchParams }: Props) {
  const context = await getBusinessContext();
  if (context.isPlatformAdmin) return <PlatformDashboard />;
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "DASHBOARD");
  const businessId = context.businessId!;
  const params = await searchParams;
  const aiEnabled = await isBusinessModuleEnabled(businessId, "AI");
  const scope = await resolveExpenseReadScope({ access: context.access, businessId, user: context.user });
  const selectedBranchId = params.branchId && scope.allowedBranchIds?.includes(params.branchId) ? params.branchId : null;
  const model = await getBusinessPerformanceReadModel({
    businessId, allowedBranchIds: scope.allowedBranchIds ?? [], includeBusinessWide: Boolean(scope.includeBusinessWide),
    selectedBranchId, range: params.range, from: params.from, to: params.to,
  });
  const spending = model.businessSpending;
  const sales = model.sales;
  const maxTrend = Math.max(1, ...(sales?.trend.map((point) => Math.abs(point.netSalesCents)) ?? [0]));
  return <section className="content dashboard-content performance-dashboard">
    <div className="page-header dashboard-header"><div><h1>Business performance</h1><p>{model.scope.businessName} · Read-only canonical operating view</p>{aiEnabled ? <Link href={aiHref(params, selectedBranchId)}>Ask AI about this period</Link> : null}</div><div className="performance-period"><span>Business period</span><strong>{model.dateRange.from} — {model.dateRange.to}</strong><small>{model.dateRange.timezone} · cutoff {model.dateRange.businessDayCutoffTime}</small></div></div>

    <div className="panel performance-filter-panel">
      <nav className="dashboard-range-tabs" aria-label="Performance date range">{ranges.map((range) => <Link className={model.dateRange.range === range.key ? "active" : ""} href={href(range.key, selectedBranchId)} key={range.key}>{range.label}</Link>)}</nav>
      <form className="performance-filter-form" action="/dashboard"><input type="hidden" name="range" value="custom" /><label><span>From</span><input type="date" name="from" defaultValue={model.dateRange.from} /></label><label><span>To</span><input type="date" name="to" defaultValue={model.dateRange.to} /></label>{scope.branches.length > 1 ? <label><span>Branch</span><select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All authorised branches</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label> : <label><span>Branch</span><strong>{scope.branches[0]?.name ?? "No authorised branch"}</strong></label>}<button>Apply</button></form>
    </div>

    <div className="dashboard-kpis performance-primary-kpis">
      {sales ? <><Metric label="Net Sales" value={moneyCents(sales.netSalesCents)} subValue={comparison(sales.change)} tone="sales" /><Metric label="Transactions" value={sales.transactions} /><Metric label="Average Transaction" value={moneyCents(sales.averageTransactionValueCents)} /><Metric label="Refunds" value={moneyCents(sales.refundsCents)} /></> : <Unavailable label="Sales" />}
      {spending ? <><Metric label="Recorded Business Spending" value={money(spending.recorded)} href="/expenses" /><Metric label="Income vs Recorded Spending" value={money(spending.incomeVsRecordedSpending)} tone={Number(spending.incomeVsRecordedSpending) < 0 ? "danger" : "ready"} /></> : <Unavailable label="Recorded spending" />}
      {model.accountsPayable ? <Metric label="Outstanding AP" value={money(model.accountsPayable.totalOutstanding)} href="/inventory/accounts-payable" tone="warning" /> : null}
    </div>
    <p className="performance-coverage-note">This view is operational and does not represent accounting profit. COGS, accounting inventory valuation, depreciation, tax accounting, General Ledger, Supplier Credit Notes and other accounting adjustments are not included.</p>

    <div className="performance-two-column">
      {sales ? <Panel title="Net Sales Trend" meta="Canonical invoice and refund facts"><div className="performance-trend" role="img" aria-label="Net Sales Trend">{sales.trend.map((point) => <div className="performance-trend-point" key={point.date}><span>{moneyCents(point.netSalesCents)}</span><div style={{ height: `${Math.max(3, Math.round(Math.abs(point.netSalesCents) / maxTrend * 130))}px` }} /><time>{point.date.slice(5)}</time></div>)}</div><p>Previous comparable period: <strong>{moneyCents(sales.previousNetSalesCents)}</strong></p></Panel> : null}
      {spending ? <Panel title="Spending by Source" meta="Materialized Expense facts only"><div className="performance-breakdown">{sourceKeys.map(({ key, label }) => { const row = spending.bySource.find((item) => item.sourceType === key); return <div key={key}><span>{label}</span><strong>{money(row?.amount ?? "0.00")}</strong><small>{row?.count ?? 0} record(s)</small></div>; })}</div><p>Outstanding AP is settlement information and is not added to Recorded Business Spending.</p></Panel> : null}
    </div>

    <div className="performance-two-column">
      <Panel title="Branch Performance" meta="Ranked by Net Sales"><div className="performance-table-wrap"><table><thead><tr><th>Branch</th><th>Net Sales</th><th>Transactions</th><th>Average</th><th>Recorded Spending</th><th>Income vs Spending</th><th>Refunds</th></tr></thead><tbody>{model.branchPerformance.map((row) => <tr key={row.branchId}><td>{row.branchName}</td><td>{moneyCents(row.netSalesCents)}</td><td>{row.transactions}</td><td>{moneyCents(row.averageTransactionValueCents)}</td><td>{row.recordedSpending === null ? "Not included" : money(row.recordedSpending)}</td><td>{row.incomeVsSpending === null ? "Not included" : money(row.incomeVsSpending)}</td><td>{moneyCents(row.refundsCents)}</td></tr>)}</tbody></table></div>{model.coverage.unallocatedBusinessWideSpending && Number(model.coverage.unallocatedBusinessWideSpending) !== 0 ? <p>Business-wide spending kept unallocated: <strong>{money(model.coverage.unallocatedBusinessWideSpending)}</strong></p> : null}</Panel>
      <Panel title="Data Health" meta={model.reconciliationHealth.status === "HEALTHY" ? "Healthy · Issues 0" : `Needs Review · Issues ${model.reconciliationHealth.issues}`}><dl className="performance-health"><div><dt>POS / Sales</dt><dd>{model.reconciliationHealth.domains.sales}</dd></div><div><dt>Expense Sources</dt><dd>{model.reconciliationHealth.domains.expense}</dd></div><div><dt>Inventory</dt><dd>{model.reconciliationHealth.domains.inventory}</dd></div><div><dt>Accounts Payable</dt><dd>{model.reconciliationHealth.domains.ap}</dd></div></dl>{model.reconciliationHealth.status !== "HEALTHY" ? <p className="form-message error">Some data requires reconciliation review. Source facts have not been changed.</p> : null}</Panel>
    </div>

    {(model.topServices.length || model.topProducts.length) ? <div className="performance-two-column"><Ranking title="Top Services" rows={model.topServices} empty="No service sales in this period." /><Ranking title="Top Products" rows={model.topProducts} empty="No product sales in this period." /></div> : null}
    {model.inventory ? <div className="performance-two-column"><Panel title="Inventory Summary" meta="Selling value, not accounting valuation"><div className="performance-breakdown"><Metric label="Tracked Products" value={model.inventory.trackedProducts} /><Metric label="Low Stock" value={model.inventory.lowStock} tone="warning" /><Metric label="Out of Stock" value={model.inventory.outOfStock} tone="danger" /><Metric label="Inventory Selling Value" value={money(model.inventory.sellingValue)} /></div><Link href="/inventory/reorder">Review low stock</Link></Panel>{model.accountsPayable ? <Panel title="Accounts Payable" meta="Liability / settlement view"><div className="performance-breakdown"><Metric label="Outstanding" value={money(model.accountsPayable.totalOutstanding)} /><Metric label="Due Soon" value={model.accountsPayable.dueSoon} /><Metric label="Overdue" value={model.accountsPayable.overdue} tone="danger" /><Metric label="Open Bills" value={model.accountsPayable.openBills} /></div><Link href="/inventory/accounts-payable">Open Accounts Payable</Link></Panel> : null}</div> : null}
    <Panel title="Coverage" meta="Missing module data is not zero"><div className="performance-coverage-grid"><Coverage label="Sales" included={model.coverage.sales} /><Coverage label="Recorded Spending" included={model.coverage.recordedSpending} /><Coverage label="Inventory" included={model.coverage.inventory} /><Coverage label="Accounts Payable" included={model.coverage.accountsPayable} /><Coverage label="COGS" included={false} /><Coverage label="Accounting Profit" included={false} /></div></Panel>
  </section>;
}

async function PlatformDashboard() { const [companies, users] = await Promise.all([prisma.business.count(), prisma.user.count()]); return <section className="content"><div className="page-header"><h1>Platform dashboard</h1></div><div className="dashboard-kpis"><Metric label="Companies" value={companies} /><Metric label="Users" value={users} /></div></section>; }
function Panel({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) { return <section className="panel performance-panel"><div className="section-header"><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>{children}</section>; }
function Metric({ label, value, subValue, href, tone = "default" }: { label: string; value: string | number; subValue?: string; href?: string; tone?: "default" | "sales" | "warning" | "ready" | "danger" }) { const content = <><span>{label}</span><strong>{value}</strong>{subValue ? <small>{subValue}</small> : null}</>; return href ? <Link className={`dashboard-kpi-card ${tone}`} href={href}>{content}</Link> : <div className={`dashboard-kpi-card ${tone}`}>{content}</div>; }
function Unavailable({ label }: { label: string }) { return <div className="dashboard-kpi-card"><span>{label}</span><strong>Not included</strong><small>Module not enabled</small></div>; }
function Coverage({ label, included }: { label: string; included: boolean }) { return <div><span>{label}</span><strong>{included ? "Included" : "Not Available"}</strong></div>; }
function Ranking({ title, rows, empty }: { title: string; rows: Array<{ name: string; quantity: number; sales: string }>; empty: string }) { return <Panel title={title} meta="Canonical invoice line facts">{rows.length ? <ol className="performance-ranking">{rows.map((row) => <li key={row.name}><strong>{row.name}</strong><span>{row.quantity} unit(s)</span><b>{money(row.sales)}</b></li>)}</ol> : <p className="empty-state">{empty}</p>}</Panel>; }
const sourceKeys: Array<{ key: "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE"; label: string }> = [{ key: "MANUAL", label: "Manual" }, { key: "CLAIM", label: "Claims" }, { key: "PAYROLL", label: "Payroll" }, { key: "INVENTORY_PURCHASE", label: "Inventory Purchases" }];
function money(value: unknown) { return `RM ${Number(value ?? 0).toFixed(2)}`; }
function moneyCents(value: number) { return money(value / 100); }
function comparison(value: { kind: string; percentage?: number }) { return value.kind === "PERCENT" ? `${value.percentage! >= 0 ? "+" : ""}${value.percentage}% vs previous` : value.kind === "NEW" ? "New vs previous" : "No change"; }
function href(range: PerformanceRange, branchId: string | null) { const query = new URLSearchParams({ range }); if (branchId) query.set("branchId", branchId); return `/dashboard?${query}`; }
function aiHref(params: { branchId?: string; range?: string; from?: string; to?: string }, branchId: string | null) { const query = new URLSearchParams({ range: params.range ?? "today" }); if (branchId) query.set("branchId", branchId); if (params.from) query.set("from", params.from); if (params.to) query.set("to", params.to); return `/ai?${query}`; }
