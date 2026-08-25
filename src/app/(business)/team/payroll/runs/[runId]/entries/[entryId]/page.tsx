import Link from "next/link";
import { notFound } from "next/navigation";
import { resolvePayrollRunsReadAccess } from "@/lib/payroll/runs-access";
import { loadPayrollRunEntryEditor } from "@/lib/payroll/entry-editor";
import {
  payrollRunReturnPath,
} from "@/lib/payroll/runs";
import {
  addManualPayrollAdjustmentAction,
  approvePayrollCorrectionAction,
  approvePayrollVariablePayAction,
  cancelPayrollCorrectionAction,
  cancelPayrollVariablePayAction,
  createPayrollCorrectionAction,
  createPayrollVariablePayAction,
  decidePayrollHolidayPayAction,
  editManualPayrollAdjustmentAction,
  removeManualPayrollAdjustmentAction,
  updatePayrollEntryAction,
} from "../../../../actions";
import {
  formatMoney,
  formatMonth,
  PageHeader,
  PayrollRunsAccessDenied,
} from "../../../_components";
import styles from "../../../runs.module.css";

export const dynamic = "force-dynamic";

type PayrollEntryEditorPageProps = {
  params: Promise<{ entryId: string; runId: string }>;
  searchParams: Promise<{ returnPath?: string }>;
};

export default async function PayrollEntryEditorPage({
  params,
  searchParams,
}: PayrollEntryEditorPageProps) {
  const access = await resolvePayrollRunsReadAccess();
  if (
    !access.granted ||
    !access.actions.canViewComponents
  ) {
    return (
      <PayrollRunsAccessDenied
        scopeRestricted={!access.granted && access.scopeRestricted}
      />
    );
  }

  const [{ entryId, runId }, query] = await Promise.all([params, searchParams]);
  const data = await loadPayrollRunEntryEditor(
    access.businessId,
    runId,
    entryId,
  );
  if (!data) notFound();

  const returnPath =
    payrollRunReturnPath(runId, query.returnPath ?? null) ??
    `/team/payroll/runs/${runId}`;
  const month = data.run.periodStart.toISOString().slice(0, 7);
  const canEdit = access.actions.canEditEntry && data.run.status === "DRAFT";
  if (!canEdit) {
    return (
      <ReadOnlyPayrollEntry
        data={data}
        returnPath={returnPath}
      />
    );
  }
  const earnedStart = `${month}-01`;
  const earnedEnd = new Date(
    Date.UTC(
      data.run.periodStart.getUTCFullYear(),
      data.run.periodStart.getUTCMonth() + 1,
      0,
    ),
  )
    .toISOString()
    .slice(0, 10);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title={`Edit ${data.entry.fullName}`}
        description={`${formatMonth(data.run.periodStart)} draft entry. This changes only this Payroll Run snapshot.`}
      >
        <Link href={returnPath}>Back to payroll run</Link>
      </PageHeader>

      <section className={styles.editorPanel} aria-labelledby="entry-editor-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Draft employee entry</p>
          <h2 id="entry-editor-heading">{data.entry.fullName}</h2>
          <p>{data.entry.employeeCode} · Manual values are audited and do not edit the employee Salary or Statutory Profile.</p>
        </div>

        <div className={styles.editorSummary}>
          <SummaryMetric label="Basic pay" value={formatMoney(data.entry.basicPay)} />
          <SummaryMetric label="Leave pay" value={formatMoney(data.entry.leavePay)} />
          <SummaryMetric label="Additional time pay" value={formatMoney(data.entry.overtimePay)} />
          <SummaryMetric label="Holiday pay" value={formatMoney(data.entry.publicHolidayPay)} />
          <SummaryMetric label="Unpaid leave deduction" value={formatMoney(data.entry.unpaidLeaveDeduction)} />
          <SummaryMetric label="Current gross" value={formatMoney(data.entry.grossPay)} />
          <SummaryMetric label="Current net" value={formatMoney(data.entry.netPay)} />
          <SummaryMetric label="Calculation revision" value={String(data.entry.calculationRevision)} />
          <SummaryMetric label="Run status" value="Draft" />
        </div>

        <AttendanceSourceSnapshot attendance={data.entry.attendance} />
        <PublicHolidayPayReview
          data={data}
          editable
          month={month}
          returnPath={returnPath}
        />
        <StatutorySnapshotDetail snapshots={data.entry.statutorySnapshots} />

        <div className={styles.editorFieldset}>
          <h3>Earning lines</h3>
          <ComponentLines
            components={data.entry.components.filter((component) => component.type === "EARNING")}
            entryId={data.entry.id}
            expectedRevision={data.entry.calculationRevision}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
          />
          <strong>Gross earnings: {formatMoney(data.entry.grossPay)}</strong>
        </div>

        <div className={styles.editorFieldset}>
          <h3>Non-statutory deduction lines</h3>
          <ComponentLines
            components={data.entry.components.filter((component) => component.type === "DEDUCTION")}
            entryId={data.entry.id}
            expectedRevision={data.entry.calculationRevision}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
          />
          <strong>Total non-statutory deductions: {formatMoney(data.entry.otherDeductions)}</strong>
        </div>

        <div className={styles.editorGrid}>
          <ManualAdjustmentForm
            entryId={data.entry.id}
            expectedRevision={data.entry.calculationRevision}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
            type="EARNING"
          />
          <ManualAdjustmentForm
            entryId={data.entry.id}
            expectedRevision={data.entry.calculationRevision}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
            type="DEDUCTION"
          />
        </div>

        <section className={styles.editorFieldset}>
          <h3>Variable pay sources</h3>
          <p>
            Sources are frozen and independently approved before an explicit
            payroll refresh materialises them. Payroll never reads live POS
            sales here.
          </p>
          <P4CSourceList
            canApprove={access.workflow.canFinalize}
            entryId={data.entry.id}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
            sources={data.entry.variablePay.map((source) => ({
              ...source,
              kind: "VARIABLE" as const,
              summary: `${source.type} · ${source.origin}`,
            }))}
          />
          <form action={createPayrollVariablePayAction} className={styles.editorForm}>
            <ComponentHiddenFields
              entryId={data.entry.id}
              expectedRevision={data.entry.calculationRevision}
              month={month}
              returnPath={returnPath}
              runId={data.run.id}
            />
            <input name="membershipId" type="hidden" value={data.entry.membershipId} />
            <h4>Create variable pay draft</h4>
            <label className={styles.notesField}>
              <span>Category</span>
              <select name="variableType" required>
                <option value="COMMISSION">Commission</option>
                <option value="BONUS">Bonus</option>
                <option value="INCENTIVE">Incentive</option>
                <option value="ONE_OFF_EARNING">One-off earning</option>
                <option value="ONE_OFF_DEDUCTION">One-off deduction</option>
                <option value="ARREARS">Arrears</option>
                <option value="RECOVERY">Recovery</option>
              </select>
            </label>
            <label className={styles.notesField}>
              <span>Description</span>
              <input maxLength={120} minLength={2} name="description" required />
            </label>
            <MoneyField label="Amount" name="amount" value={0} />
            <div className={styles.editorGrid}>
              <label className={styles.notesField}>
                <span>Earned period start</span>
                <input defaultValue={earnedStart} name="earnedPeriodStart" required type="date" />
              </label>
              <label className={styles.notesField}>
                <span>Earned period end</span>
                <input defaultValue={earnedEnd} name="earnedPeriodEnd" required type="date" />
              </label>
            </div>
            <label className={styles.notesField}>
              <span>Source reference</span>
              <input maxLength={160} name="sourceReference" placeholder="Optional stable import or manager reference" />
            </label>
            <label className={styles.notesField}>
              <span>Reason</span>
              <input maxLength={500} minLength={5} name="reason" required />
            </label>
            <button className={styles.primaryButton} type="submit">Create variable pay draft</button>
          </form>
        </section>

        <section className={styles.editorFieldset}>
          <h3>Future-payroll corrections</h3>
          <p>
            A correction never changes the finalized original. Only its exact
            positive delta is applied here as Salary Arrears or Payroll Recovery.
          </p>
          <P4CSourceList
            canApprove={access.workflow.canFinalize}
            entryId={data.entry.id}
            month={month}
            returnPath={returnPath}
            runId={data.run.id}
            sources={data.entry.corrections.map((source) => ({
              ...source,
              amount: source.deltaAmount,
              kind: "CORRECTION" as const,
              summary: `${source.deltaType} delta · original ${source.originalPayrollEntryId.slice(0, 8)}`,
            }))}
          />
          {data.entry.correctionOrigins.length ? (
            <form action={createPayrollCorrectionAction} className={styles.editorForm}>
              <ComponentHiddenFields
                entryId={data.entry.id}
                expectedRevision={data.entry.calculationRevision}
                month={month}
                returnPath={returnPath}
                runId={data.run.id}
              />
              <h4>Create correction draft</h4>
              <label className={styles.notesField}>
                <span>Finalized original payroll</span>
                <select name="originalPayrollEntryId" required>
                  {data.entry.correctionOrigins.map((origin) => (
                    <option key={origin.id} value={origin.id}>
                      {formatMonth(origin.periodStart)} · Gross {formatMoney(origin.grossPay)} · Net {formatMoney(origin.netPay)}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.editorGrid}>
                <MoneyField label="Original amount" name="originalAmount" value={0} />
                <MoneyField label="Corrected amount" name="correctedAmount" value={0} />
              </div>
              <label className={styles.notesField}>
                <span>Description</span>
                <input maxLength={120} minLength={2} name="description" placeholder="Salary arrears or recovery" required />
              </label>
              <label className={styles.notesField}>
                <span>Correction reference</span>
                <input maxLength={160} name="sourceReference" />
              </label>
              <label className={styles.notesField}>
                <span>Correction reason</span>
                <input maxLength={500} minLength={5} name="reason" required />
              </label>
              <button className={styles.primaryButton} type="submit">Create correction draft</button>
            </form>
          ) : (
            <p>No earlier finalized payroll entry is available for this employee.</p>
          )}
        </section>

        <form action={updatePayrollEntryAction} className={styles.editorForm}>
          <input name="entryId" type="hidden" value={data.entry.id} />
          <input name="expectedRevision" type="hidden" value={data.entry.calculationRevision} />
          <input name="runId" type="hidden" value={data.run.id} />
          <input name="month" type="hidden" value={month} />
          <input name="returnPath" type="hidden" value={returnPath} />
          <input name="epfWageBase" type="hidden" value={moneyValue(data.entry.epfWageBase)} />
          <input name="perkesoWageBase" type="hidden" value={moneyValue(data.entry.perkesoWageBase)} />

          <fieldset className={styles.editorFieldset}>
            <legend>Statutory P2 snapshot (read-only)</legend>
            <p>Amounts come only from frozen, scheme-specific statutory snapshots. Direct overrides are disabled and unresolved official rules remain blocked.</p>
            <div className={styles.editorGrid}>
              <MoneyField label="EPF employee" name="epfEmployee" readOnly value={data.entry.epfEmployee} />
              <MoneyField label="SOCSO employee" name="socsoEmployee" readOnly value={data.entry.socsoEmployee} />
              <MoneyField label="EIS employee" name="eisEmployee" readOnly value={data.entry.eisEmployee} />
              <MoneyField label="LINDUNG 24" name="lindung24Employee" readOnly value={data.entry.lindung24Employee} />
              <MoneyField label="PCB" name="pcb" readOnly value={data.entry.pcb} />
              <MoneyField label="CP38 instruction" name="cp38" readOnly value={data.entry.cp38} />
            </div>
          </fieldset>

          <fieldset className={styles.editorFieldset}>
            <legend>Employer contributions</legend>
            <div className={styles.editorGrid}>
              <MoneyField label="Employer EPF" name="employerEpf" readOnly value={data.entry.employerEpf} />
              <MoneyField label="Employer SOCSO" name="employerSocso" readOnly value={data.entry.employerSocso} />
              <MoneyField label="Employer EIS" name="employerEis" readOnly value={data.entry.employerEis} />
            </div>
          </fieldset>

          <label className={styles.notesField}>
            <span>Payroll notes</span>
            <input
              defaultValue={data.entry.notes}
              maxLength={500}
              name="notes"
              placeholder="Optional note for this employee entry"
            />
          </label>

          <div className={styles.editorFooter}>
            <Link href={returnPath}>Cancel and return</Link>
            <button className={styles.primaryButton} type="submit">Save employee entry</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function ReadOnlyPayrollEntry({
  data,
  returnPath,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>;
  returnPath: string;
}) {
  const correctionPeriods = new Map(
    data.entry.correctionOrigins.map((origin) => [
      origin.id,
      formatMonth(origin.periodStart),
    ]),
  );
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <PageHeader
        title={data.entry.fullName}
        description={`${formatMonth(data.run.periodStart)} ${data.run.status.toLowerCase()} payroll snapshot. Component values are read-only.`}
      >
        <Link href={returnPath}>Back to payroll run</Link>
      </PageHeader>
      <section className={styles.editorPanel} aria-labelledby="entry-detail-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Employee payroll detail</p>
          <h2 id="entry-detail-heading">{data.entry.fullName}</h2>
          <p>{data.entry.employeeCode} · {data.run.status === "REVIEW" ? "Review is locked for editing." : "Finalized payroll is immutable."}</p>
        </div>
        <div className={styles.editorSummary}>
          <SummaryMetric label="Gross pay" value={formatMoney(data.entry.grossPay)} />
          <SummaryMetric label="Non-statutory deductions" value={formatMoney(data.entry.otherDeductions)} />
          <SummaryMetric label="Net pay" value={formatMoney(data.entry.netPay)} />
          <SummaryMetric label="Calculation revision" value={String(data.entry.calculationRevision)} />
        </div>
        <AttendanceSourceSnapshot attendance={data.entry.attendance} />
        <StatutorySnapshotDetail snapshots={data.entry.statutorySnapshots} />
        <PublicHolidayPayReview
          data={data}
          editable={false}
          month={data.run.periodStart.toISOString().slice(0, 7)}
          returnPath={returnPath}
        />
        <div className={styles.editorGrid}>
          <ReadOnlyComponentGroup
            title="Earnings"
            components={data.entry.components.filter((component) => component.type === "EARNING")}
          />
          <ReadOnlyComponentGroup
            title="Deductions"
            components={data.entry.components.filter((component) => component.type === "DEDUCTION")}
          />
        </div>
        <section className={styles.editorFieldset}>
          <h3>Variable pay and corrections</h3>
          {data.entry.variablePay.length || data.entry.corrections.length ? (
            <div className={styles.componentList}>
              {data.entry.variablePay.map((source) => (
                <div className={styles.componentRow} key={source.id}>
                  <div><strong>{source.name}</strong><small>Approved variable pay · {source.status} · earned {formatMonth(source.earnedPeriodStart)}</small></div>
                  <span>{formatMoney(source.amount)}</span>
                </div>
              ))}
              {data.entry.corrections.map((source) => (
                <div className={styles.componentRow} key={source.id}>
                  <div><strong>{source.name}</strong><small>Correction · {source.status} · original payroll {correctionPeriods.get(source.originalPayrollEntryId) ?? "historical snapshot"}</small></div>
                  <span>{source.deltaType === "DEDUCTION" ? "−" : "+"}{formatMoney(source.deltaAmount)}</span>
                </div>
              ))}
            </div>
          ) : <p>No variable pay or corrections in this entry.</p>}
        </section>
      </section>
    </main>
  );
}

function PublicHolidayPayReview({
  data,
  editable,
  month,
  returnPath,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>;
  editable: boolean;
  month: string;
  returnPath: string;
}) {
  const minutes = data.entry.attendance?.publicHolidayWorkedMinutes ?? 0;
  const status = data.entry.publicHolidayPayDecisionStatus;
  const statusLabel = {
    NOT_APPLICABLE: "Not applicable",
    POLICY_DISABLED: "Policy off",
    PENDING_CONFIRMATION: "Needs confirmation",
    CONFIRMED: "Included",
    EXCLUDED: "Excluded",
  }[status];

  return (
    <section className={styles.editorFieldset} aria-labelledby="holiday-pay-review-heading">
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Public holiday pay</p>
        <h3 id="holiday-pay-review-heading">Review before payroll inclusion</h3>
        <p>
          The preview uses frozen Timesheet evidence and Payroll policy revision {data.run.publicHolidayPayPolicyRevisionSnapshot}.
          It is a business-policy calculation, not automatic statutory or legal advice.
        </p>
      </div>
      <div className={styles.editorSummary}>
        <SummaryMetric label="Holiday work" value={`${minutes} min`} />
        <SummaryMetric label="Policy multiplier" value={`${data.run.publicHolidayExtraMultiplierSnapshot}×`} />
        <SummaryMetric label="Preview" value={formatMoney(data.entry.publicHolidayPayPreview)} />
        <SummaryMetric label="Included in pay" value={formatMoney(data.entry.publicHolidayPay)} />
        <SummaryMetric label="Decision" value={statusLabel} />
      </div>

      {status === "POLICY_DISABLED" ? (
        <p className={`${styles.notice} ${styles.noticeError}`}>
          Public holiday pay is disabled in this run snapshot. Enable and review the policy in Payroll settings, then regenerate the Draft run.
        </p>
      ) : status === "PENDING_CONFIRMATION" && editable ? (
        <div className={styles.editorGrid}>
          <form action={decidePayrollHolidayPayAction} className={styles.editorForm}>
            <HolidayPayHiddenFields
              data={data}
              decision="CONFIRMED"
              month={month}
              returnPath={returnPath}
            />
            <div className={styles.noWorkflowAction}>
              <strong>Include {formatMoney(data.entry.publicHolidayPayPreview)}</strong>
              <span>Recalculates the preview from canonical frozen facts inside the server transaction.</span>
            </div>
            <button className={styles.primaryButton} type="submit">Confirm and include</button>
          </form>
          <form action={decidePayrollHolidayPayAction} className={styles.editorForm}>
            <HolidayPayHiddenFields
              data={data}
              decision="EXCLUDED"
              month={month}
              returnPath={returnPath}
            />
            <label className={styles.notesField}>
              <span>Reason for exclusion</span>
              <input
                maxLength={500}
                minLength={5}
                name="reason"
                placeholder="Record the reviewed business reason"
                required
              />
            </label>
            <button className={styles.secondaryButton} type="submit">Exclude with reason</button>
          </form>
        </div>
      ) : status === "CONFIRMED" ? (
        <p className={`${styles.notice} ${styles.noticeSuccess}`}>
          Confirmed and included in this payroll calculation.
        </p>
      ) : status === "EXCLUDED" ? (
        <p className={styles.readOnlyNote}>
          <strong>Excluded after review.</strong>
          {data.entry.publicHolidayPayDecisionReason ?? "An audit reason was recorded."}
        </p>
      ) : (
        <p className={styles.readOnlyNote}>
          <strong>No holiday-pay decision is required.</strong>
          No frozen public-holiday work minutes were found for this entry.
        </p>
      )}
    </section>
  );
}

function HolidayPayHiddenFields({
  data,
  decision,
  month,
  returnPath,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>;
  decision: "CONFIRMED" | "EXCLUDED";
  month: string;
  returnPath: string;
}) {
  return (
    <>
      <input name="entryId" type="hidden" value={data.entry.id} />
      <input name="expectedRevision" type="hidden" value={data.entry.calculationRevision} />
      <input name="runId" type="hidden" value={data.run.id} />
      <input name="month" type="hidden" value={month} />
      <input name="returnPath" type="hidden" value={returnPath} />
      <input name="decision" type="hidden" value={decision} />
    </>
  );
}

function ReadOnlyComponentGroup({
  components,
  title,
}: {
  components: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>["entry"]["components"];
  title: string;
}) {
  return (
    <section className={styles.editorFieldset}>
      <h3>{title}</h3>
      {components.length ? (
        <div className={styles.componentList}>
          {components.map((component) => (
            <div className={styles.componentRow} key={component.id}>
              <div>
                <strong>{component.name}</strong>
                <small>{component.source}{component.effectiveFromMonth ? ` · effective ${formatMonth(component.effectiveFromMonth)}` : ""}</small>
                {component.reason ? <small>Reason recorded: {component.reason}</small> : null}
              </div>
              <span>{formatMoney(component.amount)}</span>
            </div>
          ))}
        </div>
      ) : <p>No {title.toLowerCase()}.</p>}
    </section>
  );
}

function StatutorySnapshotDetail({
  snapshots,
}: {
  snapshots: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>["entry"]["statutorySnapshots"];
}) {
  return (
    <section className={styles.editorFieldset}>
      <div className={styles.sectionHeading}>
        <p className={styles.eyebrow}>Payroll contributions</p>
        <h3>Calculated contributions for this employee</h3>
        <p>Amounts below are included in this payroll calculation.</p>
      </div>
      {snapshots.length ? (
        <>
          <div className={styles.statutorySnapshotGrid}>
            {snapshots.map((snapshot) => (
              <article
                className={styles.statutorySnapshotCard}
                data-status={snapshot.status.toLowerCase()}
                key={snapshot.scheme}
              >
                <div className={styles.statutorySnapshotHeading}>
                  <strong>{friendlyStatutoryScheme(snapshot.scheme)}</strong>
                  <span>{friendlyStatutoryStatus(snapshot.status)}</span>
                </div>
                {snapshot.status === "CALCULATED" ? (
                  <dl>
                    <div>
                      <dt>Pay used</dt>
                      <dd>{formatMoney(snapshot.wageBase)}</dd>
                    </div>
                    <div>
                      <dt>Employee</dt>
                      <dd>{formatMoney(snapshot.employeeContribution)}</dd>
                    </div>
                    <div>
                      <dt>Employer</dt>
                      <dd>{formatMoney(snapshot.employerContribution)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p>{friendlyStatutoryBlocker(snapshot.scheme, snapshot.status)}</p>
                )}
                {snapshot.scheme === "PCB" ? (
                  <PcbFrozenBreakdown snapshot={snapshot} />
                ) : null}
              </article>
            ))}
          </div>
          <details className={styles.statutoryTechnicalDetails}>
            <summary>Technical calculation details</summary>
            <div className={styles.componentList}>
              {snapshots.map((snapshot) => (
                <div className={styles.componentRow} key={snapshot.scheme}>
                  <div>
                    <strong>{snapshot.scheme} · {snapshot.status}</strong>
                    <small>
                      Source {snapshot.calculationSource} · Rule {snapshot.ruleVersion ?? "not available"}
                      {snapshot.blockerCode ? ` · Blocker ${snapshot.blockerCode}` : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </>
      ) : (
        <p>No contribution calculation is available yet. Refresh this Draft payroll.</p>
      )}
    </section>
  );
}

function PcbFrozenBreakdown({
  snapshot,
}: {
  snapshot: NonNullable<Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>>["entry"]["statutorySnapshots"][number];
}) {
  const metadata = snapshot.calculationMetadata;
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") return null;
  const value = metadata as Record<string, unknown>;
  const amount = (key: string) =>
    Number.isSafeInteger(value[key]) ? formatMoney(Number(value[key]) / 100) : "Not recorded";
  const trace =
    value.calculatorTrace && typeof value.calculatorTrace === "object" && !Array.isArray(value.calculatorTrace)
      ? value.calculatorTrace as Record<string, unknown>
      : null;
  const traceAmount = (key: string) =>
    trace && Number.isSafeInteger(trace[key]) ? formatMoney(Number(trace[key]) / 100) : "Not recorded";
  const binding =
    value.governanceBinding && typeof value.governanceBinding === "object" && !Array.isArray(value.governanceBinding)
      ? value.governanceBinding as Record<string, unknown>
      : null;
  return (
    <details className={styles.statutoryTechnicalDetails}>
      <summary>View frozen PCB calculation</summary>
      <dl>
        <div><dt>Tax year / month</dt><dd>{String(value.taxYear ?? "Not recorded")} · {String(value.calculationMonth ?? "Not recorded")}</dd></div>
        <div><dt>Tax regime</dt><dd>{String(value.taxRegime ?? trace?.taxRegime ?? "Not recorded")}</dd></div>
        <div><dt>PCB category</dt><dd>{String(value.employeeCategory ?? trace?.employeeCategory ?? "Not recorded")}</dd></div>
        <div><dt>Normal monthly pay</dt><dd>{amount("normalRemunerationCents")}</dd></div>
        <div><dt>Additional pay</dt><dd>{amount("additionalRemunerationCents")}</dd></div>
        <div><dt>Current-employer YTD pay</dt><dd>{amount("currentEmployerYtdRemunerationCents")}</dd></div>
        <div><dt>Previous employer / TP3 pay</dt><dd>{amount("previousEmployerRemunerationCents")}</dd></div>
        <div><dt>Current EPF used</dt><dd>{amount("approvedSchemeContributionCents")}</dd></div>
        <div><dt>Previous employer / TP3 EPF</dt><dd>{amount("previousEmployerEpfCents")}</dd></div>
        <div><dt>Individual relief</dt><dd>{traceAmount("baseIndividualReliefCents")}</dd></div>
        <div><dt>Spouse relief</dt><dd>{traceAmount("spouseReliefCents")}</dd></div>
        <div><dt>Disability relief</dt><dd>{trace ? formatMoney((Number(trace.individualDisabilityReliefCents ?? 0) + Number(trace.spouseDisabilityReliefCents ?? 0)) / 100) : "Not recorded"}</dd></div>
        <div><dt>Child relief</dt><dd>{traceAmount("childReliefCents")}</dd></div>
        <div><dt>Current TP1 deductions</dt><dd>{amount("allowableDeductionsCents")}</dd></div>
        <div><dt>Accumulated deductions</dt><dd>{traceAmount("accumulatedAllowableDeductionsCents")}</dd></div>
        <div><dt>Zakat used</dt><dd>{amount("zakatCents")}</dd></div>
        <div><dt>YTD PCB already deducted</dt><dd>{amount("ytdPcbCents")}</dd></div>
        <div><dt>Previous employer / TP3 PCB</dt><dd>{amount("previousEmployerPcbCents")}</dd></div>
        <div><dt>Projected monthly EPF</dt><dd>{traceAmount("normalProjectedEpfCents")}</dd></div>
        <div><dt>Normal PCB before current rebates</dt><dd>{traceAmount("normalMtdBeforeCurrentRebatesCents")}</dd></div>
        <div><dt>Additional-pay PCB</dt><dd>{traceAmount("additionalMtdCents")}</dd></div>
        <div><dt>Calculated PCB</dt><dd>{amount("pcbCents")}</dd></div>
        <div><dt>Threshold and rounding</dt><dd>RM10 minimum · rounded up to 5 sen</dd></div>
        {binding ? (
          <div>
            <dt>Calculator binding</dt>
            <dd>{String(binding.calculatorVersion ?? "Not recorded")} · {String(binding.ruleSetVersion ?? "Not recorded")}</dd>
          </div>
        ) : null}
        <div><dt>Snapshot time</dt><dd>{snapshot.calculatedAt.toISOString()}</dd></div>
        <div><dt>Snapshot identity</dt><dd>{snapshot.calculationInputDigest ?? snapshot.sourceDigest}</dd></div>
      </dl>
      <p>This is the stored calculation used by this Payroll Run. It is never recalculated when viewed.</p>
    </details>
  );
}

function friendlyStatutoryScheme(scheme: string) {
  if (scheme === "EPF") return "EPF / KWSP";
  if (scheme === "SOCSO") return "SOCSO / PERKESO";
  if (scheme === "EIS") return "EIS / SIP";
  if (scheme === "LINDUNG24") return "LINDUNG 24";
  return scheme;
}

function friendlyStatutoryStatus(status: string) {
  if (status === "CALCULATED") return "Calculated";
  if (status === "NOT_APPLICABLE") return "Not applicable";
  if (status === "EXCLUDED") return "Not included";
  return "Setup needed";
}

function friendlyStatutoryBlocker(scheme: string, status: string) {
  if (status === "NOT_APPLICABLE") {
    return `${friendlyStatutoryScheme(scheme)} does not apply to this employee.`;
  }
  if (status === "EXCLUDED") {
    return `${friendlyStatutoryScheme(scheme)} is not included in this payroll.`;
  }
  return `Complete the ${friendlyStatutoryScheme(scheme)} setup, then refresh this Draft payroll.`;
}

function AttendanceSourceSnapshot({
  attendance,
}: {
  attendance: NonNullable<
    Awaited<ReturnType<typeof loadPayrollRunEntryEditor>>
  >["entry"]["attendance"];
}) {
  if (!attendance) {
    return (
      <section className={styles.editorFieldset}>
        <h3>Attendance source</h3>
        <p>Approved Attendance input has not been materialised.</p>
      </section>
    );
  }
  const hasP6bSegments = attendance.segmentFacts.length > 0;
  const approvedOtMinutes = hasP6bSegments
    ? attendance.normalOtMinutes +
      attendance.restDayOtMinutes +
      attendance.publicHolidayOtMinutes
    : attendance.approvedOvertimeMinutes;
  return (
    <section className={styles.editorFieldset}>
      <h3>Attendance source</h3>
      <p>
        Locked Timesheet revision {attendance.timesheetRevision} · locked {attendance.timesheetLockedAt.toLocaleString("en-MY")}.
      </p>
      <div className={styles.editorSummary}>
        <SummaryMetric
          label="Normal work"
          value={formatMinutes(
            hasP6bSegments
              ? attendance.regularNormalMinutes
              : attendance.regularMinutes,
          )}
        />
        <SummaryMetric
          label="Rest day work"
          value={formatMinutes(
            hasP6bSegments
              ? attendance.restDayWorkMinutes
              : attendance.restDayWorkedMinutes,
          )}
        />
        <SummaryMetric
          label="Public holiday work"
          value={formatMinutes(
            hasP6bSegments
              ? attendance.publicHolidayWorkMinutes
              : attendance.publicHolidayWorkedMinutes,
          )}
        />
        <SummaryMetric label="Approved OT" value={formatMinutes(approvedOtMinutes)} />
        <SummaryMetric label="Paid leave" value={`${attendance.paidLeaveDays} day(s)`} />
        <SummaryMetric label="Unpaid leave" value={`${attendance.unpaidLeaveDays} day(s)`} />
        <SummaryMetric label="Unauthorized absence" value={`${attendance.unauthorizedAbsenceDays} day(s)`} />
        <SummaryMetric label="Authorized absence" value={`${attendance.authorizedAbsenceDays} day(s)`} />
      </div>
      {hasP6bSegments ? (
        <details>
          <summary>View cross-midnight classification</summary>
          <div className={styles.editorSummary}>
            <SummaryMetric label="Normal · non-OT" value={formatMinutes(attendance.regularNormalMinutes)} />
            <SummaryMetric label="Normal · approved OT" value={formatMinutes(attendance.normalOtMinutes)} />
            <SummaryMetric label="Rest day · work" value={formatMinutes(attendance.restDayWorkMinutes)} />
            <SummaryMetric label="Rest day · approved OT" value={formatMinutes(attendance.restDayOtMinutes)} />
            <SummaryMetric label="Public holiday · work" value={formatMinutes(attendance.publicHolidayWorkMinutes)} />
            <SummaryMetric label="Public holiday · approved OT" value={formatMinutes(attendance.publicHolidayOtMinutes)} />
          </div>
          <div className={styles.componentList}>
            {attendance.segmentFacts.map((segment, index) => (
              <div className={styles.componentRow} key={`${segment.localDate}-${segment.startAt}-${index}`}>
                <div>
                  <strong>{formatSegmentDate(segment.localDate)} · {segmentContextLabel(segment.context)}</strong>
                  <small>
                    {formatSegmentTime(segment.startAt, segment.timezone)}–{formatSegmentTime(segment.endAt, segment.timezone)}
                    {segment.isRestDay && segment.isPublicHoliday
                      ? " · Public holiday overlapping a Rest Day"
                      : ""}
                  </small>
                </div>
                <span>
                  {formatMinutes(segment.workedMinutes)} worked
                  {segment.breakMinutes > 0 ? ` · ${formatMinutes(segment.breakMinutes)} break` : ""}
                  {segment.approvedOtMinutes > 0 ? ` · ${formatMinutes(segment.approvedOtMinutes)} approved OT` : ""}
                </span>
              </div>
            ))}
          </div>
          <p>Minute classification is frozen from the locked Timesheet. Monetary OT calculation is deferred to Payroll P6C.</p>
        </details>
      ) : null}
      {attendance.policyBlockers.length ? (
        <p>
          Payroll is blocked until policy is ready: {attendance.policyBlockers.join(", ")}.
        </p>
      ) : attendance.legacyCompatibility ? (
        <p>
          Legacy locked Timesheet compatibility: no Attendance money effect was inferred.
        </p>
      ) : (
        <p>Attendance payroll input is materialised and explainable.</p>
      )}
    </section>
  );
}

function formatMinutes(minutes: number) {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

function formatSegmentDate(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(localDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : localDate;
}

function formatSegmentTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(value));
}

function segmentContextLabel(
  context: "NORMAL" | "REST_DAY" | "PUBLIC_HOLIDAY",
) {
  if (context === "REST_DAY") return "Rest day";
  if (context === "PUBLIC_HOLIDAY") return "Public holiday";
  return "Normal workday";
}

type ComponentLine = PayrollRunEntryEditorComponent;

type PayrollRunEntryEditorComponent = {
  id: string;
  type: "EARNING" | "DEDUCTION";
  code: string;
  name: string;
  amount: number;
  source: string;
  effectiveFromMonth: Date | null;
  calculationBasis: string;
  origin: "SYSTEM" | "MANUAL";
  adjustmentCategory: string | null;
  reason: string | null;
};

function ComponentLines({
  components,
  entryId,
  expectedRevision,
  month,
  returnPath,
  runId,
}: {
  components: ComponentLine[];
  entryId: string;
  expectedRevision: number;
  month: string;
  returnPath: string;
  runId: string;
}) {
  if (!components.length) return <p>No component lines.</p>;
  return (
    <div className={styles.editorForm}>
      {components.map((component) => (
        <article className={styles.editorPanel} key={component.id}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>{component.code}</p>
            <h4>{component.name} — {formatMoney(component.amount)}</h4>
            <p>
              {component.source} · {component.calculationBasis}
              {component.adjustmentCategory
                ? ` · ${component.adjustmentCategory}`
                : ""}
              {component.effectiveFromMonth
                ? ` · Effective ${formatMonth(component.effectiveFromMonth)}`
                : ""}
            </p>
            {component.reason ? <p>Reason: {component.reason}</p> : null}
          </div>
          {component.origin === "MANUAL" ? (
            <div className={styles.editorGrid}>
              <form action={editManualPayrollAdjustmentAction} className={styles.editorForm}>
                <ComponentHiddenFields {...{ componentId: component.id, entryId, expectedRevision, month, returnPath, runId }} />
                <label className={styles.notesField}><span>Description</span><input defaultValue={component.name} maxLength={120} minLength={2} name="description" required /></label>
                <MoneyField label="Amount" name="amount" value={component.amount} />
                <label className={styles.notesField}><span>Edit reason</span><input maxLength={500} minLength={5} name="reason" required /></label>
                <button className={styles.primaryButton} type="submit">Update adjustment</button>
              </form>
              <form action={removeManualPayrollAdjustmentAction} className={styles.editorForm}>
                <ComponentHiddenFields {...{ componentId: component.id, entryId, expectedRevision, month, returnPath, runId }} />
                <label className={styles.notesField}><span>Removal reason</span><input maxLength={500} minLength={5} name="removalReason" required /></label>
                <button type="submit">Remove adjustment</button>
              </form>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ManualAdjustmentForm({
  entryId,
  expectedRevision,
  month,
  returnPath,
  runId,
  type,
}: {
  entryId: string;
  expectedRevision: number;
  month: string;
  returnPath: string;
  runId: string;
  type: "EARNING" | "DEDUCTION";
}) {
  return (
    <form action={addManualPayrollAdjustmentAction} className={styles.editorForm}>
      <ComponentHiddenFields {...{ entryId, expectedRevision, month, returnPath, runId }} />
      <input name="type" type="hidden" value={type} />
      <h3>Add manual {type === "EARNING" ? "earning" : "deduction"}</h3>
      <label className={styles.notesField}>
        <span>Classification</span>
        <select name="category" required>
          <option value="ONE_OFF">One-off</option>
          <option value="CORRECTION">Correction</option>
          <option value="ARREARS">Arrears</option>
          <option value="RECOVERY">Recovery</option>
          <option value="BONUS">Bonus</option>
          <option value="OTHER">Other</option>
        </select>
      </label>
      <label className={styles.notesField}><span>Description</span><input maxLength={120} minLength={2} name="description" required /></label>
      <MoneyField label="Amount" name="amount" value={0} />
      <label className={styles.notesField}><span>Reason</span><input maxLength={500} minLength={5} name="reason" required /></label>
      <button className={styles.primaryButton} type="submit">Add adjustment</button>
    </form>
  );
}

function ComponentHiddenFields({
  componentId,
  entryId,
  expectedRevision,
  month,
  returnPath,
  runId,
}: {
  componentId?: string;
  entryId: string;
  expectedRevision: number;
  month: string;
  returnPath: string;
  runId: string;
}) {
  return <>
    {componentId ? <input name="componentId" type="hidden" value={componentId} /> : null}
    <input name="entryId" type="hidden" value={entryId} />
    <input name="expectedRevision" type="hidden" value={expectedRevision} />
    <input name="month" type="hidden" value={month} />
    <input name="returnPath" type="hidden" value={returnPath} />
    <input name="runId" type="hidden" value={runId} />
  </>;
}

type P4CSourceItem = {
  id: string;
  kind: "VARIABLE" | "CORRECTION";
  name: string;
  amount: number;
  status: string;
  revision: number;
  reason: string;
  sourceReference: string | null;
  summary: string;
};

function P4CSourceList({
  canApprove,
  entryId,
  month,
  returnPath,
  runId,
  sources,
}: {
  canApprove: boolean;
  entryId: string;
  month: string;
  returnPath: string;
  runId: string;
  sources: P4CSourceItem[];
}) {
  if (!sources.length) return <p>No source records for this payroll period.</p>;
  return (
    <div className={styles.editorForm}>
      {sources.map((source) => {
        const approveAction =
          source.kind === "VARIABLE"
            ? approvePayrollVariablePayAction
            : approvePayrollCorrectionAction;
        const cancelAction =
          source.kind === "VARIABLE"
            ? cancelPayrollVariablePayAction
            : cancelPayrollCorrectionAction;
        const idName =
          source.kind === "VARIABLE" ? "variablePayId" : "correctionId";
        return (
          <article className={styles.editorPanel} key={source.id}>
            <div className={styles.sectionHeading}>
              <p className={styles.eyebrow}>{source.status}</p>
              <h4>{source.name} — {formatMoney(source.amount)}</h4>
              <p>
                {source.summary}
                {source.sourceReference ? ` · ${source.sourceReference}` : ""}
              </p>
              <p>Reason: {source.reason}</p>
            </div>
            {source.status === "DRAFT" && canApprove ? (
              <form action={approveAction} className={styles.editorForm}>
                <P4CSourceHiddenFields {...{ entryId, idName, month, returnPath, runId, source }} />
                <button className={styles.primaryButton} type="submit">Approve source</button>
              </form>
            ) : null}
            {source.status === "DRAFT" || source.status === "APPROVED" ? (
              <form action={cancelAction} className={styles.editorForm}>
                <P4CSourceHiddenFields {...{ entryId, idName, month, returnPath, runId, source }} />
                <label className={styles.notesField}>
                  <span>Cancellation reason</span>
                  <input maxLength={500} minLength={5} name="cancellationReason" required />
                </label>
                <button type="submit">Cancel source</button>
              </form>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function P4CSourceHiddenFields({
  entryId,
  idName,
  month,
  returnPath,
  runId,
  source,
}: {
  entryId: string;
  idName: string;
  month: string;
  returnPath: string;
  runId: string;
  source: P4CSourceItem;
}) {
  return (
    <>
      <input name={idName} type="hidden" value={source.id} />
      <input name="sourceRevision" type="hidden" value={source.revision} />
      <input name="entryId" type="hidden" value={entryId} />
      <input name="month" type="hidden" value={month} />
      <input name="returnPath" type="hidden" value={returnPath} />
      <input name="runId" type="hidden" value={runId} />
    </>
  );
}

function MoneyField({ label, name, readOnly = false, value }: { label: string; name: string; readOnly?: boolean; value: number }) {
  return (
    <label className={styles.moneyField}>
      <span>{label}</span>
      <span className={styles.moneyInput}>
        <b>RM</b>
        <input defaultValue={moneyValue(value)} inputMode="decimal" name={name} pattern="\d{1,10}(?:\.\d{1,2})?" readOnly={readOnly} required />
      </span>
    </label>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function moneyValue(value: number) {
  return value.toFixed(2);
}
