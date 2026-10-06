import Link from "next/link";
import { SalonPerformanceSection } from "@/components/dashboard/salon-performance";
import { WalletFinancialSummary } from "@/components/wallet/wallet-financial-summary";
import type { ReactNode } from "react";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { getBusinessPerformanceReadModel, type PerformanceRange } from "@/lib/business-performance/read-model";
import { prisma } from "@/lib/prisma";
import { getBusinessContext } from "@/lib/tenant";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import styles from "./dashboard.module.css";

type Props = { searchParams: Promise<{ branchId?: string; range?: string; from?: string; to?: string }> };
const ranges: Array<{ key: PerformanceRange; label: string }> = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" }, { key: "last_week", label: "Last Week" },
  { key: "month", label: "This Month" }, { key: "last_month", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

export default async function DashboardPage({ searchParams }: Props) {
  const context = await getBusinessContext("VIEW_DASHBOARD");
  if (context.isPlatformAdmin) return <PlatformDashboard />;
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "DASHBOARD");
  const businessId = context.businessId!;
  const params = await searchParams;
  const aiEnabled = await isBusinessModuleEnabled(businessId, "AI");
  const scope = await resolveExpenseReadScope({ access: context.access, businessId, user: context.user });
  const selectedBranchId = params.branchId && scope.allowedBranchIds?.includes(params.branchId) ? params.branchId : null;
  const model = await getBusinessPerformanceReadModel({
    salonAccess: { access: context.access, requestedBranchId: params.branchId === "" ? undefined : params.branchId },
    businessId, allowedBranchIds: scope.allowedBranchIds ?? [], includeBusinessWide: Boolean(scope.includeBusinessWide),
    selectedBranchId, range: params.range, from: params.from, to: params.to,
  });
  const spending = model.businessSpending;
  const sales = model.sales;
  const meaningfulBranches = model.branchPerformance.filter(row =>
    row.netSalesCents !== 0 || row.transactions !== 0 || row.refundsCents !== 0 ||
    Number(row.recordedSpending ?? 0) !== 0 || Number(row.incomeVsSpending ?? 0) !== 0);
  const inventory = model.inventory;
  const ap = model.accountsPayable;
  const wallet = model.walletActivity;
  const hasWalletActivity = wallet && Object.values(wallet).some(value => value !== 0);
  const needsAttention = Boolean(inventory && (inventory.lowStock > 0 || inventory.outOfStock > 0)) || Boolean(ap && (ap.dueSoon > 0 || ap.overdue > 0)) || model.reconciliationHealth.status !== "HEALTHY";
  const maxTrend = Math.max(1, ...(sales?.trend.map((point) => Math.abs(point.netSalesCents)) ?? [0]));
  return <section className="content dashboard-content performance-dashboard">
    <div className="page-header dashboard-header"><div><h1>Business performance</h1><p>{model.scope.businessName}</p>{aiEnabled ? <Link href={aiHref(params, selectedBranchId)}>Ask AI about this period</Link> : null}</div><div className="performance-period"><span>Business period</span><strong>{model.dateRange.from} — {model.dateRange.to}</strong><small>{model.dateRange.timezone} · cutoff {model.dateRange.businessDayCutoffTime}</small></div></div>

    <div className="panel performance-filter-panel">
      <nav className="dashboard-range-tabs" aria-label="Performance date range">{ranges.map((range) => <Link className={model.dateRange.range === range.key ? "active" : ""} href={href(range.key, selectedBranchId)} key={range.key}>{range.label}</Link>)}</nav>
      <form className={`performance-filter-form ${styles.filters}`} action="/dashboard"><input type="hidden" name="range" value={model.dateRange.range} />{model.dateRange.range === "custom" ? <><label><span>From</span><input type="date" name="from" defaultValue={model.dateRange.from} /></label><label><span>To</span><input type="date" name="to" defaultValue={model.dateRange.to} /></label></> : null}{scope.branches.length > 1 ? <label><span>Branch</span><select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All authorised branches</option>{scope.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label> : <><label><span>Branch</span><strong>{scope.branches[0]?.name ?? "No authorised branch"}</strong></label>{selectedBranchId ? <input type="hidden" name="branchId" value={selectedBranchId} /> : null}</>}{model.dateRange.range === "custom" || scope.branches.length > 1 ? <button>Apply</button> : null}</form>
    </div>

    <div className={`dashboard-kpis performance-primary-kpis ${styles.primary}`}>
      {sales ? <><Metric label="Net Sales" value={moneyCents(sales.netSalesCents)} subValue={comparison(sales.change)} tone="sales" /><Metric label="Transactions" value={sales.transactions} /><Metric label="Average Sale" value={moneyCents(sales.averageTransactionValueCents)} /><Metric label="Refunds" value={moneyCents(sales.refundsCents)} /></> : <Unavailable label="Sales" />}
    </div>
    {spending ? <section className={styles.secondary} aria-label="Business spending and balance">
      <div className={styles.metrics}><Metric label="Business Spending" value={money(spending.recorded)} href="/expenses" /><Metric label="Operating Balance" value={money(spending.incomeVsRecordedSpending)} subValue={!sales ? "Sales module not enabled" : undefined} /></div>
      <p>Not accounting profit.</p>
    </section> : null}

    {needsAttention ? <section className={`panel ${styles.attention}`}><h2>Needs Attention</h2><p>Current inventory, bills and data checks — not limited to the selected period.</p><ul>
      {inventory && inventory.lowStock > 0 ? <li><Link href="/inventory/reorder">Low Stock: {inventory.lowStock}</Link></li> : null}
      {inventory && inventory.outOfStock > 0 ? <li><Link href="/inventory/reorder">Out of Stock: {inventory.outOfStock}</Link></li> : null}
      {ap && ap.dueSoon > 0 ? <li><Link href="/inventory/accounts-payable">Due Soon: {ap.dueSoon}</Link></li> : null}
      {ap && ap.overdue > 0 ? <li><Link href="/inventory/accounts-payable">Overdue: {ap.overdue}</Link></li> : null}
      {model.reconciliationHealth.status !== "HEALTHY" ? <li>Some business data needs attention</li> : null}
    </ul></section> : null}

    {sales ? <Panel title="Net Sales Trend"><div className={`performance-trend ${styles.compactTrend}`} role="img" aria-label="Net Sales Trend">{sales.trend.map((point) => <div className="performance-trend-point" key={point.date}><span>{moneyCents(point.netSalesCents)}</span><div style={{ height: `${Math.max(3, Math.round(Math.abs(point.netSalesCents) / maxTrend * 130))}px` }} /><time>{point.date.slice(5)}</time></div>)}</div><p>Previous comparable period: <strong>{moneyCents(sales.previousNetSalesCents)}</strong></p></Panel> : null}

    <SalonPerformanceSection data={model.salonPerformance} query={params} range={model.dateRange.range} monthHref={href("month", selectedBranchId)}>
      {model.topServices.length ? <Ranking title="Top Services" rows={model.topServices} empty="No service sales in this period." quantityLabel="sold" /> : null}
    </SalonPerformanceSection>
    {(!model.salonPerformance && model.topServices.length) || model.topProducts.length ? <div className={styles.rankings}>{!model.salonPerformance && model.topServices.length ? <Ranking title="Top Services" rows={model.topServices} empty="No service sales in this period." quantityLabel="sold" /> : null}{model.topProducts.length ? <Ranking title="Top Products" rows={model.topProducts} empty="No product sales in this period." /> : null}</div> : null}
    {meaningfulBranches.length > 1 ? <Panel title="Branch Performance" meta="Ranked by Net Sales"><div className={styles.branchTable}><table><thead><tr><th>Branch</th><th>Net Sales</th><th>Transactions</th><th>Operating Balance</th></tr></thead><tbody>{meaningfulBranches.map(row => <tr key={row.branchId}><td>{row.branchName}</td><td>{moneyCents(row.netSalesCents)}</td><td>{row.transactions}</td><td>{row.incomeVsSpending === null ? "Not included" : money(row.incomeVsSpending)}</td></tr>)}</tbody></table></div></Panel> : null}

    {hasWalletActivity ? <section className={styles.secondary} aria-label="Wallet summary"><h2>Wallet</h2><div className={styles.metrics}><Metric label="Top-ups" value={moneyCents(wallet.topUpPrincipalCents)} /><Metric label="Wallet used" value={moneyCents(wallet.redemptionPaidCents + wallet.redemptionBonusCents)} /><Metric label="Wallet refunds" value={moneyCents(wallet.refundPaidCents + wallet.refundBonusCents)} /></div><p>Top-ups show principal only, not sales. Wallet used and refunds include paid and bonus credit. Reversals and restored credit are in More details.</p></section> : null}

    <details className={`panel ${styles.details}`}><summary>More details</summary><div className={styles.detailContent}>
      {spending ? <Panel title="Spending by Source"><div className="performance-breakdown">{sourceKeys.map(({ key, label }) => { const row = spending.bySource.find(item => item.sourceType === key); return row && (row.count > 0 || Number(row.amount) !== 0) ? <div key={key}><span>{label}</span><strong>{money(row.amount)}</strong><small>{row.count} record(s)</small></div> : null; })}</div>{!spending.bySource.length ? <p>No recorded spending in this period.</p> : null}<p>Outstanding supplier balances are not added again to Business Spending.</p></Panel> : null}
      {model.coverage.unallocatedBusinessWideSpending && Number(model.coverage.unallocatedBusinessWideSpending) !== 0 ? <p>Business-wide spending kept unallocated: <strong>{money(model.coverage.unallocatedBusinessWideSpending)}</strong></p> : null}
      {hasWalletActivity ? <WalletFinancialSummary activity={wallet} /> : null}
      {inventory ? <Panel title="Inventory Summary" meta="Current · Estimated at selling prices"><div className="performance-breakdown"><Metric label="Tracked Products" value={inventory.trackedProducts} /><Metric label="Inventory Selling Value" value={money(inventory.sellingValue)} /></div><Link href="/inventory/reorder">Review stock</Link></Panel> : null}
      {ap ? <Panel title="Accounts Payable" meta="Current unpaid supplier bills"><div className="performance-breakdown"><Metric label="Outstanding" value={money(ap.totalOutstanding)} /><Metric label="Open Bills" value={ap.openBills} /></div><Link href="/inventory/accounts-payable">Open Accounts Payable</Link></Panel> : null}
      <section><h2>About this dashboard</h2><p>This view is operational and does not represent accounting profit. COGS, accounting inventory valuation, depreciation, tax accounting, General Ledger, Supplier Credit Notes and other accounting adjustments are not included.</p><p>Business Spending includes recorded expenses. Operating Balance is Net Sales minus Business Spending. Inventory and Accounts Payable show current state, not historical period-end balances. Low Stock and Out of Stock counts can overlap.</p><p>Missing module data is not zero. Only enabled data sources are included.</p></section>
    </div></details>
  </section>;
}

async function PlatformDashboard() { const [companies, users] = await Promise.all([prisma.business.count(), prisma.user.count()]); return <section className="content"><div className="page-header"><h1>Platform dashboard</h1></div><div className="dashboard-kpis"><Metric label="Companies" value={companies} /><Metric label="Users" value={users} /></div></section>; }
function Panel({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) { return <section className="panel performance-panel"><div className="section-header"><h2>{title}</h2>{meta ? <span>{meta}</span> : null}</div>{children}</section>; }
function Metric({ label, value, subValue, href, tone = "default" }: { label: string; value: string | number; subValue?: string; href?: string; tone?: "default" | "sales" | "warning" | "ready" | "danger" }) { const content = <><span>{label}</span><strong>{value}</strong>{subValue ? <small>{subValue}</small> : null}</>; return href ? <Link className={`dashboard-kpi-card ${tone}`} href={href}>{content}</Link> : <div className={`dashboard-kpi-card ${tone}`}>{content}</div>; }
function Unavailable({ label }: { label: string }) { return <div className="dashboard-kpi-card"><span>{label}</span><strong>Not included</strong><small>Module not enabled</small></div>; }
function Ranking({ title, rows, empty, quantityLabel = "unit(s)" }: { title: string; rows: Array<{ serviceId?: string; name: string; quantity: number; sales: string }>; empty: string; quantityLabel?: string }) { return <Panel title={title}>{rows.length ? <ol className={`performance-ranking ${styles.ranking}`}>{rows.map((row) => <li key={row.serviceId ?? row.name}><strong>{row.name}</strong><span>{row.quantity} {quantityLabel}</span><b>{money(row.sales)}</b></li>)}</ol> : <p className="empty-state">{empty}</p>}</Panel>; }
const sourceKeys: Array<{ key: "MANUAL" | "CLAIM" | "PAYROLL" | "INVENTORY_PURCHASE"; label: string }> = [{ key: "MANUAL", label: "Manual" }, { key: "CLAIM", label: "Claims" }, { key: "PAYROLL", label: "Payroll" }, { key: "INVENTORY_PURCHASE", label: "Inventory Purchases" }];
function money(value: unknown) { return `RM ${Number(value ?? 0).toFixed(2)}`; }
function moneyCents(value: number) { return money(value / 100); }
function comparison(value: { kind: string; percentage?: number }) { return value.kind === "PERCENT" ? `${value.percentage! >= 0 ? "+" : ""}${value.percentage}% vs previous` : value.kind === "NEW" ? "New vs previous" : "No change"; }
function href(range: PerformanceRange, branchId: string | null) { const query = new URLSearchParams({ range }); if (branchId) query.set("branchId", branchId); return `/dashboard?${query}`; }
function aiHref(params: { branchId?: string; range?: string; from?: string; to?: string }, branchId: string | null) { const query = new URLSearchParams({ range: params.range ?? "today" }); if (branchId) query.set("branchId", branchId); if (params.from) query.set("from", params.from); if (params.to) query.set("to", params.to); return `/ai?${query}`; }
