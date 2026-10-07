import Link from "next/link";
import type { ReactNode } from "react";
import type { readPackageHubOverview, readPackageHubActivity, readPackageHubSales, readPackageHubCustomerPackages } from "@/lib/packages/hub-read-model";
import { packageViews, packageRanges, packageHubHref, nextPackageHubQuery, previousPackageHubQuery, type PackageHubQuery, type resolvePackageHubPeriod } from "@/lib/packages/hub-presentation";
import { formatDailyClosingGeneratedAt } from "@/lib/daily-closing/format";
import { PackageDrawer } from "./package-drawer";
import { PackageSettingsMenu } from "./package-settings-menu";
import styles from "./package-hub.module.css";
export type PackageHubProps = {
  query: PackageHubQuery; period: ReturnType<typeof resolvePackageHubPeriod>; timezone: string; branches: { id: string; name: string }[];
  canManage: boolean; canViewCustomers: boolean; invoiceViewIds: string[];
  overview?: Awaited<ReturnType<typeof readPackageHubOverview>>; activity?: Awaited<ReturnType<typeof readPackageHubActivity>>;
  sales?: Awaited<ReturnType<typeof readPackageHubSales>>; customers?: Awaited<ReturnType<typeof readPackageHubCustomerPackages>>;
};
const viewLabels = { overview: "Overview", activity: "Activity", sales: "Package Sales", customers: "Customer Packages" };
const rangeLabels = { today: "Today", month: "This Month", "last-month": "Last Month", custom: "Custom" };
const eventLabels = { PURCHASED: "Purchased", USED: "Used", RESTORED: "Restored", CANCELLED: "Cancelled" };
const statusLabels = { ACTIVE: "Active", USED_UP: "Used up", PENDING_PAYMENT: "Awaiting payment", CANCELLED: "Cancelled" };
const legacyMessage = "Earlier package activity is unavailable.";
type Event = NonNullable<PackageHubProps["activity"]>["rows"][number];
export function PackageHub(props: PackageHubProps) {
  const { query: q, period, branches, overview, activity, sales, customers } = props;
  const date = (d: Date) => formatDailyClosingGeneratedAt(d, props.timezone);
  const href = (change: Partial<PackageHubQuery>) => packageHubHref(q, { ...change, cursor: undefined, back: [] });
  const customer = (id: string, name: string) => props.canViewCustomers ? <Link href={`/crm/customers/${id}`}>{name}</Link> : name;
  const events = q.view === "overview" ? activity?.rows.slice(0, 5) : q.view === "sales" ? sales?.rows : activity?.rows;
  const page = q.view === "activity" ? activity : q.view === "sales" ? sales : customers;
  const previous = previousPackageHubQuery(q);
  const showBranch = branches.length > 1 || Boolean(q.branchId);
  return <section className={`content ${styles.hub}`}>
    <header className={styles.header}><div><h1>Packages</h1><p>Balances and activity at a glance.</p></div>{props.canManage ? <PackageSettingsMenu /> : null}</header>
    <nav className={styles.tabs} aria-label="Package views">{packageViews.map(view => <Link key={view} href={href({ view })} aria-current={q.view === view ? "page" : undefined}>{viewLabels[view]}</Link>)}</nav>
    <div className={styles.toolbar}>
      {q.view !== "customers" ? <nav className={styles.ranges} aria-label="Package period">{packageRanges.map(range => <Link key={range} href={href({ range, ...(range === "custom" ? { from: period.fromDateValue, to: period.toDateValue } : {}) })} aria-current={q.range === range ? "page" : undefined}>{rangeLabels[range]}</Link>)}</nav> : null}
      <form action="/package-hub" className={styles.filters}>
        <input type="hidden" name="view" value={q.view} /><input type="hidden" name="range" value={q.range} />
        {branches.length > 1 ? <label>Branch<select name="branchId" defaultValue={q.branchId ?? "all"}><option value="all">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label> : q.branchId ? <input type="hidden" name="branchId" value={q.branchId} /> : null}
        {q.view !== "overview" ? <><label>Customer<input name="q" defaultValue={q.q} placeholder="Search customer" maxLength={160} /></label><label>Package<input name="packageSearch" defaultValue={q.packageSearch} placeholder="Search package" maxLength={160} /></label></> : null}
        {q.view === "activity" ? <label className={styles.typeFilter}>Activity type<select name="type" defaultValue={q.type ?? ""}><option value="">All activity</option>{Object.entries(eventLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label> : null}
        {q.view === "customers" ? <label className={styles.typeFilter}>Status<select name="status" defaultValue={q.status ?? ""}><option value="">All statuses</option>{Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label> : null}
        {q.range === "custom" && q.view !== "customers" ? <div className={styles.dates}><label>From<input type="date" name="from" defaultValue={q.from} required /></label><label>To<input type="date" name="to" defaultValue={q.to} required /></label><button type="submit">Apply</button></div> : <>{q.range === "custom" ? <><input type="hidden" name="from" value={q.from} /><input type="hidden" name="to" value={q.to} /></> : null}{q.view !== "overview" || branches.length > 1 ? <button type="submit">Apply</button> : null}</>}
      </form>
    </div>
    {showBranch ? <p className={styles.context}>{branches.find(b => b.id === q.branchId)?.name ?? "All branches"}</p> : null}
    {q.view === "overview" && overview ? <div className={styles.summary}>
      <section><h2>Current state</h2><div className={styles.metrics}><Metric label="Active packages" value={overview.current.activePackages} /><Metric label="Used-up packages" value={overview.current.currentlyUsedUp} /></div></section>
      <section><h2>Period activity{q.range === "custom" ? <small>{period.label}</small> : null}</h2><div className={styles.metrics}><Metric label="Packages sold" value={overview.period.packagesSold} /><Metric label="Uses" value={overview.period.packageUses} /><Metric label="Uses restored" value={overview.period.restoredUses} /></div></section>
    </div> : null}
    {q.view !== "customers" ? <Panel title={q.view === "overview" ? "Recent Package Activity" : viewLabels[q.view]}>
      {events?.length ? <Table label={q.view === "sales" ? "Package sales" : "Package activity"}><thead><tr><th className={styles.secondary}>{q.view === "sales" ? "Purchase date" : "Date"}</th><th>{q.view === "sales" ? "Customer" : "Customer / Package"}</th>{q.view === "sales" ? <><th className={styles.packageColumn}>Package</th><th className={styles.number}>Purchase price</th><th className={`${styles.number} ${styles.secondary}`}>Total Uses</th><th className={`${styles.number} ${styles.secondary}`}>Uses Left</th><th>Current status</th></> : <><th>Activity type</th><th className={styles.number}>Uses Changed</th><th className={`${styles.number} ${styles.secondary}`}>Uses Left</th></>}<th><span className={styles.srOnly}>View</span></th></tr></thead><tbody>{events.map(row => <tr key={row.activityId}>
        <td className={`${styles.secondary} ${styles.date}`}>{date(row.occurredAt)}</td><td>{customer(row.customerId, row.customerName)}<div className={q.view === "sales" ? styles.mobilePackage : undefined}><PackageName name={row.packageName} limited={row.historyMayBeIncomplete} /></div></td>
        {q.view === "sales" ? <><td className={styles.packageColumn}><PackageName name={row.packageName} limited={row.historyMayBeIncomplete} /></td><td className={styles.number}>RM{row.purchasePrice}</td><td className={`${styles.number} ${styles.secondary}`}>{row.initialTotalUses}</td><td className={`${styles.number} ${styles.secondary}`}>{row.remainingUses}</td><td><span className={styles.badge}>{statusLabels[row.status]}</span></td></> : <><td><span className={styles.badge}>{eventLabels[row.eventType]}</span></td><td className={styles.number}><strong>{row.usesChanged > 0 ? "+" : ""}{row.usesChanged}</strong></td><td className={`${styles.number} ${styles.secondary}`}>{row.remainingAfter}</td></>}
        <td className={styles.action}><PackageDrawer title={q.view === "sales" ? "Package purchase" : eventLabels[row.eventType]} customer={row.customerName}><EventDetail row={row} props={props} sales={q.view === "sales"} /></PackageDrawer></td>
      </tr>)}</tbody></Table> : <p className={styles.empty}>{q.view === "sales" ? "No package purchases recorded in this period." : "No package activity in this period."}</p>}
      {q.view === "overview" && events?.length ? <Link className={styles.allLink} href={href({ view: "activity" })}>View all activity →</Link> : null}
    </Panel> : <Panel title="Customer Packages">
      {customers?.rows.length ? <Table label="Customer packages"><thead><tr><th>Customer</th><th className={styles.packageColumn}>Package</th><th className={styles.number}>Uses Left</th><th>Status</th>{showBranch ? <th className={styles.secondary}>Branch</th> : null}<th><span className={styles.srOnly}>View</span></th></tr></thead><tbody>{customers.rows.map(row => <tr key={row.customerPackageId}><td>{customer(row.customerId, row.customerName)}<div className={styles.mobilePackage}><PackageName name={row.packageName} limited={row.historyMayBeIncomplete} /></div></td><td className={styles.packageColumn}><PackageName name={row.packageName} limited={row.historyMayBeIncomplete} /></td><td className={styles.number}><strong>{row.remainingUses}</strong> / {row.totalUses}</td><td><span className={styles.badge}>{statusLabels[row.status]}</span></td>{showBranch ? <td className={styles.secondary}>{row.branchName ?? "All branches"}</td> : null}<td className={styles.action}><PackageDrawer title="Customer package" customer={row.customerName}>
        <div className={styles.detailTitle}><strong>{row.packageName}</strong><span>{row.customerName}</span></div>
        <Facts title="Package uses"><Fact label="Uses Left" value={`${row.remainingUses} / ${row.totalUses}`} /><Fact label="Status" value={statusLabels[row.status]} /><Fact label="Branch" value={row.branchName ?? "All branches"} /><Fact label="Purchased" value={date(row.purchasedAt)} />{row.lastActivityAt ? <Fact label="Last activity" value={date(row.lastActivityAt)} /> : null}</Facts>
        {row.serviceBalances.length ? <Facts title="Uses by Service">{row.serviceBalances.map(b => <Fact key={b.balanceId} label={b.serviceName} value={`${b.remainingUses} / ${b.totalUses}`} />)}</Facts> : null}
        {row.historyMayBeIncomplete ? <p className={styles.notice}>{legacyMessage}</p> : null}
      </PackageDrawer></td></tr>)}</tbody></Table> : <p className={styles.empty}>No customer packages match these filters.</p>}
    </Panel>}
    {q.view !== "overview" && (q.view === "customers" || Boolean(page?.rows.length)) ? <nav className={styles.pagination} aria-label="Package pagination"><span>20 per page</span>{previous ? <Link href={packageHubHref(previous)}>Previous</Link> : <span aria-disabled="true">Previous</span>}{page?.nextCursor ? <Link href={packageHubHref(nextPackageHubQuery(q, page.nextCursor))}>Next</Link> : <span aria-disabled="true">Next</span>}</nav> : null}
  </section>;
}
function PackageName({ name, limited }: { name: string; limited: boolean }) { return <><span className={styles.sub}>{name}</span>{limited ? <span className={styles.history}>Limited history</span> : null}</>; }
function EventDetail({ row, props, sales }: { row: Event; props: PackageHubProps; sales: boolean }) {
  return <><div className={styles.detailTitle}><strong>{row.packageName}</strong><span>{row.customerName}</span><small>{formatDailyClosingGeneratedAt(row.occurredAt, props.timezone)}</small></div>
    <Facts title={sales ? "Purchase" : "Uses Changed"}>{sales ? <><Fact label="Purchase price" value={`RM${row.purchasePrice}`} /><Fact label="Total Uses" value={row.initialTotalUses} /><Fact label="Uses Left" value={row.remainingUses} /></> : <><Fact label="Before" value={row.remainingBefore} /><Fact label="After" value={row.remainingAfter} /><Fact label="Uses Changed" value={`${row.usesChanged > 0 ? "+" : ""}${row.usesChanged}`} />{row.requestedUses != null ? <Fact label="Requested restore" value={row.requestedUses} /> : null}</>}<Fact label={sales ? "Current status" : "Status after"} value={statusLabels[sales ? row.status : row.statusAfter]} /></Facts>
    <Facts title="Details">{row.serviceName ? <Fact label="Service" value={row.serviceName} /> : null}{row.branchName ? <Fact label="Branch" value={row.branchName} /> : null}{row.actorName ? <Fact label="Recorded by" value={row.actorName} /> : null}{row.assignedStaffName ? <Fact label="Service staff" value={row.assignedStaffName} /> : null}</Facts>
    {row.historyMayBeIncomplete ? <p className={styles.notice}>{legacyMessage}</p> : null}
    <div className={styles.links}>{row.invoiceId && props.invoiceViewIds.includes(row.invoiceId) ? <Link href={`/invoices/${row.invoiceId}`}>View invoice →</Link> : null}{props.canViewCustomers ? <Link href={`/crm/customers/${row.customerId}`}>View customer →</Link> : null}</div>
  </>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.panel}><h2>{title}</h2>{children}</section>; }
function Table({ label, children }: { label: string; children: ReactNode }) { return <div className={styles.tableWrap}><table aria-label={label}>{children}</table></div>; }
function Facts({ title, children }: { title: string; children: ReactNode }) { return <section className={styles.facts}><h3>{title}</h3><dl>{children}</dl></section>; }
function Fact({ label, value }: { label: string; value: ReactNode }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
