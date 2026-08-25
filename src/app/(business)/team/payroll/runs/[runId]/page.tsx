import Link from "next/link";
import { notFound } from "next/navigation";
import { sanitizePayrollNotice } from "@/lib/payroll/error-message";
import { PayrollHighRiskMfaFields } from "@/components/payroll-high-risk-mfa-fields";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunDetail, parsePayrollPage, payrollRunBrowsePath } from "@/lib/payroll/runs";
import { getPayrollPeriodReadiness } from "@/lib/payroll/readiness";
import type { PayrollReadinessIssue, PayrollReadinessStatus } from "@/lib/payroll/readiness";
import {
  finalizePayrollRunAction,
  generatePayrollRunAction,
  reopenPayrollRunAction,
  publishPayrollPayslipsAction,
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
    readiness?: string;
    type?: string;
  }>;
};

export default async function PayrollRunDetailPage({ params, searchParams }: PayrollRunDetailPageProps) {
  const access = await resolvePayrollRunsReadAccess();
  if (!access.granted) {
    return <PayrollRunsAccessDenied scopeRestricted={access.scopeRestricted} />;
  }

  const [{ runId }, queryParams] = await Promise.all([params, searchParams]);
  const initialData = await loadPayrollRunDetail(
    access.businessId,
    runId,
    queryParams.q,
    parsePayrollPage(queryParams.page),
  );
  if (!initialData) notFound();
  const readiness = await getPayrollPeriodReadiness({
    businessId: access.businessId,
    month: initialData.run.periodStart.toISOString().slice(0, 7),
    runId: initialData.run.id,
  });
  const readinessFilter = parseReadinessFilter(queryParams.readiness);
  const filteredMembershipIds = readinessFilter === "ALL"
    ? undefined
    : readiness.employees
        .filter((employee) => employee.status === readinessFilter)
        .map((employee) => employee.membershipId);
  const data = filteredMembershipIds
    ? await loadPayrollRunDetail(
        access.businessId,
        runId,
        queryParams.q,
        parsePayrollPage(queryParams.page),
        undefined,
        filteredMembershipIds,
      )
    : initialData;
  if (!data) notFound();
  const readinessByMembership = new Map(
    readiness.employees.map((employee) => [employee.membershipId, employee]),
  );
  const blockerGroups = groupReadinessIssues(readiness.blockers);

  const legacyMonth = data.run.periodStart.toISOString().slice(0, 7);
  const returnPath = `/team/payroll/runs/${data.run.id}`;
  const entryReturnPath = readinessFilter === "ALL"
    ? payrollRunBrowsePath(data.run.id, data.query, data.page)
    : readinessFilterPath(data.run.id, readinessFilter, data.query, data.page);
  const notice = sanitizePayrollNotice(queryParams.message, queryParams.type);
  const isSelfSubmitted = data.run.submittedById === access.userId;
  const attendanceRefreshRequired =
    data.run.attendanceProvenanceState === "REFRESH_REQUIRED";
  const canFinalize =
    access.workflow.canFinalize &&
    readiness.canProceed &&
    !attendanceRefreshRequired &&
    (!isSelfSubmitted || access.ownerSelfApproval);
  const canReopen =
    access.workflow.canReopen &&
    !data.run.hasStatutorySubmissions &&
    data.run.publishedPayslipCount === 0;
  const hasAvailableAction =
    (data.run.status === "DRAFT" &&
      ((!attendanceRefreshRequired && readiness.canProceed && access.workflow.canSubmitReview) ||
        access.actions.canCreate)) ||
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
        <Link href={`/team/payroll/settings?month=${legacyMonth}`}>Payroll settings</Link>
      </PageHeader>

      {notice ? (
        <div
          className={`${styles.notice} ${queryParams.type === "error" ? styles.noticeError : styles.noticeSuccess}`}
          role={queryParams.type === "error" ? "alert" : "status"}
        >
          {notice}
        </div>
      ) : null}

      {attendanceRefreshRequired ? (
        <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
          This Payroll Run is not linked to the current locked Attendance Timesheet revision.
          Refresh the Draft before submission. A Run in Review must first be returned to Draft.
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
          <div><dt>Total deductions</dt><dd>{formatMoney(data.run.totalDeductions)}</dd></div>
          <div><dt>Net payroll</dt><dd>{formatMoney(data.run.netPayroll)}</dd></div>
        </dl>
      </section>

      <section className={styles.snapshotPanel} aria-labelledby="run-readiness-heading">
        <div className={styles.entriesHeader}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>Payroll readiness</p>
            <h2 id="run-readiness-heading">{readinessHeading(readiness.status)}</h2>
            <p>See what HR can fix now and what still needs setup before payroll can continue.</p>
          </div>
        </div>
        <dl className={`${styles.heroMetrics} ${styles.readinessMetrics}`}>
          <div><dt>Ready</dt><dd>{readiness.readyCount}</dd></div>
          <div><dt>Review required</dt><dd>{readiness.reviewRequiredCount}</dd></div>
          <div><dt>Blocked</dt><dd>{readiness.blockedCount}</dd></div>
          <div><dt>Run status</dt><dd>{readiness.status.replace("_", " ")}</dd></div>
        </dl>
        {blockerGroups.length ? (
          <div className={styles.issueGroupList}>
            {blockerGroups.slice(0, 6).map((group) => (
              <details className={styles.issueGroup} key={group.key}>
                <summary className={styles.issueGroupHeader}>
                  <div className={styles.issueGroupIdentity}>
                    <span aria-hidden="true">!</span>
                    <div>
                      <strong>
                        Payroll setup incomplete — {group.issues.length} item{group.issues.length === 1 ? "" : "s"}
                      </strong>
                      <small>{group.employeeName}</small>
                    </div>
                  </div>
                  <span className={styles.issueCount} aria-hidden="true">
                    <span className={styles.issueCountClosed}>View fixes</span>
                    <span className={styles.issueCountOpen}>Hide fixes</span>
                    <span className={styles.issueChevron}>⌄</span>
                  </span>
                </summary>
                <ul className={styles.issueItems}>
                  {group.issues.map((issue, index) => {
                    const display = readinessIssueDisplay(issue);
                    const fix = readinessIssueFix(issue, legacyMonth, data.run.status);
                    return (
                      <li className={styles.issueItem} key={`${issue.code}-${index}`}>
                        <span className={styles.issueItemIcon} aria-hidden="true">{index + 1}</span>
                        <div className={styles.issueItemCopy}>
                          <strong>{display.title}</strong>
                          <span>{display.description}</span>
                        </div>
                        <Link
                          className={styles.issueItemFix}
                          href={fix.href}
                          aria-label={`Fix ${display.title}`}
                        >
                          Fix
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </div>
        ) : null}
        {readiness.warnings.length ? (
          <details className={styles.actionDisclosure}>
            <summary className={styles.secondaryAction}>View {readiness.warnings.length} non-blocking warnings</summary>
            <ul className={styles.issueSummary}>
              {readiness.warnings.slice(0, 12).map((issue, index) => (
                <li key={`${issue.code}-${issue.membershipId ?? "run"}-${index}`}>
                  <strong>Review · {issue.employeeName ?? "Payroll run"} · {issue.source}</strong>
                  <span>{issue.message}</span>
                  <small>{issue.resolutionHint}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className={styles.workflowPanel} aria-labelledby="workflow-heading">
        <div className={styles.workflowIntro}>
          <p className={styles.eyebrow}>Payroll workflow</p>
          <h2 id="workflow-heading">{workflowTitle(data.run.status)}</h2>
          <p>{workflowDescription(data.run.status)}</p>
        </div>

        <div className={styles.workflowControls}>
          {data.run.status === "DRAFT" &&
          !attendanceRefreshRequired &&
          readiness.canProceed &&
          access.workflow.canSubmitReview ? (
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
            <details className={`${styles.actionDisclosure} ${styles.highRiskDisclosure}`} id="refresh-draft">
              <summary className={styles.dangerAction}>Refresh draft</summary>
              <div className={styles.actionConfirmation}>
                <strong>This regenerates system component lines from frozen approved sources.</strong>
                <p>
                  The current locked Attendance Timesheet revision, frozen compensation, approved Payroll inputs and Statutory Profile will be used. Payroll does not reread current Leave or raw punches.
                  Audited manual earning and deduction lines and payroll notes are preserved. Existing statutory overrides are recalculated from the current profile.
                </p>
                <form action={generatePayrollRunAction}>
                  <input name="month" type="hidden" value={legacyMonth} />
                  <input name="runId" type="hidden" value={data.run.id} />
                  <input name="returnPath" type="hidden" value={returnPath} />
                  <input name="generationMode" type="hidden" value="REFRESH" />
                  <button className={styles.dangerButton} type="submit">Confirm refresh and preserve manual adjustments</button>
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
                <PayrollHighRiskMfaFields actionLabel="Finalize this Payroll Run" />
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
                <PayrollHighRiskMfaFields actionLabel="Reopen this Payroll Run" />
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

          {data.run.status === "FINALIZED" && data.run.publishedPayslipCount > 0 ? (
            <div className={styles.noWorkflowAction}>
              <strong>Reopen unavailable</strong>
              <span>Published payslips are immutable historical documents.</span>
            </div>
          ) : null}

          {!hasAvailableAction && !(data.run.status === "FINALIZED" && (data.run.hasStatutorySubmissions || data.run.publishedPayslipCount > 0)) ? (
            <div className={styles.noWorkflowAction}>
              <strong>No action available</strong>
              <span>Your access or this run&apos;s current state does not allow a workflow change.</span>
            </div>
          ) : null}
        </div>
      </section>

      {data.run.status === "FINALIZED" && access.actions.canViewPaymentBatch ? (
        <section className={styles.snapshotPanel} aria-labelledby="payment-readiness-heading">
          <div className={styles.entriesHeader}>
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Payroll payment</p>
              <h2 id="payment-readiness-heading">Payment readiness</h2>
              <p>
                Check verified employee bank versions and net-pay blockers. Finalized does not mean paid.
              </p>
            </div>
            <div className={styles.documentActions}>
              <Link
                href={
                  access.actions.canCreatePaymentBatch
                    ? `/team/payroll/payments/new?runId=${data.run.id}`
                    : `/team/payroll/payments?runId=${data.run.id}`
                }
              >
                {access.actions.canCreatePaymentBatch
                  ? "Check readiness"
                  : "View payment batches"}
              </Link>
            </div>
          </div>
        </section>
      ) : null}

      {data.run.status === "FINALIZED" && (access.actions.canPublishPayslip || access.actions.canViewPayslip) ? (
        <section className={styles.snapshotPanel} aria-labelledby="payslip-publication-heading">
          <div className={styles.entriesHeader}>
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>Payslips</p>
              <h2 id="payslip-publication-heading">{data.run.publishedPayslipCount} of {data.run.employeeCount} published</h2>
              <p>Publishing freezes a PDF from this finalized payroll snapshot. Staff can access only their own published document.</p>
            </div>
            {access.actions.canPublishPayslip && data.run.publishedPayslipCount < data.run.employeeCount ? (
              <details className={`${styles.actionDisclosure} ${styles.highRiskDisclosure}`}>
                <summary className={styles.primaryAction}>Publish payslips</summary>
                <form action={publishPayrollPayslipsAction} className={styles.actionConfirmation}>
                  <WorkflowFields month={legacyMonth} runId={data.run.id} returnPath={returnPath} />
                  <strong>Publish all remaining employee payslips?</strong>
                  <p>Published documents are immutable and will prevent this payroll from being reopened.</p>
                  <button className={styles.primaryButton} type="submit">Confirm publication</button>
                </form>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

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
          <div>
            <dt>Attendance source</dt>
            <dd>{attendanceSourceLabel(data.run.attendanceProvenanceState)}</dd>
          </div>
          <div>
            <dt>Timesheet revision</dt>
            <dd>{data.run.attendanceTimesheetRevision ? `Revision ${data.run.attendanceTimesheetRevision}` : "Legacy payroll snapshot"}</dd>
          </div>
          <div>
            <dt>Timesheet locked</dt>
            <dd>{data.run.attendanceTimesheetLockedAt ? formatDateTime(data.run.attendanceTimesheetLockedAt) : "Not recorded for legacy payroll"}</dd>
          </div>
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
            {readinessFilter !== "ALL" ? (
              <input name="readiness" type="hidden" value={readinessFilter} />
            ) : null}
            <div>
              <input id="entry-search" name="q" defaultValue={data.query} maxLength={80} placeholder="Name or employee code" />
              <button type="submit">Search</button>
            </div>
          </form>
        </div>

        <nav className={styles.readinessFilters} aria-label="Filter employee readiness">
          {(["ALL", "READY", "REVIEW_REQUIRED", "BLOCKED"] as const).map((status) => (
            <Link
              aria-current={readinessFilter === status ? "page" : undefined}
              className={readinessFilter === status ? styles.readinessFilterActive : undefined}
              href={readinessFilterPath(data.run.id, status, data.query)}
              key={status}
            >
              {readinessFilterLabel(status)}
            </Link>
          ))}
        </nav>

        {data.entries.length ? (
          <>
            <div className={styles.tableWrap}>
              <table className={`${styles.runTable} ${styles.entryTable}`}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Basic</th>
                    <th>Recurring</th>
                    <th>Variable</th>
                    <th>Adjustments</th>
                    <th>Gross</th>
                    <th>Deductions</th>
                    <th>Net pay</th>
                    <th>Status / issues</th>
                    {(access.actions.canViewComponents) ||
                    (access.actions.canViewPayslip && data.run.status === "FINALIZED") ? (
                      <th><span className={styles.visuallyHidden}>Entry actions</span></th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => {
                    const employeeReadiness = readinessByMembership.get(entry.membershipId);
                    return (
                    <tr key={entry.id}>
                      <td data-label="Employee">
                        <Link className={styles.employeeLink} href={`/team/people/${entry.membershipId}`}>{entry.fullName}</Link>
                        <small>{entry.employeeCode}</small>
                      </td>
                      <td data-label="Basic">{formatMoney(entry.basicPay)}</td>
                      <td data-label="Recurring">{formatSignedMoney(entry.recurringPay)}</td>
                      <td data-label="Variable">{formatSignedMoney(entry.variablePay)}</td>
                      <td data-label="Adjustments">{formatSignedMoney(entry.adjustments)}</td>
                      <td data-label="Gross">{formatMoney(entry.grossPay)}</td>
                      <td data-label="Deductions">{formatMoney(entry.deductions)}</td>
                      <td data-label="Net pay"><strong>{formatMoney(entry.netPay)}</strong></td>
                      <td data-label="Status / issues">
                        <strong>{readinessFilterLabel(employeeReadiness?.status ?? "READY")}</strong>
                        {employeeReadiness?.issues.length ? (
                          <details className={styles.employeeIssues}>
                            <summary>{employeeReadiness.issues.length} issue{employeeReadiness.issues.length === 1 ? "" : "s"}</summary>
                            <ul>
                              {employeeReadiness.issues.map((issue, index) => (
                                <li key={`${issue.code}-${index}`}>
                                  <b>{issue.source}</b>
                                  <span>{issue.message}</span>
                                  <small>{issue.resolutionHint}</small>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : <small>No readiness issues</small>}
                      </td>
                      {(access.actions.canViewComponents) ||
                      (access.actions.canViewPayslip && data.run.status === "FINALIZED") ? (
                        <td data-label="Actions">
                          <div className={styles.entryActions}>
                            {access.actions.canViewComponents ? (
                              <Link
                                className={styles.entryAction}
                                href={entryEditorPath(data.run.id, entry.id, entryReturnPath)}
                              >
                                {access.actions.canEditEntry && data.run.status === "DRAFT" ? "Review / edit" : "View components"}
                              </Link>
                            ) : null}
                            {access.actions.canViewPayslip && data.run.status === "FINALIZED" ? (
                              <Link
                                className={styles.entryAction}
                                href={`/team/payroll/payslips/${entry.id}`}
                                target="_blank"
                              >
                                {entry.payslipPublished ? "Published payslip PDF" : "Payslip preview PDF"}
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <EntryPagination
              runId={data.run.id}
              query={data.query}
              readiness={readinessFilter}
              page={data.page}
              totalPages={data.totalPages}
            />
          </>
        ) : (
          <div className={styles.inlineEmpty}>
            <h3>{data.query ? "No matching employees" : "No employee entries"}</h3>
            <p>{data.query ? "Try a different name or employee code." : "This calculation run does not contain employee entries."}</p>
            {data.query ? (
              <Link href={readinessFilterPath(data.run.id, readinessFilter)}>Clear search</Link>
            ) : null}
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

type ReadinessFilter = PayrollReadinessStatus | "ALL";

type ReadinessIssueGroup = {
  key: string;
  employeeName: string;
  issues: PayrollReadinessIssue[];
};

function groupReadinessIssues(issues: PayrollReadinessIssue[]): ReadinessIssueGroup[] {
  const groups = new Map<string, ReadinessIssueGroup>();
  for (const issue of issues) {
    const key = issue.membershipId ?? "run";
    const existing = groups.get(key);
    if (existing) {
      existing.issues.push(issue);
      continue;
    }
    groups.set(key, {
      key,
      employeeName: issue.employeeName ?? "Payroll run",
      issues: [issue],
    });
  }
  return [...groups.values()];
}

function readinessIssueDisplay(issue: PayrollReadinessIssue) {
  const scheme = statutorySchemeFromMessage(issue.message);
  switch (issue.code) {
    case "STALE_STATUTORY_SOURCE":
      return {
        title: `${scheme} is ready to recalculate`,
        description: "The approved rule became active after this Draft was created.",
      };
    case "STATUTORY_RULE_NOT_AVAILABLE":
      return {
        title: `${scheme} payroll rule is not active`,
        description: `${scheme} cannot be calculated until its rule has been reviewed, approved and turned on.`,
      };
    case "LINDUNG24_PROFILE_INCOMPLETE":
    case "LINDUNG24_PARTICIPATION_REQUIRED":
      return {
        title: "Complete LINDUNG 24 participation",
        description: "Participation evidence is missing from this employee's statutory profile.",
      };
    case "LINDUNG24_SELECTED_EMPLOYER_REQUIRED":
      return {
        title: "Select the LINDUNG 24 employer",
        description: "Choose the employer covered by the employee's participation record.",
      };
    case "PCB_PROFILE_INCOMPLETE":
      return {
        title: "Complete PCB tax details",
        description: "PCB cannot be calculated until this employee's required tax details are complete.",
      };
    case "PCB_YTD_LEDGER_INCOMPLETE":
      return {
        title: "Review PCB year-to-date totals",
        description: "Previous-employer or finalized payroll totals needed for this tax year are incomplete.",
      };
    case "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED":
      return {
        title: "Confirm EPF for additional pay",
        description: "PCB needs the EPF amount attributable to this additional payment before it can be calculated safely.",
      };
    case "STATUTORY_PROFILE_INCOMPLETE":
      return {
        title: `${scheme} employee details are incomplete`,
        description: `Complete the employee information required to calculate ${scheme}.`,
      };
    case "STATUTORY_CLASSIFICATION_REQUIRED":
      return {
        title: `${scheme} classification needs review`,
        description: `Confirm how ${scheme} applies to this employee before payroll is recalculated.`,
      };
    default:
      return {
        title: issueTitle(issue),
        description: stripTechnicalErrorCode(issue.message),
      };
  }
}

function statutorySchemeFromMessage(message: string) {
  return message.match(/^([A-Z][A-Z0-9/ ]{1,20})\b/)?.[1].trim() ?? "Statutory rule";
}

function issueTitle(issue: PayrollReadinessIssue) {
  return issue.code
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function stripTechnicalErrorCode(message: string) {
  return message
    .replace(/:\s*[A-Z][A-Z0-9_]+\.?$/u, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function readinessIssueFix(
  issue: PayrollReadinessIssue,
  month: string,
  runStatus: "DRAFT" | "REVIEW" | "FINALIZED",
) {
  if (issue.code === "STALE_STATUTORY_SOURCE" && runStatus === "DRAFT") {
    return { href: "#refresh-draft" };
  }
  if (
    issue.code === "STATUTORY_RULE_NOT_AVAILABLE" ||
    issue.code === "STATUTORY_CLASSIFICATION_REQUIRED" ||
    issue.code === "STATUTORY_CALCULATION_FAILED"
  ) {
    return { href: "/admin/statutory/rulesets" };
  }
  if (
    issue.code === "STATUTORY_PROFILE_INCOMPLETE" ||
    issue.code === "PCB_PROFILE_INCOMPLETE" ||
    issue.code === "PCB_YTD_LEDGER_INCOMPLETE" ||
    issue.code === "PCB_ADDITIONAL_EPF_ALLOCATION_REQUIRED" ||
    issue.code.startsWith("LINDUNG24_") ||
    issue.code === "STALE_LINDUNG24_PARTICIPATION"
  ) {
    return { href: issue.membershipId ? `/team/people/${issue.membershipId}?section=statutory` : "/team" };
  }
  if (
    issue.code === "MISSING_COMPENSATION" ||
    issue.code === "PRORATION_NOT_SUPPORTED" ||
    issue.code === "FUTURE_COMPENSATION_CHANGE" ||
    issue.code === "MISSING_BANK_ACCOUNT" ||
    issue.code === "BANK_ACCOUNT_UNVERIFIED"
  ) {
    return { href: issue.membershipId ? `/team/people/${issue.membershipId}?section=payroll` : "/team/payroll" };
  }
  if (
    issue.code === "MISSING_LOCKED_TIMESHEET" ||
    issue.code === "STALE_ATTENDANCE_SOURCE" ||
    issue.code === "TIMESHEET_REVISION_INVALID" ||
    issue.code === "APPROVED_ATTENDANCE_INPUT_NOT_MATERIALISED" ||
    issue.code === "ATTENDANCE_PAY_POLICY_NOT_READY" ||
    issue.code === "OVERTIME_APPROVAL_SOURCE_NOT_READY"
  ) {
    return { href: `/team/attendance/timesheets?month=${month}` };
  }
  if (issue.code === "CLAIM_STATUTORY_TREATMENT_NOT_READY" && issue.membershipId) {
    return { href: `/team/people/${issue.membershipId}?section=claims` };
  }
  return { href: issue.membershipId ? `/team/people/${issue.membershipId}` : `/team/payroll/settings?month=${month}` };
}

function parseReadinessFilter(value?: string): ReadinessFilter {
  return value === "READY" || value === "REVIEW_REQUIRED" || value === "BLOCKED"
    ? value
    : "ALL";
}

function readinessFilterLabel(status: ReadinessFilter) {
  if (status === "ALL") return "All employees";
  if (status === "REVIEW_REQUIRED") return "Review required";
  return status === "READY" ? "Ready" : "Blocked";
}

function readinessHeading(status: PayrollReadinessStatus) {
  if (status === "READY") return "Ready for workflow";
  if (status === "REVIEW_REQUIRED") return "Ready with items to review";
  return "Resolve blockers before review";
}

function readinessFilterPath(
  runId: string,
  status: ReadinessFilter,
  query?: string,
  page?: number,
) {
  const search = new URLSearchParams();
  if (status !== "ALL") search.set("readiness", status);
  if (query) search.set("q", query);
  if (page && page > 1) search.set("page", String(page));
  const suffix = search.toString();
  return `/team/payroll/runs/${runId}${suffix ? `?${suffix}` : ""}`;
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

function EntryPagination({
  runId,
  query,
  readiness,
  page,
  totalPages,
}: {
  runId: string;
  query: string;
  readiness: ReadinessFilter;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const href = (target: number) => readinessFilterPath(runId, readiness, query, target);
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

function attendanceSourceLabel(
  state:
    | "CURRENT_LOCKED_REVISION"
    | "REFRESH_REQUIRED"
    | "LOCKED_HISTORICAL_SNAPSHOT"
    | "LEGACY_FINALIZED",
) {
  if (state === "CURRENT_LOCKED_REVISION") return "Current locked Timesheet revision";
  if (state === "REFRESH_REQUIRED") return "Refresh required before workflow can continue";
  if (state === "LOCKED_HISTORICAL_SNAPSHOT") return "Locked Timesheet revision used at finalization";
  return "Legacy finalized Attendance snapshot";
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

function formatSignedMoney(value: number) {
  if (value === 0) return "—";
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}
