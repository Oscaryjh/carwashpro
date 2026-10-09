import Link from "next/link";
import type { ReactNode } from "react";
import type { readWalletHubOverview, readWalletHubTransactions, readWalletHubTopUps, readWalletHubCustomerBalances } from "@/lib/wallet/hub-read-model";
import { activityLabels, hubHref, hubMoney, hubRanges, hubViews, nextHubQuery, previousHubQuery, type HubQuery, type resolveHubPeriod } from "@/lib/wallet/hub-presentation";
import { formatDailyClosingGeneratedAt } from "@/lib/daily-closing/format";
import styles from "./wallet-hub.module.css";
import { WalletHubBranchFilter } from "./wallet-hub-branch-filter";
import { WalletActivityDrawer } from "./wallet-activity-drawer";
import { WalletSettingsMenu } from "./wallet-settings-menu";
const badges = { TOP_UP: "Top-up", WALLET_USED: "Used", WALLET_REFUND: "Refund", TOP_UP_REVERSAL: "Reversal", VOID_RESTORE: "VOID Restore" };

export type WalletHubProps = {
  query: HubQuery; period: ReturnType<typeof resolveHubPeriod>; timezone: string;
  branches: Array<{ id: string; name: string }>; invoiceViewIds: string[]; canViewCustomers: boolean;
  canManageTopUpOffers?: boolean;
  overview?: Awaited<ReturnType<typeof readWalletHubOverview>>;
  transactions?: Awaited<ReturnType<typeof readWalletHubTransactions>>;
  topUps?: Awaited<ReturnType<typeof readWalletHubTopUps>>;
  balances?: Awaited<ReturnType<typeof readWalletHubCustomerBalances>>;
};
const viewLabels = { overview: "Overview", transactions: "Transactions", "top-ups": "Top-ups", balances: "Customer Balances" };
const rangeLabels = { today: "Today", month: "This Month", "last-month": "Last Month", custom: "Custom" };
const methods: Record<string, string> = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer", DUITNOW: "DuitNow", MEMBER_WALLET: "Wallet", EWALLET: "E-wallet" };
export function WalletHub(props: WalletHubProps) {
  const { query, period, branches, overview, transactions, topUps, balances } = props;
  const date = (value: Date) => formatDailyClosingGeneratedAt(value, props.timezone);
  const selectedBranch = branches.find(branch => branch.id === query.branchId);
  const customer = (id: string, name: string) => props.canViewCustomers ? <Link href={`/crm/customers/${id}`}>{name}</Link> : name;
  const customerView = (id: string) => props.canViewCustomers ? <Link href={`/crm/customers/${id}`} className={styles.rowAction} aria-label="View Customer Wallet">›</Link> : "—";
  const activityRows = query.view === "overview" ? transactions?.rows.slice(0, 5) : transactions?.rows;
  const nextCursor = query.view === "transactions" ? transactions?.nextCursor : query.view === "top-ups" ? topUps?.nextCursor : balances?.nextCursor;
  const previous = previousHubQuery(query);
  return <section className={`content ${styles.hub}`}>
    <div className={styles.consoleHeader}><header className={`page-header ${styles.walletHeader}`}><div><h1>Wallet</h1><p>Customer wallet balances and activity.</p></div>{props.canManageTopUpOffers ? <WalletSettingsMenu /> : null}</header>
    <nav className={styles.tabs} aria-label="Wallet views">{hubViews.map(view => <Link key={view} href={hubHref(query, { view, cursor: undefined, back: [] })} aria-current={query.view === view ? "page" : undefined}>{viewLabels[view]}</Link>)}</nav>
    <div className={styles.filters}>
      {query.view !== "balances" ? <nav className={styles.ranges} aria-label="Wallet period">{hubRanges.map(range => <Link key={range} href={hubHref(query, { range, ...(range === "custom" ? { from: period.fromDateValue, to: period.toDateValue } : {}), cursor: undefined, back: [] })} aria-current={query.range === range ? "page" : undefined}>{rangeLabels[range]}</Link>)}</nav> : null}
      <form action="/wallet" className={styles.filterForm}>
        <input type="hidden" name="view" value={query.view} />
        {query.view !== "balances" ? <><input type="hidden" name="range" value={query.range} />{branches.length > 1 ? <WalletHubBranchFilter key={query.branchId ?? "all"} branches={branches} selected={query.branchId} /> : query.branchId ? <input type="hidden" name="branchId" value={query.branchId} /> : null}</> : null}
        {query.view !== "overview" ? <label className={styles.search}>Customer search<input name="q" defaultValue={query.q} placeholder="Search customer..." maxLength={160} /></label> : null}
        {query.view === "transactions" ? <label>Type<select name="type" defaultValue={query.type ?? ""}><option value="">All types</option>{Object.entries(activityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label> : null}
        {query.view !== "balances" && query.range === "custom" ? <div className={styles.customDates}><label>From<input type="date" name="from" defaultValue={query.from} required /></label><label>To<input type="date" name="to" defaultValue={query.to} required /></label><button type="submit">Apply</button></div> : query.view !== "overview" || branches.length > 1 ? <button type="submit">Apply</button> : null}
      </form>
    </div>
      {query.view !== "balances" ? <p className={styles.context}>{period.label}{selectedBranch ? ` · Activity filtered by ${selectedBranch.name}` : " · All branches"}</p> : <p className={styles.context}>All customers · Current balances</p>}
    </div>
    {query.view === "overview" && overview ? <>
      <div className={styles.metrics}>
        <Metric label="Total Wallet Balance" value={hubMoney(overview.currentBalance.total)}><small title="Current balance across all customers">Paid {hubMoney(overview.currentBalance.paid)} · Bonus {hubMoney(overview.currentBalance.bonus)}</small></Metric>
        <Metric label="Top-ups" value={hubMoney(overview.period.topUps)}><small>{period.label} · Paid amount</small></Metric>
        <Metric label="Wallet Used" value={hubMoney(overview.period.walletUsed)}><small>{period.label}</small></Metric>
        <Metric label="Refunds" value={hubMoney(overview.period.walletRefunds)}><small>{period.label}</small></Metric>
      </div>
      {overview.period.topUpReversals !== "0.00" || overview.period.voidRestores !== "0.00" ? <div className={styles.supplement}>
        {overview.period.topUpReversals !== "0.00" ? <span>Top-up Reversals <strong>{hubMoney(overview.period.topUpReversals)}</strong></span> : null}
        {overview.period.voidRestores !== "0.00" ? <span>VOID Restores <strong>{hubMoney(overview.period.voidRestores)}</strong></span> : null}
      </div> : null}
    </> : null}
    {query.view === "overview" || query.view === "transactions" ? <Panel title={query.view === "overview" ? "Recent Wallet Activity" : "Transactions"}>
      {activityRows?.length ? <Table label="Wallet activity"><thead><tr><th>Date</th><th>Customer</th><th>Type</th><th className={styles.amount}>Amount</th><th className={`${styles.amount} ${styles.secondaryColumn}`}>Balance</th><th className={styles.actionColumn}><span className={styles.srOnly}>Action</span></th></tr></thead><tbody>{activityRows.map(row => <tr key={row.id}>
        <td className={styles.date}>{date(row.date)}</td><td>{customer(row.customerId, row.customerName)}</td><td><span className={styles.badge}>{badges[row.type]}</span></td><td className={styles.amount}><strong>{hubMoney(row.amount, true)}</strong></td><td className={`${styles.amount} ${styles.secondaryColumn}`}>{hubMoney(row.balanceAfterTotal)}</td>
        <td className={styles.actionColumn}><WalletActivityDrawer title={activityLabels[row.type]} amount={hubMoney(row.amount, true)} date={date(row.date)} customer={row.customerName}>
          <DetailGroup title="Balance after"><Fact label="Total Wallet Balance" value={hubMoney(row.balanceAfterTotal)} /><Fact label="Paid balance" value={hubMoney(row.balanceAfterPaid)} /><Fact label="Bonus balance" value={hubMoney(row.balanceAfterBonus)} /></DetailGroup>
          <DetailGroup title="Amount breakdown"><Fact label="Paid amount" value={hubMoney(row.paidAmount, true)} /><Fact label="Bonus" value={hubMoney(row.bonusAmount, true)} /></DetailGroup>
          {row.paymentMethod || row.staffName || row.branchName || row.reference ? <DetailGroup title="Details"><ContextFacts row={row} /></DetailGroup> : null}
          {props.canViewCustomers || (row.invoiceId && props.invoiceViewIds.includes(row.invoiceId)) ? <div className={styles.drawerLinks}>{row.invoiceId && props.invoiceViewIds.includes(row.invoiceId) ? <Link href={`/invoices/${row.invoiceId}`}>View invoice →</Link> : null}{props.canViewCustomers ? <Link href={`/crm/customers/${row.customerId}`}>View customer →</Link> : null}</div> : null}
        </WalletActivityDrawer></td>
      </tr>)}</tbody></Table> : <p className={styles.empty}>No wallet activity in this period.</p>}
      {query.view === "overview" ? <Link className={styles.allLink} href={hubHref(query, { view: "transactions", cursor: undefined, back: [] })}>View all transactions →</Link> : null}
    </Panel> : null}
    {query.view === "top-ups" ? <Panel title="Top-ups">
      {topUps?.rows.length ? <Table label="Wallet top-ups"><thead><tr><th className={styles.secondaryColumn}>Date</th><th>Customer</th><th className={styles.amount}>Paid</th><th className={styles.amount}>Bonus</th><th className={styles.amount}>Total Added</th><th className={styles.desktopColumn}>Method</th><th className={styles.secondaryColumn}>Status</th><th className={styles.actionColumn}><span className={styles.srOnly}>Action</span></th></tr></thead><tbody>{topUps.rows.map(row => <tr key={row.topUpId}>
        <td className={`${styles.date} ${styles.secondaryColumn}`}>{date(row.date)}</td><td>{customer(row.customerId, row.customerName)}</td><td className={styles.amount}>{hubMoney(row.paidAmount)}</td><td className={styles.amount}>{hubMoney(row.bonusAmount)}</td><td className={styles.amount}><strong>{hubMoney(row.totalAdded)}</strong></td><td className={styles.desktopColumn}>{row.paymentMethod ? methods[row.paymentMethod] ?? row.paymentMethod : "—"}</td><td className={styles.secondaryColumn}><span className={styles.badge}>{row.status}</span></td>
        <td className={styles.actionColumn}><WalletActivityDrawer title="Top-up" amount={`${hubMoney(row.totalAdded)} added`} date={date(row.date)} customer={row.customerName}>
          <DetailGroup title="Amount breakdown"><Fact label="Paid amount" value={hubMoney(row.paidAmount)} /><Fact label="Bonus" value={hubMoney(row.bonusAmount)} /><Fact label="Total added" value={hubMoney(row.totalAdded)} /></DetailGroup>
          <DetailGroup title="Details"><Fact label="Status" value={row.status} /><Fact label="Posted at" value={date(row.date)} /><ContextFacts row={row} /></DetailGroup>
          {props.canViewCustomers ? <div className={styles.drawerLinks}><Link href={`/crm/customers/${row.customerId}`}>View customer →</Link></div> : null}
        </WalletActivityDrawer></td>
      </tr>)}</tbody></Table> : <p className={styles.empty}>No top-ups in this period.</p>}
    </Panel> : null}
    {query.view === "balances" ? <Panel title="Customer Balances">
      {balances?.rows.length ? <Table label="Customer wallet balances"><thead><tr><th>Customer</th><th className={styles.amount}>Total Wallet Balance</th><th className={`${styles.amount} ${styles.secondaryColumn}`}>Paid</th><th className={`${styles.amount} ${styles.secondaryColumn}`}>Bonus</th><th className={styles.secondaryColumn}>Last Activity</th><th className={styles.actionColumn}><span className={styles.srOnly}>Action</span></th></tr></thead><tbody>{balances.rows.map(row => <tr key={row.customerId}>
        <td>{customer(row.customerId, row.customerName)}</td><td className={styles.amount}><strong className={styles.primaryBalance}>{hubMoney(row.totalBalance)}</strong><small className={styles.compactBalanceFacts}>Paid {hubMoney(row.paidBalance)} · Bonus {hubMoney(row.bonusBalance)}{row.lastActivityAt ? <span>Last activity {date(row.lastActivityAt)}</span> : null}</small></td><td className={`${styles.amount} ${styles.secondaryColumn}`}>{hubMoney(row.paidBalance)}</td><td className={`${styles.amount} ${styles.secondaryColumn}`}>{hubMoney(row.bonusBalance)}</td><td className={`${styles.date} ${styles.secondaryColumn}`}>{row.lastActivityAt ? date(row.lastActivityAt) : "—"}</td><td className={styles.actionColumn}>{customerView(row.customerId)}</td>
      </tr>)}</tbody></Table> : <p className={styles.empty}>No customer wallet balances yet.</p>}
    </Panel> : null}
    {query.view !== "overview" ? <nav className={styles.pagination} aria-label="Wallet pages"><span>20 per page</span>{previous ? <Link href={hubHref(previous)}>Previous</Link> : <span aria-disabled="true">Previous</span>}{nextCursor ? <Link href={hubHref(nextHubQuery(query, nextCursor))}>Next</Link> : <span aria-disabled="true">Next</span>}</nav> : null}
  </section>;
}
function Metric({ label, value, children }: { label: string; value: string; children: ReactNode }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong>{children}</div>; }
function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <section className={styles.panel}><h2>{title}</h2>{description ? <p className={styles.context}>{description}</p> : null}{children}</section>; }
function Table({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={label}><table>{children}</table></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function DetailGroup({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.detailGroup}><h3>{title}</h3><dl>{children}</dl></section>; }
function ContextFacts({ row }: { row: { paymentMethod: string | null; staffName: string | null; branchName: string | null; reference: string | null } }) { return <>
  {row.paymentMethod ? <Fact label="Payment method" value={methods[row.paymentMethod] ?? row.paymentMethod} /> : null}{row.staffName ? <Fact label="Staff" value={row.staffName} /> : null}{row.branchName ? <Fact label="Branch" value={row.branchName} /> : null}{row.reference ? <Fact label="Reference" value={row.reference} /> : null}
</>; }
