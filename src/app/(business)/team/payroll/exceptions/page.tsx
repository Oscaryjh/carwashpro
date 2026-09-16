import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getPayrollExceptionOverview } from "@/lib/payroll/exception-center-read";
import {
  filterPayrollExceptionRows,
  PAYROLL_EXCEPTION_AREA_LABELS,
  PAYROLL_EXCEPTION_IMPACT_LABELS,
  summarizePayrollExceptionRows,
  type PayrollExceptionArea,
  type PayrollExceptionImpact,
} from "@/lib/payroll/exception-center-types";
import { parsePayrollMonth } from "@/lib/payroll/period";
import { hasWholeBusinessPeopleScope } from "@/lib/team/people-scope";
import styles from "./payroll-exceptions.module.css";

export const dynamic = "force-dynamic";

type Query = {
  area?: string;
  branch?: string;
  impact?: string;
  month?: string;
  page?: string;
  search?: string;
  showReady?: string;
};

const PAGE_SIZE = 50;

export default async function PayrollExceptionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const context = await requireBusinessUser();
  const [query, scope] = await Promise.all([searchParams, resolveAttendanceScope(context.access)]);
  const month = normalizeMonth(query.month);
  const result = await getPayrollExceptionOverview({
    access: context.access,
    allowedBranchIds: scope.allowedBranchIds,
    businessId: context.businessId,
    month,
    wholeBusinessScope: hasWholeBusinessPeopleScope(context.access),
  });
  if (result.status !== "READY") notFound();

  const selectedArea = parseArea(query.area);
  const selectedImpact = parseImpact(query.impact);
  const showReady = query.showReady === "1";
  const filtered = filterPayrollExceptionRows(result.data.rows, {
    area: selectedArea,
    branch: query.branch,
    impact: selectedImpact,
    search: query.search,
    showReady,
  });
  const summary = summarizePayrollExceptionRows(filterPayrollExceptionRows(result.data.rows, {
    branch: query.branch,
    search: query.search,
    showReady: true,
  }));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(parsePage(query.page), pageCount);
  const visibleRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const currentPath = buildPath({ ...query, month, page: undefined });
  const monthLabel = formatMonth(month);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PAYROLL · MONTH-END CHECK</p>
          <h1>Payroll issues</h1>
          <p>See who needs attention, why payroll is blocked, and where the authorized correction must happen.</p>
        </div>
        <form className={styles.monthForm} method="get">
          <label htmlFor="payroll-exception-month">Payroll month</label>
          <div><input defaultValue={month} id="payroll-exception-month" max="2100-12" min="2020-01" name="month" type="month" /><button type="submit">View month</button></div>
        </form>
      </header>

      <section className={styles.readiness} data-ready={summary.blocking === 0}>
        <div>
          <strong>{summary.blocking ? "Payroll is not ready" : "No visible blockers found"}</strong>
          <span>{summary.blocking
            ? `${summary.blocking} ${summary.blocking === 1 ? "employee has" : "employees have"} an issue that blocks payroll.`
            : "This result covers only the issue areas available in this canonical view."}</span>
        </div>
        {result.data.canViewPayroll ? <Link href={`/team/payroll/runs?month=${month}`}>View payroll month</Link> : null}
      </section>

      <aside className={styles.restricted} role="note">
        <strong>Restricted checks remain separate</strong>
        <span>Tax and statutory setup are intentionally excluded from this view until their official approval evidence is available. This page cannot claim full payroll readiness.</span>
      </aside>

      <section aria-label="Payroll issues summary" className={styles.summary}>
        <SummaryLink current={query} impact="BLOCKING_PAYROLL" label="Blocking payroll" value={summary.blocking} />
        <SummaryLink current={query} impact="NEEDS_REVIEW" label="Needs review" value={summary.needsReview} />
        <SummaryLink current={query} impact="SETUP_REQUIRED" label="Setup required" value={summary.setupRequired} />
        <SummaryLink current={query} impact="READY" label="Ready employees" value={summary.ready} showReady />
        <SummaryLink current={query} impact="" label="Total employees" value={summary.total} showReady={showReady} />
      </section>

      <form className={styles.filters} method="get">
        <input name="month" type="hidden" value={month} />
        <label>Search employee<input defaultValue={query.search ?? ""} name="search" placeholder="Name or employee ID" type="search" /></label>
        <label>Branch<select defaultValue={query.branch ?? ""} name="branch"><option value="">All accessible branches</option>{result.data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>Payroll impact<select defaultValue={selectedImpact ? impactQueryValue(selectedImpact) : ""} name="impact"><option value="">All impacts</option>{impactOptions().map((impact) => <option key={impact} value={impactQueryValue(impact)}>{PAYROLL_EXCEPTION_IMPACT_LABELS[impact]}</option>)}</select></label>
        <label>Area<select defaultValue={selectedArea ? areaQueryValue(selectedArea) : ""} name="area"><option value="">All available areas</option>{result.data.areas.map((area) => <option key={area} value={areaQueryValue(area)}>{PAYROLL_EXCEPTION_AREA_LABELS[area]}</option>)}</select></label>
        <label className={styles.readyToggle}><input defaultChecked={showReady} name="showReady" type="checkbox" value="1" /> Show ready employees</label>
        <div className={styles.filterActions}><button type="submit">Apply filters</button><Link href={`/team/payroll/exceptions?month=${month}`}>Clear</Link></div>
      </form>

      <div className={styles.listHeading}>
        <div><h2>Employees needing attention</h2><p>{filtered.length} {filtered.length === 1 ? "employee" : "employees"} in this view</p></div>
        <span>Current records · read-only</span>
      </div>

      {result.data.rowLimitReached ? <p className={styles.notice}>Showing the first 1,000 employees. Narrow the branch or employee search for a smaller result.</p> : null}
      {!result.data.hasAccessibleBranches ? (
        <Empty title="No accessible branches" detail="Your current access does not include an active branch. Ask your business administrator to review your branch access." />
      ) : !result.data.rows.length ? (
        <Empty title="No payroll-relevant employees" detail={`No employees in your accessible branches overlap ${monthLabel}.`} />
      ) : !visibleRows.length ? (
        <Empty title={showReady ? "No employees match these filters" : `No payroll issues found for ${monthLabel}`} detail={showReady ? "Clear one or more filters to see employees in your scope." : "Turn on Show ready employees to view employees without visible issues."} />
      ) : (
        <div className={styles.tableFrame}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>Payroll issues for {monthLabel}</caption>
            <thead><tr><th>Employee</th><th>Branch</th><th>Impact</th><th>Main issue</th><th>Area</th><th><span className={styles.srOnly}>Action</span></th></tr></thead>
            <tbody>{visibleRows.map((row) => (
              <tr key={row.membershipId}>
                <td data-label="Employee"><strong>{row.name}</strong><small>{row.employeeCode}</small></td>
                <td data-label="Branch">{row.branches.map((branch) => branch.name).join(", ") || "No current branch"}</td>
                <td data-label="Impact"><span className={styles.badge} data-impact={impactQueryValue(row.status)}>{PAYROLL_EXCEPTION_IMPACT_LABELS[row.status]}</span></td>
                <td data-label="Main issue">{row.mainIssue ? <><strong>{row.mainIssue.title}</strong><small>{row.mainIssue.detail}</small>{row.issues.length > 1 ? <small className={styles.more}>+{row.issues.length - 1} more</small> : null}</> : <span className={styles.readyText}>No visible action needed</span>}</td>
                <td data-label="Area">{row.mainIssue ? PAYROLL_EXCEPTION_AREA_LABELS[row.mainIssue.area] : "—"}</td>
                <td data-label="Action">{row.mainIssue?.action && row.mainIssue.action.label !== "View issue" ? <Link className={styles.primaryAction} href={withReturn(row.mainIssue.action.href, currentPath)}>{row.mainIssue.action.label}<span aria-hidden="true"> →</span></Link> : <Link className={styles.secondaryAction} href={withReturn(`/team/payroll/exceptions/${row.membershipId}?month=${month}`, currentPath)}>View employee</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? <nav aria-label="Payroll issue pages" className={styles.pagination}>{page > 1 ? <Link href={pagePath(currentPath, page - 1)}>Previous</Link> : <span>Previous</span>}<strong>Page {page} of {pageCount}</strong>{page < pageCount ? <Link href={pagePath(currentPath, page + 1)}>Next</Link> : <span>Next</span>}</nav> : null}
      <footer className={styles.footer}>This page is read-only. Corrections stay in their existing attendance, leave, and payroll approval workflows.</footer>
    </main>
  );
}

function SummaryLink({ current, impact, label, showReady, value }: { current: Query; impact: PayrollExceptionImpact | ""; label: string; showReady?: boolean; value: number }) {
  return <Link aria-current={parseImpact(current.impact) === impact ? "true" : undefined} href={buildPath({ ...current, impact: impact ? impactQueryValue(impact) : undefined, page: undefined, showReady: showReady ? "1" : current.showReady })}><span>{label}</span><strong>{value}</strong></Link>;
}

function Empty({ detail, title }: { detail: string; title: string }) {
  return <section className={styles.empty}><h2>{title}</h2><p>{detail}</p></section>;
}

function normalizeMonth(value?: string) {
  try { return parsePayrollMonth(value).value; } catch { return new Date().toISOString().slice(0, 7); }
}

function buildPath(query: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  return `/team/payroll/exceptions${params.size ? `?${params}` : ""}`;
}

function withReturn(href: string, returnTo: string) {
  const url = new URL(href, "https://internal.invalid");
  if (url.pathname.startsWith("/team/people/")) url.searchParams.set("peopleReturn", returnTo);
  else if (url.pathname === "/team/leave") url.searchParams.set("payrollReturn", returnTo);
  else if (url.pathname.startsWith("/team/payroll/exceptions/")) url.searchParams.set("returnTo", returnTo);
  return `${url.pathname}${url.search}`;
}

function pagePath(path: string, page: number) {
  const url = new URL(path, "https://internal.invalid");
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}`;
}

function parsePage(value?: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseArea(value?: string): PayrollExceptionArea | "" {
  return areaOptions().find((area) => areaQueryValue(area) === value) ?? "";
}

function parseImpact(value?: string): PayrollExceptionImpact | "" {
  return impactOptions().find((impact) => impactQueryValue(impact) === value) ?? "";
}

function impactOptions(): PayrollExceptionImpact[] { return ["BLOCKING_PAYROLL", "NEEDS_REVIEW", "SETUP_REQUIRED", "READY"]; }
function areaOptions(): PayrollExceptionArea[] { return ["EMPLOYMENT", "ATTENDANCE", "LEAVE", "OVERTIME", "TIMESHEET", "PAY_SETUP"]; }
function impactQueryValue(impact: PayrollExceptionImpact) { return ({ BLOCKING_PAYROLL: "blocking", NEEDS_REVIEW: "review", SETUP_REQUIRED: "setup", READY: "ready" } as const)[impact]; }
function areaQueryValue(area: PayrollExceptionArea) { return ({ EMPLOYMENT: "employment", ATTENDANCE: "attendance", LEAVE: "leave", OVERTIME: "overtime", TIMESHEET: "timesheet", PAY_SETUP: "pay-setup", TAX: "tax", STATUTORY: "statutory" } as const)[area]; }
function formatMonth(month: string) { return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`)); }
