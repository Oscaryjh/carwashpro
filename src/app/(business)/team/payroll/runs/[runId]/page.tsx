import Link from "next/link";
import { notFound } from "next/navigation";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunDetail, parsePayrollPage, payrollRunBrowsePath } from "@/lib/payroll/runs";
import {
  finalizePayrollRunAction,
  generatePayrollRunAction,
  reopenPayrollRunAction,
  returnPayrollRunToDraftAction,
  submitPayrollRunForReviewAction,
} from "../../actions";
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
  searchParams: Promise<{
    message?: string;
    page?: string;
    q?: string;
    type?: string;
  }>;
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
  const returnPath = `/team/payroll/runs/${data.run.id}`;
  const entryReturnPath = payrollRunBrowsePath(
    data.run.id,
    data.query,
    data.page,
  );
  const notice = sanitizePayrollNotice(queryParams.message, queryParams.type);
  const isSelfSubmitted = data.run.submittedById === access.userId;
  const canFinalize =
    access.workflow.canFinalize &&
    (!isSelfSubmitted || access.ownerSelfApproval);
  const canReopen =
    access.workflow.canReopen && !data.run.hasStatutorySubmissions;
  const hasAvailableAction =
    (data.run.status === "DRAFT" &&
      (access.workflow.canSubmitReview || access.actions.canCreate)) ||
    (data.run.status === "REVIEW" &&
      (access.workflow.canReturnToDraft || canFinalize)) ||
    (data.run.status === "FINALIZED" && canReopen);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title={`${formatMonth(data.run.periodStart)} Payroll Run`}
        description="Read-only calculation snapshot. Payslip, payment and statutory statuses remain separate."
      >
        <Link href="/team/payroll/runs">All payroll runs</Link>
        <Link href={`/team/payroll?month=${legacyMonth}`}>Open legacy monthly payroll</Link>
      </PageHeader>

      {notice ? (
        <div
          className={`${styles.notice} ${queryParams.type === "error" ? styles.noticeError : styles.noticeSuccess}`}
          role={queryParams.type === "error" ? "alert" : "status"}
        >
          {notice}
        </div>
      ) : null}

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

      <section className={styles.workflowPanel} aria-labelledby="workflow-heading">
        <div className={styles.workflowIntro}>
          <p className={styles.eyebrow}>Payroll workflow</p>
          <h2 id="workflow-heading">{workflowTitle(data.run.status)}</h2>
          <p>{workflowDescription(data.run.status)}</p>
        </div>

        <div className={styles.workflowControls}>
          {data.run.status === "DRAFT" && access.workflow.canSubmitReview ? (
            <details className={styles.actionDisclosure}>
              <summary className={styles.primaryAction}>Submit for review</summary>
              <div className={styles.actionConfirmation}>
                <strong>Ready for an independent review?</strong>
                <p>Submitting freezes draft editing until the run is returned for correction.</p>
                <form action={submitPayrollRunForReviewAction}>
                  <WorkflowFields month={legacyMonth} runId={data.run.id} returnPath={returnPath} />
                  <button className={styles.primaryButton} type="submit">Confirm submission</button>
                </form>
              </div>
            </details>
          ) : null}

          {data.run.status === "DRAFT" && access.actions.canCreate ? (
            <details className={`${styles.actionDisclosure} ${styles.highRiskDisclosure}`}>
              <summary className={styles.dangerAction}>Refresh draft</summary>
              <div className={styles.actionConfirmation}>
                <strong>This deletes and rebuilds every employee entry in this draft.</strong>
                <p>
                  The latest approved Attendance, Leave, Payroll Settings and Statutory Profile will be used.
                  Manual allowances, deductions, EPF/SOCSO/EIS and employer overrides, PCB, LINDUNG 24 and payroll notes will be cleared.
                </p>
                <form action={generatePayrollRunAction}>
                  <input name="month" type="hidden" value={legacyMonth} />
                  <input name="runId" type="hidden" value={data.run.id} />
                  <input name="returnPath" type="hidden" value={returnPath} />
                  <input name="generationMode" type="hidden" value="REFRESH" />
                  <button className={styles.dangerButton} type="submit">Confirm refresh and clear manual adjustments</button>
                </form>
              </div>
            </details>
          ) : null}

          {data.run.status === "REVIEW" && access.workflow.canReturnToDraft ? (
            <details className={styles.actionDisclosure}>
              <summary className={styles.secondaryAction}>Return to draft</summary>
              <form action={returnPayrollRunToDraftAction} className={styles.actionConfirmation}>
                <WorkflowFields month={legacyMonth} runId={data.run.id} returnPath={returnPath} />
                <label>
                  <span>Correction reason</span>
                  <textarea name="reason" minLength={5} maxLength={500} required placeholder="Explain what must be corrected" />
                </label>
                <button className={styles.secondaryButton} type="submit">Confirm return</button>
              </form>
            </details>
          ) : null}

          {data.run.status === "REVIEW" && canFinalize ? (
            <details className={`${styles.actionDisclosure} ${styles.highRiskDisclosure}`}>
              <summary className={styles.dangerAction}>Finalize calculations</summary>
              <form action={finalizePayrollRunAction} className={styles.actionConfirmation}>
                <WorkflowFields month={legacyMonth} runId={data.run.id} returnPath={returnPath} />
                <strong>This locks the payroll calculations.</strong>
                <p>Finalized does not mean paid. Payments and statutory submissions remain separate.</p>
                {isSelfSubmitted ? (
                  <label>
                    <span>Owner override reason</span>
                    <textarea name="reason" minLength={5} maxLength={500} required placeholder="Explain why self-approval is necessary" />
                  </label>
                ) : null}
                <button className={styles.dangerButton} type="submit">Confirm finalization</button>
              </form>
            </details>
          ) : null}

          {data.run.status === "FINALIZED" && canReopen ? (
            <details className={`${styles.actionDisclosure} ${styles.highRiskDisclosure}`}>
              <summary className={styles.dangerAction}>Reopen for correction</summary>
              <form action={reopenPayrollRunAction} className={styles.actionConfirmation}>
                <WorkflowFields month={legacyMonth} runId={data.run.id} returnPath={returnPath} />
                <strong>This returns the locked run to Draft.</strong>
                <p>Use this only when finalized calculations require a documented correction.</p>
                <label>
                  <span>Audit reason</span>
                  <textarea name="reason" minLength={5} maxLength={500} required placeholder="Explain why this run must be reopened" />
                </label>
                <button className={styles.dangerButton} type="submit">Confirm reopen</button>
              </form>
            </details>
          ) : null}

          {data.run.status === "FINALIZED" && data.run.hasStatutorySubmissions ? (
            <div className={styles.noWorkflowAction}>
              <strong>Reopen unavailable</strong>
              <span>A statutory export or correction record exists. Use the controlled statutory revision workflow instead.</span>
            </div>
          ) : null}

          {!hasAvailableAction && !(data.run.status === "FINALIZED" && data.run.hasStatutorySubmissions) ? (
            <div className={styles.noWorkflowAction}>
              <strong>No action available</strong>
              <span>Your access or this run&apos;s current state does not allow a workflow change.</span>
            </div>
          ) : null}
        </div>
      </section>

      {access.actions.canExportPayroll ? (
        <section className={styles.snapshotPanel} aria-labelledby="payroll-documents-heading">
          <div className={styles.entriesHeader}>
            <div className={styles.sectionHeading}>
              <h2 id="payroll-documents-heading">Payroll export</h2>
              <p>
                Download the current {data.run.status === "FINALIZED" ? "locked" : data.run.status.toLowerCase()} calculation snapshot. This does not mark payroll as paid.
              </p>
            </div>
            <div className={styles.documentActions}>
              <Link href={`/team/payroll/export?month=${legacyMonth}&kind=payroll&format=csv`}>Payroll CSV</Link>
              <Link href={`/team/payroll/export?month=${legacyMonth}&kind=payroll&format=xlsx`}>Payroll Excel</Link>
            </div>
          </div>
        </section>
      ) : null}

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
                    {(access.actions.canEditEntry && data.run.status === "DRAFT") ||
                    (access.actions.canViewPayslip && data.run.status === "FINALIZED") ? (
                      <th><span className={styles.visuallyHidden}>Entry actions</span></th>
                    ) : null}
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
                      {(access.actions.canEditEntry && data.run.status === "DRAFT") ||
                      (access.actions.canViewPayslip && data.run.status === "FINALIZED") ? (
                        <td data-label="Actions">
                          <div className={styles.entryActions}>
                            {access.actions.canEditEntry && data.run.status === "DRAFT" ? (
                              <Link
                                className={styles.entryAction}
                                href={entryEditorPath(data.run.id, entry.id, entryReturnPath)}
                              >
                                Edit entry
                              </Link>
                            ) : null}
                            {access.actions.canViewPayslip && data.run.status === "FINALIZED" ? (
                              <Link
                                className={styles.entryAction}
                                href={`/team/payroll/payslips/${entry.id}`}
                                target="_blank"
                              >
                                Payslip PDF
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
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
        <strong>Payroll Run workspace</strong>
        <span>Calculation workflow, draft entry adjustments, payroll exports and finalized payslips are managed here.</span>
        <small>Last updated {formatDate(data.run.updatedAt)}</small>
      </footer>
    </main>
  );
}

function entryEditorPath(runId: string, entryId: string, returnPath: string) {
  return `/team/payroll/runs/${runId}/entries/${entryId}?returnPath=${encodeURIComponent(returnPath)}`;
}

function WorkflowFields({ month, runId, returnPath }: { month: string; runId: string; returnPath: string }) {
  return (
    <>
      <input name="month" type="hidden" value={month} />
      <input name="runId" type="hidden" value={runId} />
      <input name="returnPath" type="hidden" value={returnPath} />
    </>
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
  if (status === "DRAFT") return "Calculations are still being prepared and can be submitted for review when ready.";
  if (status === "REVIEW") return "Calculations are awaiting review. This does not mean employees have been paid.";
  return "Calculations are locked. Payment completion is not tracked by this status.";
}

function workflowTitle(status: "DRAFT" | "REVIEW" | "FINALIZED") {
  if (status === "DRAFT") return "Prepare for review";
  if (status === "REVIEW") return "Review calculations";
  return "Calculations locked";
}

function workflowDescription(status: "DRAFT" | "REVIEW" | "FINALIZED") {
  if (status === "DRAFT") return "Submit this draft only after the employee entries have been checked.";
  if (status === "REVIEW") return "Return issues for correction or finalize the calculation after approval.";
  return "Reopening is a controlled correction action and requires an audit reason.";
}

function formatPayBasis(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
