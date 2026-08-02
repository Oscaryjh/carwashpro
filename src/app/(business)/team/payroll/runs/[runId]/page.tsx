import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunDetail, parsePayrollPage } from "@/lib/payroll/runs";
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  formatMoney,
  formatMonth,
  PageHeader,
  PayrollRunsAccessDenied,
  RunStatusBadge,
} from "../_components";
import styles from "../runs.module.css";

export const dynamic = "force-dynamic";

type PayrollRunDetailPageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
};

export default async function PayrollRunDetailPage({ params, searchParams }: PayrollRunDetailPageProps) {
  const access = await resolvePayrollRunsReadAccess();
  if (!access.granted) {
    return <PayrollRunsAccessDenied scopeRestricted={access.scopeRestricted} />;
  }

  const [{ runId }, queryParams] = await Promise.all([params, searchParams]);
  const data = await loadPayrollRunDetail(
    access.businessId,
    runId,
    queryParams.q,
    parsePayrollPage(queryParams.page),
  );
  if (!data) notFound();

  const legacyMonth = data.run.periodStart.toISOString().slice(0, 7);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title={`${formatMonth(data.run.periodStart)} Payroll Run`}
        description="Read-only calculation snapshot. Payslip, payment and statutory statuses remain separate."
      >
        <Link href="/team/payroll/runs">All payroll runs</Link>
        <Link href={`/team/payroll?month=${legacyMonth}`}>Open legacy monthly payroll</Link>
      </PageHeader>

      <section className={styles.detailHero} aria-labelledby="run-summary-heading">
        <div className={styles.detailHeading}>
          <p className={styles.eyebrow}>Calculation status</p>
          <div>
            <h2 id="run-summary-heading">{formatMonth(data.run.periodStart)}</h2>
            <RunStatusBadge status={data.run.status} />
          </div>
          <p>{statusDescription(data.run.status)}</p>
        </div>
        <dl className={styles.heroMetrics}>
          <div><dt>Employees</dt><dd>{data.run.employeeCount}</dd></div>
          <div><dt>Gross payroll</dt><dd>{formatMoney(data.run.grossPayroll)}</dd></div>
          <div><dt>Net payroll</dt><dd>{formatMoney(data.run.netPayroll)}</dd></div>
        </dl>
      </section>

      <section className={styles.snapshotPanel} aria-labelledby="calculation-snapshot-heading">
        <div className={styles.sectionHeading}>
          <h2 id="calculation-snapshot-heading">Calculation snapshot</h2>
          <p>These values were captured when this run was calculated.</p>
        </div>
        <dl className={styles.snapshotGrid}>
          <div><dt>Working days / month</dt><dd>{data.run.workingDaysPerMonth}</dd></div>
          <div><dt>Paid work target / day</dt><dd>{formatMinutes(data.run.normalWorkMinutesPerDay)}</dd></div>
          <div><dt>Expected break / day</dt><dd>{formatMinutes(data.run.breakMinutesPerDay)}</dd></div>
          <div><dt>Created</dt><dd>{formatDateTime(data.run.createdAt)}</dd></div>
          <div><dt>Submitted</dt><dd>{data.run.submittedAt ? formatDateTime(data.run.submittedAt) : "Not submitted"}</dd></div>
          <div><dt>Locked</dt><dd>{data.run.finalizedAt ? formatDateTime(data.run.finalizedAt) : "Not locked"}</dd></div>
        </dl>
      </section>

      <section className={styles.entriesPanel} aria-labelledby="employee-entries-heading">
        <div className={styles.entriesHeader}>
          <div className={styles.sectionHeading}>
            <h2 id="employee-entries-heading">Employee entries</h2>
            <p>{data.query ? `${data.totalEntries} matching entries` : `${data.totalEntries} entries in this run`}</p>
          </div>
          <form className={styles.searchForm} action={`/team/payroll/runs/${data.run.id}`}>
            <label htmlFor="entry-search">Search employee</label>
            <div>
              <input id="entry-search" name="q" defaultValue={data.query} maxLength={80} placeholder="Name or employee code" />
              <button type="submit">Search</button>
            </div>
          </form>
        </div>

        {data.entries.length ? (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.runTable} ${styles.entryTable}`}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Pay basis</th>
                    <th>Days</th>
                    <th>Regular</th>
                    <th>Additional time</th>
                    <th>Holiday</th>
                    <th>Gross</th>
                    <th>Net pay</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Employee">
                        <Link className={styles.employeeLink} href={`/team/people/${entry.membershipId}`}>{entry.fullName}</Link>
                        <small>{entry.employeeCode}</small>
                      </td>
                      <td data-label="Pay basis">{formatPayBasis(entry.payBasis)}</td>
                      <td data-label="Days">{entry.attendanceDays}</td>
                      <td data-label="Regular">{formatMinutes(entry.regularMinutes)}</td>
                      <td data-label="Additional time">{formatMinutes(entry.overtimeMinutes)}</td>
                      <td data-label="Holiday">{formatMinutes(entry.publicHolidayMinutes)}</td>
                      <td data-label="Gross">{formatMoney(entry.grossPay)}</td>
                      <td data-label="Net pay"><strong>{formatMoney(entry.netPay)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <EntryPagination runId={data.run.id} query={data.query} page={data.page} totalPages={data.totalPages} />
          </>
        ) : (
          <div className={styles.inlineEmpty}>
            <h3>{data.query ? "No matching employees" : "No employee entries"}</h3>
            <p>{data.query ? "Try a different name or employee code." : "This calculation run does not contain employee entries."}</p>
            {data.query ? <Link href={`/team/payroll/runs/${data.run.id}`}>Clear search</Link> : null}
          </div>
        )}
      </section>

      <footer className={styles.readOnlyNote}>
        <strong>Read-only foundation</strong>
        <span>Workflow changes and employee entry editing remain on the legacy monthly payroll page during W2A.</span>
        <small>Last updated {formatDate(data.run.updatedAt)}</small>
      </footer>
    </main>
  );
}

function EntryPagination({ runId, query, page, totalPages }: { runId: string; query: string; page: number; totalPages: number }) {
  if (totalPages <= 1) return null;
  const href = (target: number) => `/team/payroll/runs/${runId}?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(target) })}`;
  return (
    <nav className={styles.pagination} aria-label="Employee entry pages">
      {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span>Previous</span>}
      <strong>Page {page} of {totalPages}</strong>
      {page < totalPages ? <Link href={href(page + 1)}>Next</Link> : <span>Next</span>}
    </nav>
  );
}

function statusDescription(status: "DRAFT" | "REVIEW" | "FINALIZED") {
  if (status === "DRAFT") return "Calculations are still being prepared. No workflow action is available on this page.";
  if (status === "REVIEW") return "Calculations are awaiting review. This does not mean employees have been paid.";
  return "Calculations are locked. Payment completion is not tracked by this status.";
}

function formatPayBasis(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
