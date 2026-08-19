import Link from "next/link";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  formatLocalDate,
  getEmployeeLeaveDrilldown,
  getLeaveAdjustmentReport,
  getLeaveBalanceReport,
  getLeaveCarryReport,
  getLeaveOverview,
  getLeaveReportOptions,
  getLeaveUsageReport,
  type LeaveReportFilters,
} from "@/lib/leave/reporting-service";
import styles from "./reports.module.css";

type ReportTab = "overview" | "balances" | "usage" | "carry" | "adjustments";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TABS: readonly { key: ReportTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "balances", label: "Balances" },
  { key: "usage", label: "Usage" },
  { key: "carry", label: "Carry forward" },
  { key: "adjustments", label: "Adjustments" },
];

export default async function LeaveReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { access } = await requireBusinessUser("VIEW_LEAVE");
  const scope = await resolveAttendanceScope(access);
  const params = await searchParams;
  const canViewAdjustments = hasBusinessCapability(access, "ADJUST_LEAVE_BALANCE");
  const requestedTab = value(params.tab);
  const tab: ReportTab = TABS.some((item) => item.key === requestedTab)
    && (requestedTab !== "adjustments" || canViewAdjustments)
    ? requestedTab as ReportTab
    : "overview";
  const filters = parseFilters(params);
  const options = await getLeaveReportOptions(scope);
  const memberId = value(params.member);
  const [report, drilldown] = await Promise.all([
    tab === "overview" ? getLeaveOverview(scope, filters)
      : tab === "balances" ? getLeaveBalanceReport(scope, filters)
        : tab === "usage" ? getLeaveUsageReport(scope, filters)
          : tab === "carry" ? getLeaveCarryReport(scope, filters)
            : getLeaveAdjustmentReport(scope, filters),
    memberId ? getEmployeeLeaveDrilldown(scope, memberId, filters) : Promise.resolve(null),
  ]);
  const query = persistentQuery(params, ["page", "member"]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Leave intelligence</p>
          <h1>Leave reports</h1>
          <p>Balances, approved usage and carry-forward evidence from the canonical Leave ledger.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/team/leave">Leave management</Link>
          <Link className={styles.primaryButton} href={`/team/leave/reports/export?tab=${tab}&${query}`}>Export CSV</Link>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Leave report sections">
        {TABS.filter((item) => item.key !== "adjustments" || canViewAdjustments).map((item) => (
          <Link key={item.key} className={tab === item.key ? styles.activeTab : undefined} href={`?tab=${item.key}&${query}`}>
            {item.label}
          </Link>
        ))}
      </nav>

      <details className={styles.filters} open={hasFilters(params)}>
        <summary>
          <span>Report filters</span>
          <small>{formatLocalDate(filters.from)} – {formatLocalDate(filters.to)}</small>
        </summary>
        <form className={styles.filterGrid}>
          <input type="hidden" name="tab" value={tab} />
          <label>Period
            <select name="preset" defaultValue={value(params.preset) || "this_year"}>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="this_year">This year</option>
              <option value="last_year">Last year</option>
              <option value="custom">Custom range</option>
            </select>
          </label>
          <label>From<input type="date" name="from" defaultValue={isoDate(filters.from)} /></label>
          <label>To<input type="date" name="to" defaultValue={isoDate(filters.to)} /></label>
          {options.branches.length > 1 ? (
            <label>Branch<select name="branch" defaultValue={value(params.branch)}>
              <option value="">All authorised branches</option>
              {options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select></label>
          ) : null}
          <label>Leave type<select name="policy" defaultValue={value(params.policy)}>
            <option value="">All leave types</option>
            {options.policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}{policy.active ? "" : " (inactive)"}</option>)}
          </select></label>
          <label>Employee<input name="employee" defaultValue={value(params.employee)} placeholder="Name or employee code" /></label>
          {tab === "balances" ? <label>Sort balances<select name="sort" defaultValue={value(params.sort) || "employee"}>
            <option value="employee">Employee name</option>
            <option value="remaining_desc">Remaining: high to low</option>
            <option value="remaining_asc">Remaining: low to high</option>
            <option value="used_desc">Used: high to low</option>
            <option value="pending_desc">Pending: high to low</option>
            <option value="expiry">Next expiry</option>
          </select></label> : null}
          {tab === "carry" ? <label>Expiring within<select name="expiry" defaultValue={value(params.expiry)}>
            <option value="">Any expiry date</option>
            <option value="30">Next 30 days</option>
            <option value="60">Next 60 days</option>
            <option value="90">Next 90 days</option>
          </select></label> : null}
          <label className={styles.checkbox}><input type="checkbox" name="inactive" value="1" defaultChecked={value(params.inactive) === "1"} />Include inactive staff</label>
          <div className={styles.filterActions}><Link href={`?tab=${tab}`}>Clear</Link><button type="submit">Apply filters</button></div>
        </form>
      </details>

      {tab === "overview" ? <Overview report={report as Awaited<ReturnType<typeof getLeaveOverview>>} /> : null}
      {tab === "balances" ? <Balances report={report as Awaited<ReturnType<typeof getLeaveBalanceReport>>} query={query} /> : null}
      {tab === "usage" ? <Usage report={report as Awaited<ReturnType<typeof getLeaveUsageReport>>} /> : null}
      {tab === "carry" ? <Carry report={report as Awaited<ReturnType<typeof getLeaveCarryReport>>} /> : null}
      {tab === "adjustments" ? <Adjustments report={report as Awaited<ReturnType<typeof getLeaveAdjustmentReport>>} /> : null}

      {"pagination" in report ? <Pager pagination={report.pagination} query={query} tab={tab} /> : null}
      {drilldown ? <EmployeeDrilldown data={drilldown} closeHref={`?tab=${tab}&${query}`} /> : null}
    </main>
  );
}

function Overview({ report }: { report: Awaited<ReturnType<typeof getLeaveOverview>> }) {
  const metrics = [
    ["On leave today", report.onLeaveToday, "Approved leave only"],
    ["Pending approvals", report.pendingApprovals, "Waiting for a decision"],
    ["Approved in period", `${report.approvedInPeriod} days`, "Includes half-days"],
    ["Unpaid this month", `${report.unpaidThisMonth} days`, "Approved unpaid leave"],
    ["Expiring in 30 days", `${report.expiringSoonUnits} days`, "Remaining carry-forward"],
    ["Upcoming in 7 days", report.upcomingSevenDays, "Approved requests"],
  ] as const;
  return <>
    <section className={styles.metrics} aria-label="Leave overview">
      {metrics.map(([label, metric, helper]) => <article key={label}><span>{label}</span><strong>{metric}</strong><small>{helper}</small></article>)}
    </section>
    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Next 30 days</p><h2>Upcoming approved leave</h2></div><span>{report.upcoming.length} upcoming</span></div>
      {report.upcoming.length ? <div className={styles.cardList}>{report.upcoming.map((row) => <article key={row.id} className={styles.compactCard}>
        <div><strong>{row.employeeName}</strong><span>{row.employeeCode} · {row.branchName}</span></div>
        <div><strong>{row.policyName}</strong><span>{row.startsOn} – {row.endsOn} · {row.units} days</span></div>
      </article>)}</div> : <Empty message="No approved leave in the next 30 days." />}
    </section>
    <section className={styles.insightGrid}>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Selected period</p><h2>Approved leave trend</h2><p>Monthly approved leave units, including half-days.</p></div></div>
        {report.monthlyTrend.length ? <div className={styles.trendList}>{report.monthlyTrend.map((row) => <div key={row.month}><span>{monthLabel(row.month)}</span><div><i style={{ width: `${Math.max(4, Math.min(100, row.units / Math.max(...report.monthlyTrend.map((item) => item.units)) * 100))}%` }} /></div><strong>{row.units}</strong></div>)}</div> : <Empty message="No approved leave in this period." />}
      </article>
      <article className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Evidence metadata</p><h2>Supporting documents</h2><p>Summary only. No private file names, links or document contents are exposed.</p></div></div>
        <div className={styles.evidenceGrid}>
          <div><span>Required</span><strong>{report.evidenceSummary.required}</strong></div>
          <div><span>Attached</span><strong>{report.evidenceSummary.attached}</strong></div>
          <div><span>Verified</span><strong>{report.evidenceSummary.verified}</strong></div>
          <div><span>Needs follow-up</span><strong>{report.evidenceSummary.needsFollowUp}</strong></div>
          <div><span>Rejected</span><strong>{report.evidenceSummary.rejected}</strong></div>
        </div>
      </article>
    </section>
  </>;
}

function Balances({ report, query }: { report: Awaited<ReturnType<typeof getLeaveBalanceReport>>; query: string }) {
  return <section className={styles.panel}>
    <div className={styles.panelTitle}><div><p className={styles.eyebrow}>Point in time</p><h2>Current balances</h2><p>Pending requests are shown separately and are not deducted from remaining balance.</p></div><span>{report.pagination.total} balances</span></div>
    {report.rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Employee</th><th>Leave type</th><th>Entitlement</th><th>Carry</th><th>Adjustment</th><th>Used</th><th>Pending</th><th>Remaining</th><th>Expiry</th></tr></thead><tbody>
      {report.rows.map((row) => <tr key={`${row.membershipId}:${row.policyId}`}><td><Link href={`?tab=balances&${query}&member=${row.membershipId}`}>{row.employeeName}</Link><small>{row.employeeCode}</small></td><td>{row.policyName}<small>{row.periodStart} – {row.periodEnd}</small></td><td>{row.entitlement}</td><td>{row.carryForward}</td><td>{signed(row.manualAdjustment)}</td><td>{row.used}</td><td>{row.pending}</td><td><strong>{row.remaining}</strong>{row.pending ? <small>Projected {row.projectedRemaining}</small> : null}</td><td>{row.nextExpiry || "—"}</td></tr>)}
    </tbody></table></div> : <Empty message="No current entitlement records match these filters." />}
  </section>;
}

function Usage({ report }: { report: Awaited<ReturnType<typeof getLeaveUsageReport>> }) {
  return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Approved leave</p><h2>Usage</h2><p>Measured in approved leave units, not request count.</p></div><span>{report.pagination.total} result groups</span></div>
    {report.rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Month</th><th>Employee</th><th>Leave type</th><th>Branch</th><th>Pay treatment</th><th>Approved units</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.key}><td>{monthLabel(row.month)}</td><td>{row.employeeName}<small>{row.employeeCode}</small></td><td>{row.policyName}</td><td>{row.branchName}</td><td><span className={row.payTreatment === "UNPAID" ? styles.warningBadge : styles.successBadge}>{row.payTreatment === "PAID" ? "Paid" : "Unpaid"}</span></td><td><strong>{row.approvedUnits}</strong></td></tr>)}</tbody></table></div> : <Empty message="No approved leave usage matches this period." />}
  </section>;
}

function Carry({ report }: { report: Awaited<ReturnType<typeof getLeaveCarryReport>> }) {
  return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Carry-forward evidence</p><h2>Carry forward and expiry</h2><p>Expired status comes from canonical expiry events, never from date guessing.</p></div><span>{report.pagination.total} buckets</span></div>
    {report.rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Employee</th><th>Leave type</th><th>Source period</th><th>Granted</th><th>Used</th><th>Remaining</th><th>Expiry</th><th>Status</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.bucketId}><td>{row.employeeName}<small>{row.employeeCode}</small></td><td>{row.policyName}</td><td>{row.sourcePeriod}</td><td>{row.granted}</td><td>{row.used}</td><td><strong>{row.remaining}</strong></td><td>{row.expiry || "No expiry"}</td><td>{humanize(row.status)}</td></tr>)}</tbody></table></div> : <Empty message="No carry-forward buckets match these filters." />}
  </section>;
}

function Adjustments({ report }: { report: Awaited<ReturnType<typeof getLeaveAdjustmentReport>> }) {
  return <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>Restricted audit view</p><h2>Manual adjustments</h2><p>Manual balance changes remain distinct from entitlement and carry-forward grants.</p></div><span>{report.pagination.total} entries</span></div>
    {report.rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Date</th><th>Employee</th><th>Leave type</th><th>Change</th><th>Authorised by</th><th>Reason</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.id}><td>{formatLocalDate(new Date(row.createdAt))}</td><td>{row.employeeName}<small>{row.employeeCode}</small></td><td>{row.policyName}</td><td><strong>{signed(row.units)}</strong></td><td>{row.actor}</td><td>{row.reason}</td></tr>)}</tbody></table></div> : <Empty message="No manual adjustments match these filters." />}
  </section>;
}

function EmployeeDrilldown({ data, closeHref }: { data: NonNullable<Awaited<ReturnType<typeof getEmployeeLeaveDrilldown>>>; closeHref: string }) {
  return <section className={styles.drawer} aria-label="Employee leave details">
    <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>Employee detail</p><h2>{data.member.fullName}</h2><p>{data.member.employeeCode} · {humanize(data.member.status)}</p></div><Link href={closeHref} aria-label="Close employee detail">×</Link></div>
    <div className={styles.drawerMetrics}><article><span>Pending</span><strong>{data.pending}</strong></article><article><span>Leave types</span><strong>{data.balances.length}</strong></article><article><span>Upcoming</span><strong>{data.upcoming.length}</strong></article></div>
    <h3>Current balances</h3>{data.balances.length ? data.balances.map((row) => <div className={styles.detailRow} key={row.policyId}><span>{row.policyName}</span><strong>{row.remaining} days</strong></div>) : <p>No current balances.</p>}
    <h3>Upcoming approved leave</h3>{data.upcoming.length ? data.upcoming.map((row) => <div className={styles.detailRow} key={row.id}><span>{row.policyNameSnapshot}<small>{row.startsOn} – {row.endsOn}</small></span><strong>{row.requestedDays} days</strong></div>) : <p>No upcoming approved leave.</p>}
    <h3>Recent workflow history</h3>{data.history.length ? data.history.map((row) => <div className={styles.detailRow} key={row.id}><span>{row.policyName}<small>{formatLocalDate(new Date(row.createdAt))}</small></span><strong>{humanize(row.eventType)}</strong></div>) : <p>No workflow history.</p>}
  </section>;
}

function Pager({ pagination, query, tab }: { pagination: { page: number; pages: number; total: number }; query: string; tab: ReportTab }) {
  if (pagination.pages <= 1) return null;
  return <nav className={styles.pager} aria-label="Report pages"><span>Page {pagination.page} of {pagination.pages} · {pagination.total} results</span><div>{pagination.page > 1 ? <Link href={`?tab=${tab}&${query}&page=${pagination.page - 1}`}>Previous</Link> : null}{pagination.page < pagination.pages ? <Link href={`?tab=${tab}&${query}&page=${pagination.page + 1}`}>Next</Link> : null}</div></nav>;
}

function Empty({ message }: { message: string }) { return <div className={styles.empty}><span aria-hidden="true">✓</span><p>{message}</p></div>; }
function value(input: string | string[] | undefined) { return Array.isArray(input) ? input[0] ?? "" : input ?? ""; }
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function signed(value: number) { return value > 0 ? `+${value}` : String(value); }
function humanize(input: string) { return input.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function validDate(input: string) { return /^\d{4}-\d{2}-\d{2}$/.test(input) ? new Date(`${input}T00:00:00.000Z`) : null; }

function parseFilters(params: Awaited<SearchParams>): LeaveReportFilters {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const preset = value(params.preset) || "this_year";
  let from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  let to = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
  if (preset === "this_month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  } else if (preset === "last_month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  } else if (preset === "last_year") {
    from = new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1));
    to = new Date(Date.UTC(today.getUTCFullYear() - 1, 11, 31));
  } else if (preset === "custom") {
    from = validDate(value(params.from)) ?? from;
    to = validDate(value(params.to)) ?? to;
  }
  if (from > to) [from, to] = [to, from];
  const expiry = Number(value(params.expiry));
  const sort = value(params.sort);
  return {
    from,
    to,
    branchId: value(params.branch) || undefined,
    policyId: value(params.policy) || undefined,
    employee: value(params.employee) || undefined,
    includeInactive: value(params.inactive) === "1",
    expiryDays: expiry === 30 || expiry === 60 || expiry === 90 ? expiry : undefined,
    sort: sort === "remaining_desc" || sort === "remaining_asc" || sort === "used_desc" || sort === "pending_desc" || sort === "expiry" ? sort : "employee",
    page: Number(value(params.page)) || 1,
    pageSize: 25,
  };
}

function persistentQuery(params: Awaited<SearchParams>, excluded: string[]) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (excluded.includes(key) || key === "tab" || raw == null) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const item of values) if (item) query.append(key, item);
  }
  return query.toString();
}

function hasFilters(params: Awaited<SearchParams>) {
  return ["preset", "from", "to", "branch", "policy", "employee", "inactive", "expiry", "sort"].some((key) => value(params[key]) !== "");
}

function monthLabel(month: string) {
  const [year, numericMonth] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-MY", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, numericMonth - 1, 1)));
}
