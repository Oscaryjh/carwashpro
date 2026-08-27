import { randomUUID } from "node:crypto";
import Link from "next/link";
import { isProductionRuntime } from "@/lib/release/environment";
import { EmployeeProfileProtectedSubmit } from "@/components/employee-profile-protected-submit";
import { EmployeeStatutorySettingsFields } from "@/components/employee-statutory-settings-fields";
import {
  createEmployeeBankVersionAction,
  scheduleEmployeeCompensationChangeAction,
  scheduleEmployeeRecurringPayAction,
  deactivateEmployeeBankVersionAction,
  recordEmployeeLindung24ParticipationAction,
  updateEmployeeStatutoryAndTaxProfilesAction,
  updateEmployeeStatutoryProfileAction,
  updateEmployeeTaxProfileAction,
  updateEmployeePayrollWorkTargetAction,
} from "@/app/(business)/team/people/[personId]/payroll/actions";
import {
  salaryBankGroups,
  salaryBankOptions,
} from "@/lib/payroll/payment/bank-directory";
import { isPayrollBankAccountMfaEnabled } from "@/lib/payroll/payment/bank-account-security";
import {
  getPcbProfileReadiness,
  type EmployeePcbProfile,
} from "@/lib/payroll/pcb-profile";
import {
  PCB_2026_TP1_CATEGORIES,
  PCB_2026_TP3_CATEGORIES,
} from "@/lib/payroll/pcb-declarations";
import type { EmployeeBankSectionResult } from "@/lib/team/employee-profile-bank-read";
import type { EmployeeCompensationSectionResult } from "@/lib/team/employee-profile-compensation-read";
import type { EmployeePayrollNavigationResult } from "@/lib/team/employee-profile-payroll-navigation-read";
import type { EmployeePayrollSummaryResult } from "@/lib/team/employee-profile-payroll-summary-read";
import type { EmployeeStatutoryProfileResult } from "@/lib/team/employee-profile-statutory-read";
import styles from "./employee-profile-shell.module.css";
import { EmployeeProfilePayrollDialog } from "./employee-profile-payroll-dialog";
import { PayrollHighRiskMfaFields } from "./payroll-high-risk-mfa-fields";

export function EmployeeProfilePayroll({
  bank,
  bankDialogError,
  bankDialogInitiallyOpen = false,
  compensation,
  employeeName,
  navigation,
  notice,
  summary,
}: {
  bank: EmployeeBankSectionResult;
  bankDialogError?: string | null;
  bankDialogInitiallyOpen?: boolean;
  compensation: EmployeeCompensationSectionResult;
  employeeName: string;
  navigation: EmployeePayrollNavigationResult;
  notice: PayrollUpdateNoticeValue | null;
  summary: EmployeePayrollSummaryResult;
}) {
  if (
    bank.status === "NOT_FOUND" ||
    compensation.status === "NOT_FOUND"
  ) {
    return null;
  }

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <h2>Payroll &amp; bank</h2>
          <p>Salary setup, payment details and payroll records for this employee.</p>
        </div>
        <span className={styles.scopeBadge}>Protected payroll data</span>
      </section>

      {notice ? <PayrollUpdateNotice notice={notice} /> : null}

      <PayrollReadinessOverview
        bank={bank}
        compensation={compensation}
        summary={summary}
      />

      <section className={styles.payrollWorkspaceSection} id="payroll-setup">
        <div className={styles.payrollWorkspaceHeading}>
          <div>
            <p className={styles.eyebrow}>Payroll setup</p>
            <h3>Employee pay settings</h3>
            <p>These settings are used the next time a payroll draft is created or refreshed.</p>
          </div>
        </div>
        <PayrollSetupPanels
          bank={bank}
          bankDialogError={bankDialogError}
          bankDialogInitiallyOpen={bankDialogInitiallyOpen}
          compensation={compensation}
          employeeName={employeeName}
        />
      </section>

      <section className={styles.payrollWorkspaceSection}>
        <div className={styles.payrollWorkspaceHeading}>
          <div>
            <p className={styles.eyebrow}>Payroll records</p>
            <h3>Current payroll and documents</h3>
            <p>Review this month&apos;s result, previous runs and employee-visible documents.</p>
          </div>
        </div>
        <div className={styles.payrollRecordsGrid}>
          <EmployeePayrollSummary result={summary} />
          <PayrollNavigation result={navigation} />
        </div>
      </section>
    </div>
  );
}

function PayrollReadinessOverview({
  bank,
  compensation,
  summary,
}: {
  bank: EmployeeBankSectionResult;
  compensation: EmployeeCompensationSectionResult;
  summary: EmployeePayrollSummaryResult;
}) {
  const salaryReady = compensation.status === "READY" && compensation.data.baseRate !== null;
  const bankReady = bank.status === "READY" && bank.data.bank?.status === "ACTIVE";
  const statutoryIssues = summary.status === "READY"
    ? summary.data.issues.filter((issue) => /statutory|tax|epf|socso|eis|pcb/i.test(issue.message))
    : [];
  const latestRun = summary.status === "READY" ? summary.data.recentRuns[0] : null;
  const issueCount = summary.status === "READY" ? summary.data.issues.length : 0;

  return (
    <section className={styles.payrollOverview} aria-labelledby="payroll-readiness-heading">
      <div className={styles.payrollOverviewHeader}>
        <div>
          <p className={styles.eyebrow}>Payroll readiness</p>
          <h3 id="payroll-readiness-heading">
            {summary.status === "READY"
              ? payrollReadinessHeading(summary.data.readiness)
              : "Payroll readiness is unavailable"}
          </h3>
          <p>
            {summary.status === "READY"
              ? issueCount
                ? `${issueCount} item${issueCount === 1 ? "" : "s"} should be checked before final payment.`
                : "This employee has no current payroll warnings."
              : "Your current access does not include this employee's payroll readiness."}
          </p>
        </div>
        {summary.status === "READY" ? (
          <span className={styles.payrollReadinessStatus} data-status={summary.data.readiness.toLowerCase()}>
            {payrollReadinessLabel(summary.data.readiness)}
          </span>
        ) : null}
      </div>

      <div className={styles.payrollOverviewGrid}>
        <PayrollReadinessItem
          label="Salary"
          state={salaryReady ? "Configured" : compensation.status === "READY" ? "Needs setup" : "Restricted"}
          tone={salaryReady ? "ready" : "warning"}
          value={compensation.status === "READY" ? formatMoney(compensation.data.baseRate) : "Not available"}
        />
        <PayrollReadinessItem
          label="Bank account"
          state={bankReady ? "Added" : bank.status === "READY" ? "Needs setup" : "Restricted"}
          tone={bankReady ? "ready" : "warning"}
          value={bank.status === "READY" && bank.data.bank
            ? `${bank.data.bank.bankName} · ${bank.data.bank.accountNumber}`
            : "No active salary account"}
        />
        <PayrollReadinessItem
          label="Statutory & tax"
          state={statutoryIssues.length ? "Needs review" : "Open profile"}
          tone={statutoryIssues.length ? "warning" : "neutral"}
          value={statutoryIssues[0]?.message ?? "Review government contribution and tax details"}
        />
        <PayrollReadinessItem
          label="Current payroll"
          state={latestRun ? formatEnum(latestRun.status) : "Not started"}
          tone={latestRun?.status === "FINALIZED" ? "ready" : "neutral"}
          value={summary.status === "READY" ? formatMonthValue(summary.data.currentMonth) : "Not available"}
        />
      </div>

    </section>
  );
}

function PayrollReadinessItem({
  label,
  state,
  tone,
  value,
}: {
  label: string;
  state: string;
  tone: "neutral" | "ready" | "warning";
  value: string;
}) {
  return (
    <article className={styles.payrollOverviewItem} data-tone={tone}>
      <div>
        <span>{label}</span>
        <strong>{state}</strong>
      </div>
      <p>{value}</p>
    </article>
  );
}

export function EmployeeProfileStatutory({
  notice,
  profileEditHref,
  statutoryProfile,
}: {
  notice: PayrollUpdateNoticeValue | null;
  profileEditHref: string;
  statutoryProfile: EmployeeStatutoryProfileResult;
}) {
  if (statutoryProfile.status === "NOT_FOUND") return null;

  const canEditTogether =
    statutoryProfile.statutory.status === "READY" &&
    statutoryProfile.tax.status === "READY" &&
    statutoryProfile.statutory.data.canEdit &&
    statutoryProfile.tax.data.canEdit;

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <h2>Statutory &amp; tax</h2>
          <p>EPF, SOCSO, EIS, LINDUNG24 and tax submission details.</p>
        </div>
        <div className={styles.statutoryHeaderActions}>
          <span className={styles.scopeBadge}>HR access only</span>
          {canEditTogether &&
          statutoryProfile.statutory.status === "READY" &&
          statutoryProfile.tax.status === "READY" ? (
            <StatutoryAndTaxEditForm
              profileEditHref={profileEditHref}
              statutoryData={statutoryProfile.statutory.data}
              taxData={statutoryProfile.tax.data}
            />
          ) : null}
        </div>
      </section>
      {notice ? <PayrollUpdateNotice notice={notice} /> : null}
      <div className={styles.profileGrid}>
        <StatutoryPanel
          profileEditHref={profileEditHref}
          result={statutoryProfile.statutory}
          showStandaloneEdit={!canEditTogether}
        />
        <TaxPanel
          result={statutoryProfile.tax}
          showStandaloneEdit={!canEditTogether}
          statutoryResult={statutoryProfile.statutory}
        />
      </div>
    </div>
  );
}

function EmployeePayrollSummary({ result }: { result: EmployeePayrollSummaryResult }) {
  if (result.status !== "READY") return null;
  const latest = result.data.recentRuns[0];
  const issues = result.data.issues.slice(0, 5);
  return (
    <section className={styles.payrollNavigation} aria-labelledby="employee-payroll-summary-heading">
      <div className={styles.payrollNavigationHeading}>
        <div>
          <p className={styles.eyebrow}>Payroll status</p>
          <h3 id="employee-payroll-summary-heading">{formatMonthValue(result.data.currentMonth)}</h3>
          <p>
            {latest
              ? "Latest payroll result for this employee."
              : issues.length
                ? `Complete ${issues.length} item${issues.length === 1 ? "" : "s"} before final payment.`
                : "Employee details are ready for payroll."}
          </p>
        </div>
        <span>{latest ? formatEnum(latest.status) : "Not started"}</span>
      </div>
      {latest ? (
        <div className={styles.detailList}>
          <PayrollDetail label="Gross pay" value={formatMoney(String(latest.grossPay))} />
          <PayrollDetail label="Net pay" value={formatMoney(String(latest.netPay))} />
          <PayrollDetail label="Variable pay" value={formatMoney(String(latest.variablePay))} />
          <PayrollDetail label="Corrections" value={formatMoney(String(latest.corrections))} />
        </div>
      ) : null}
      {issues.length ? (
        <div className={styles.payrollStatusIssues}>
          {issues.map((issue, index) => {
            const copy = payrollIssueCopy(issue.message);
            return (
              <article data-tone={copy.tone} key={`${issue.severity}-${index}`}>
                <span aria-hidden="true">{copy.icon}</span>
                <div>
                  <strong>{copy.title}</strong>
                  <p>{copy.message}</p>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {result.data.recentRuns.length ? (
        <div className={styles.payrollNoticeActions}>
          {result.data.recentRuns.slice(0, 3).map((run) => (
            <Link href={`/team/payroll/runs/${run.id}`} key={run.id}>{formatMonth(run.periodStart.toISOString())} · {formatEnum(run.status)}</Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function payrollIssueCopy(message: string) {
  if (/bank account is not verified/i.test(message)) {
    return {
      icon: "i",
      message: "Confirm the bank name and account number before the first salary payment.",
      title: "Bank account added",
      tone: "info",
    } as const;
  }
  if (/bank/i.test(message)) {
    return {
      icon: "!",
      message,
      title: "Add bank account",
      tone: "warning",
    } as const;
  }
  if (/statutory|tax|epf|socso|eis|pcb/i.test(message)) {
    return {
      icon: "!",
      message,
      title: "Complete statutory & tax details",
      tone: "warning",
    } as const;
  }
  return {
    icon: "!",
    message,
    title: "Review payroll setup",
    tone: "warning",
  } as const;
}

type PayrollUpdateNoticeValue = {
  affectedDrafts: number | null;
  artifactCount: number | null;
  changedFields: string[];
  effectiveMonth: string | null;
  existingArtifactWarning: boolean;
  finalizedCount: number | null;
  kind: "bank" | "compensation" | "statutory" | "tax" | "work-target";
  message: string;
  newRevision: number | null;
  reviewCount: number | null;
  status: "error" | "success";
};

function PayrollUpdateNotice({ notice }: { notice: PayrollUpdateNoticeValue }) {
  const copy = payrollUpdateNoticeCopy(notice);

  return (
    <section
      className={styles.payrollUpdateNotice}
      data-status={notice.status}
      role={notice.status === "error" ? "alert" : "status"}
    >
      <div>
        <strong>{copy.title}</strong>
        <p>{copy.message}</p>
      </div>
    </section>
  );
}

function payrollUpdateNoticeCopy(notice: PayrollUpdateNoticeValue) {
  if (notice.status === "error") {
    return { title: "Update not saved", message: notice.message };
  }

  if (notice.kind === "compensation") {
    return {
      title: "Monthly pay updated",
      message: "The change will apply automatically to the next payroll.",
    };
  }
  if (notice.kind === "work-target") {
    return {
      title: "Salary work basis updated",
      message: "The change will apply automatically to the next payroll.",
    };
  }
  if (notice.kind === "bank") {
    return {
      title: "Bank details updated",
      message: "The new account will be used for the next payroll payment.",
    };
  }
  if (notice.kind === "statutory") {
    return {
      title: "Statutory details updated",
      message: "The latest details will be used for the next payroll.",
    };
  }
  return {
    title: "Tax details updated",
    message: "The latest details will be used for the next payroll.",
  };
}

function PayrollNavigation({
  result,
}: {
  result: EmployeePayrollNavigationResult;
}) {
  if (result.payslip.status !== "AVAILABLE") return null;

  return (
    <section className={styles.payrollNavigation} aria-labelledby="payroll-access-heading">
      <div className={styles.payrollNavigationHeading}>
        <div>
          <h3 id="payroll-access-heading">Payslip</h3>
          <p>Published payroll documents available to this employee.</p>
        </div>
        <span>Published</span>
      </div>
      <div className={styles.payrollActionGrid}>
        <PayslipCard state={result.payslip} />
      </div>
    </section>
  );
}

function PayslipCard({
  state,
}: {
  state: EmployeePayrollNavigationResult["payslip"];
}) {
  if (state.status !== "AVAILABLE") return null;
  return (
    <article className={styles.payrollActionCard}>
      <div>
        <p className={styles.eyebrow}>Payslip PDF</p>
        <h4>{formatMonth(state.periodStart)} published payslip</h4>
        <p>Available for download · frozen finalized snapshot · available to the employee</p>
      </div>
      <a
        className={styles.payrollActionLink}
        href={state.href}
        rel="noopener noreferrer"
        target="_blank"
      >
        Download PDF
      </a>
    </article>
  );
}

function PayrollSetupPanels({
  bank,
  bankDialogError,
  bankDialogInitiallyOpen,
  compensation,
  employeeName,
}: {
  bank: EmployeeBankSectionResult;
  bankDialogError?: string | null;
  bankDialogInitiallyOpen: boolean;
  compensation: Exclude<EmployeeCompensationSectionResult, { status: "NOT_FOUND" }>;
  employeeName: string;
}) {
  if (compensation.status === "ACCESS_DENIED") {
    if (compensation.reason === "CAPABILITY") {
      return (
        <div className={styles.payrollSetupColumns}>
          <div className={styles.payrollSetupColumn}>
            <BankPanel
              dialogError={bankDialogError}
              initiallyOpen={bankDialogInitiallyOpen}
              employeeName={employeeName}
              result={bank}
            />
          </div>
        </div>
      );
    }

    return (
      <div className={styles.payrollSetupColumns}>
        <div className={styles.payrollSetupColumn}>
          <RestrictedPanel
            eyebrow="Pay setup"
            title="Compensation access is restricted"
            message={
              compensation.reason === "WHOLE_BUSINESS_SCOPE"
                ? "Payroll compensation requires all-branch access. No salary or work-target data was loaded."
                : "You do not have permission to view employee compensation. No salary or work-target data was loaded."
            }
          />
        </div>
        <div className={styles.payrollSetupColumn}>
          <BankPanel
            dialogError={bankDialogError}
            initiallyOpen={bankDialogInitiallyOpen}
            employeeName={employeeName}
            result={bank}
          />
        </div>
      </div>
    );
  }

  const { data } = compensation;

  return (
    <div className={styles.payrollSetupGrid}>
      <CompensationCard data={data} />
      <RecurringPayPanel data={data} />
      <WorkTargetCard data={data} />
      <BankPanel
        dialogError={bankDialogError}
        initiallyOpen={bankDialogInitiallyOpen}
        employeeName={employeeName}
        result={bank}
      />
    </div>
  );
}

function CompensationCard({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  return (
    <section className={`${styles.profilePanel} ${styles.payrollSetupCard}`}>
      <div className={styles.panelHeading}>
        <div>
          <h3>Salary</h3>
          <p>Base pay for future payroll drafts.</p>
        </div>
        <span data-tone={data.baseRate === null ? "warning" : "ready"}>
          {data.baseRate === null ? "Incomplete" : "Configured"}
        </span>
      </div>

      <div className={styles.payrollPrimaryMetric}>
        <div>
          <span>{baseRateLabel(data.payBasis)}</span>
          <strong>{formatMoney(data.baseRate)}</strong>
        </div>
        <span>{formatEnum(data.payBasis)}</span>
      </div>

      <div className={styles.detailList}>
        <PayrollDetail label="Currency" value="MYR" />
        <PayrollDetail
          label="Effective payroll month"
          value={
            data.effectiveFromMonth
              ? formatMonthValue(data.effectiveFromMonth)
              : "Legacy current setup"
          }
        />
      </div>

      {data.nextScheduledCompensation ? (
        <div className={styles.scheduledChange}>
          <strong>
            Scheduled for {formatMonthValue(data.nextScheduledCompensation.effectiveFromMonth)}
          </strong>
          <span>
            {formatEnum(data.nextScheduledCompensation.payBasis)} ·{" "}
            {formatMoney(data.nextScheduledCompensation.baseRate)}
          </span>
        </div>
      ) : null}

      {data.compensationHistory.length ? (
        <details className={styles.payrollTechnicalDetails}>
          <summary>
            Salary history ({data.compensationHistory.length})
          </summary>
          <div className={styles.detailList}>
            {data.compensationHistory.slice(0, 6).map((version) => (
              <PayrollDetail
                key={`${version.effectiveFromMonth}-${version.baseRate}-${version.reasonType}`}
                label={formatMonthValue(version.effectiveFromMonth)}
                value={`${formatEnum(version.payBasis)} · ${formatMoney(version.baseRate)} · ${formatEnum(version.reasonType)}`}
              />
            ))}
          </div>
        </details>
      ) : null}

      <details
        className={`${styles.payrollTechnicalDetails} ${styles.payrollRuleDetails}`}
      >
        <summary>When salary changes apply</summary>
        <p>
          New salary values apply from the selected payroll month. Finalized and locked Payroll Runs retain their original compensation snapshots.
        </p>
        <p>Saving does not recalculate an existing Draft. Refresh the Draft manually when the new values should be used.</p>
        <p>Change reason and revision history remain available for audit.</p>
      </details>
      {data.canEdit ? <CompensationEditForm data={data} /> : null}
    </section>
  );
}

function WorkTargetCard({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  const plannedSpanMinutes =
    data.normalWorkMinutesPerDay + data.targetBreakMinutes;

  return (
    <section className={`${styles.profilePanel} ${styles.payrollSetupCard}`}>
      <div className={styles.panelHeading}>
        <div>
          <h3>Salary work basis</h3>
          <p>Paid-day assumptions used when payroll calculates this employee.</p>
        </div>
        <span data-tone="neutral">Current policy</span>
      </div>
      <div className={styles.payrollMetricGrid}>
        <PayrollSetupMetric
          label="Working days / month"
          value={`${data.workingDaysPerMonth} days`}
        />
        <PayrollSetupMetric
          label="Paid work / day"
          value={formatMinutes(data.normalWorkMinutesPerDay)}
        />
        <PayrollSetupMetric
          label="Expected break / day"
          value={formatMinutes(data.targetBreakMinutes)}
        />
        <PayrollSetupMetric
          label="Planned span / day"
          value={formatMinutes(plannedSpanMinutes)}
        />
      </div>
      <details
        className={`${styles.payrollTechnicalDetails} ${styles.payrollRuleDetails}`}
      >
        <summary>Rule source</summary>
        <p>
          Paid hours: {data.normalWorkPolicySource} · Break: {data.targetBreakPolicySource}
        </p>
        <p>Actual shift dates and times remain owned by the published Roster.</p>
      </details>
      {data.canEdit ? <WorkTargetEditForm data={data} /> : null}
    </section>
  );
}

function RecurringPayPanel({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  const earnings = data.recurringPayComponents.filter(
    (component) => component.type === "EARNING",
  );
  const deductions = data.recurringPayComponents.filter(
    (component) => component.type === "DEDUCTION",
  );
  return (
    <section className={`${styles.profilePanel} ${styles.payrollSetupCard}`}>
      <div className={styles.panelHeading}>
        <div>
          <h3>Monthly pay items</h3>
          <p>Fixed allowances and deductions added every month.</p>
        </div>
        <span data-tone={data.recurringPayComponents.length ? "ready" : "neutral"}>
          {data.recurringPayComponents.length ? "Configured" : "None"}
        </span>
      </div>
      {data.recurringPayComponents.length ? (
        <>
          <RecurringPayList components={earnings} title="Monthly additions" />
          <RecurringPayList components={deductions} title="Monthly deductions" />
        </>
      ) : (
        <div className={styles.profileEmpty}>
          <strong>No recurring pay items</strong>
          <p>Add a fixed monthly allowance or deduction only when this employee needs one.</p>
        </div>
      )}
      <details className={styles.payrollTechnicalDetails}>
        <summary>What can be added here</summary>
        <p>EPF, SOCSO, EIS, PCB and dynamic commission are calculated elsewhere. Existing Payroll Runs never change automatically.</p>
      </details>
      {data.canEdit ? (
        <>
          <RecurringPayCreateForm data={data} />
          {data.recurringPayComponents
            .filter((component) => component.state !== "ENDED")
            .map((component) => (
              <RecurringPayChangeForm
                component={component}
                currentPayrollMonth={data.currentPayrollMonth}
                expectedRevision={data.recurringPayRevision}
                key={component.id}
                membershipId={data.id}
              />
            ))}
        </>
      ) : null}
    </section>
  );
}

function RecurringPayList({
  components,
  title,
}: {
  components: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"]["recurringPayComponents"];
  title: string;
}) {
  return (
    <div className={styles.detailList}>
      <PayrollDetail
        label={title}
        value={components.length ? `${components.length} configured` : "None configured"}
      />
      {components.map((component) => (
        <PayrollDetail
          key={component.id}
          label={recurringPayItemName(component.name)}
          value={recurringPayDisplay(component)}
        />
      ))}
    </div>
  );
}

function RecurringPayCreateForm({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Add a monthly allowance or deduction for this employee."
      dialogId={`recurring-pay-create-${data.id}`}
      label="Add monthly item"
      title="Add monthly item"
      variant="button"
    >
      <form action={scheduleEmployeeRecurringPayAction} className={styles.payrollEditForm}>
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="componentId" type="hidden" value="" />
        <input name="expectedRevision" type="hidden" value={data.recurringPayRevision} />
        <input name="membershipId" type="hidden" value={data.id} />
        <input name="operation" type="hidden" value="SET" />
        <div className={styles.payrollFormGrid}>
          <label>
            <span>Monthly item type</span>
            <select name="type">
              <option value="EARNING">Monthly allowance</option>
              <option value="DEDUCTION">Monthly deduction</option>
            </select>
          </label>
          <label>
            <span>Item name</span>
            <input maxLength={120} name="name" placeholder="e.g. Transport allowance" required />
          </label>
          <label>
            <span>Amount (RM / month)</span>
            <input inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" />
          </label>
          <label>
            <span>Effective payroll month</span>
            <input defaultValue={data.currentPayrollMonth} min={data.currentPayrollMonth} name="effectiveFromMonth" required type="month" />
          </label>
        </div>
        <DraftImpactWarning count={data.affectedDrafts} />
        <button type="submit">Add monthly item</button>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function RecurringPayChangeForm({
  component,
  currentPayrollMonth,
  expectedRevision,
  membershipId,
}: {
  component: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"]["recurringPayComponents"][number];
  currentPayrollMonth: string;
  expectedRevision: number;
  membershipId: string;
}) {
  return (
    <details className={styles.payrollEditDisclosure}>
      <summary>Change or end {component.name}</summary>
      <form action={scheduleEmployeeRecurringPayAction} className={styles.payrollEditForm}>
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="componentId" type="hidden" value={component.id} />
        <input name="expectedRevision" type="hidden" value={expectedRevision} />
        <input name="membershipId" type="hidden" value={membershipId} />
        <input name="code" type="hidden" value={component.code} />
        <input name="type" type="hidden" value={component.type} />
        <div className={styles.payrollFormGrid}>
          <label>
            <span>Action</span>
            <select name="operation">
              <option value="SET">Schedule amount</option>
              <option value="END">End component</option>
            </select>
          </label>
          <label>
            <span>Item name</span>
            <input defaultValue={component.name} maxLength={120} name="name" required />
          </label>
          <label>
            <span>Amount (RM / month)</span>
            <input defaultValue={component.amount ?? component.nextChange?.amount ?? "0.01"} inputMode="decimal" min="0.01" name="amount" required step="0.01" type="number" />
          </label>
          <label>
            <span>Effective payroll month</span>
            <input defaultValue={currentPayrollMonth} min={currentPayrollMonth} name="effectiveFromMonth" required type="month" />
          </label>
        </div>
        <button type="submit">Save recurring pay change</button>
      </form>
    </details>
  );
}

function recurringPayDisplay(
  component: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"]["recurringPayComponents"][number],
) {
  const amount = component.amount === null
    ? component.state === "SCHEDULED" ? "Scheduled to end" : "Ended"
    : `${formatMoney(component.amount)} / month`;
  const starts = formatMonthValue(component.effectiveFromMonth);
  if (component.state === "SCHEDULED") return `${amount} from ${starts}`;
  if (!component.nextChange) return `${amount} · From ${starts}`;

  const nextMonth = formatMonthValue(component.nextChange.effectiveFromMonth);
  const currentThrough = formatMonthValue(
    previousPayrollMonth(component.nextChange.effectiveFromMonth),
  );
  if (component.nextChange.amount === null) {
    return `${amount} · Through ${currentThrough} · Ends before ${nextMonth} payroll`;
  }
  return `${amount} · Through ${currentThrough} · New rate ${formatMoney(component.nextChange.amount)} from ${nextMonth}`;
}

function previousPayrollMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function recurringPayItemName(name: string) {
  return name.trim().toLowerCase() === "transport fee"
    ? "Transport allowance"
    : name;
}

function CompensationEditForm({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Update this employee's pay basis and base rate for a future payroll month."
      dialogId={`compensation-edit-${data.id}`}
      label="Edit salary"
      title="Edit salary"
      variant="button"
    >
      <form action={scheduleEmployeeCompensationChangeAction} className={styles.payrollEditForm}>
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="expectedRevision" type="hidden" value={data.compensationRevision} />
        <input name="membershipId" type="hidden" value={data.id} />
        <div className={styles.payrollFormGrid}>
          <label>
            <span>Effective payroll month</span>
            <input
              defaultValue={data.currentPayrollMonth}
              min={data.currentPayrollMonth}
              name="effectiveFromMonth"
              required
              type="month"
            />
          </label>
          <label>
            <span>Pay basis</span>
            <select defaultValue={data.payBasis} name="payBasis">
              <option value="MONTHLY">Monthly salary</option>
              <option value="DAILY">Daily rate</option>
              <option value="HOURLY">Hourly rate</option>
            </select>
          </label>
          <label>
            <span>Base rate (RM)</span>
            <input
              defaultValue={data.baseRate ?? ""}
              inputMode="decimal"
              min="0"
              name="baseRate"
              required
              step="0.01"
              type="number"
            />
          </label>
        </div>
        <DraftImpactWarning count={data.affectedDrafts} />
        <button type="submit">Save salary</button>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function WorkTargetEditForm({
  data,
}: {
  data: Extract<EmployeeCompensationSectionResult, { status: "READY" }>["data"];
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Set the paid-day basis payroll uses for this employee. Actual shifts still come from Roster."
      dialogId={`work-target-edit-${data.id}`}
      label="Edit salary work basis"
      title="Edit salary work basis"
      variant="button"
    >
      <form action={updateEmployeePayrollWorkTargetAction} className={styles.payrollEditForm}>
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="expectedRevision" type="hidden" value={data.workTargetRevision} />
        <input name="membershipId" type="hidden" value={data.id} />
        <div className={styles.payrollFormGrid}>
          <label>
            <span>Working days / month</span>
            <input
              defaultValue={data.workingDaysPolicySource === "Employee profile" ? data.workingDaysPerMonth : ""}
              max="31"
              min="1"
              name="workingDaysPerMonth"
              placeholder="Use company default"
              step="1"
              type="number"
            />
          </label>
          <label>
            <span>Paid work minutes / day</span>
            <input
              defaultValue={data.normalWorkPolicySource === "Employee profile" ? data.normalWorkMinutesPerDay : ""}
              max="1440"
              min="1"
              name="normalWorkMinutesPerDay"
              placeholder="Use company fallback"
              step="1"
              type="number"
            />
          </label>
          <label>
            <span>Expected break minutes / day</span>
            <input
              defaultValue={data.targetBreakPolicySource === "Employee profile" ? data.targetBreakMinutes : ""}
              max="1440"
              min="1"
              name="targetBreakMinutes"
              placeholder="Use company fallback"
              step="1"
              type="number"
            />
          </label>
        </div>
        <p className={styles.formHint}>
          Leave a field blank to use the company default.
        </p>
        <DraftImpactWarning count={data.affectedDrafts} />
        <button type="submit">Save salary work basis</button>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function DraftImpactWarning({ count }: { count: number }) {
  if (!count) {
    return (
      <div className={styles.draftImpactNotice}>
        <strong>Applies to the next payroll</strong>
        <span>Changes will be applied automatically.</span>
      </div>
    );
  }

  return (
    <div className={styles.draftImpactWarning}>
      <strong>
        {count === 1
          ? "1 payroll draft needs refreshing"
          : `${count} payroll drafts need refreshing`}
      </strong>
      <span>
        After saving, refresh the current payroll draft to use this change. Refreshing may remove
        manual payroll adjustments.
      </span>
    </div>
  );
}

function StatutoryPanel({
  profileEditHref,
  result,
  showStandaloneEdit,
}: {
  profileEditHref: string;
  result: Extract<
    EmployeeStatutoryProfileResult,
    { status: "READY" }
  >["statutory"];
  showStandaloneEdit: boolean;
}) {
  if (result.status === "ACCESS_DENIED") {
    if (result.reason === "CAPABILITY") return null;

    return (
      <RestrictedPanel
        eyebrow="Statutory contributions"
        title="Statutory profile is restricted"
        message={restrictedMessage(result.reason, "statutory contribution")}
      />
    );
  }

  const { data } = result;
  const currentLindung24 = data.lindung24ParticipationHistory.at(-1) ?? null;
  return (
    <section className={styles.profilePanel}>
      <div className={styles.panelHeading}>
        <div>
          <h3>Statutory contributions</h3>
          <p>Current participation settings and membership identifiers.</p>
        </div>
        <span>{statutorySetupStatus(data)}</span>
      </div>
      <div className={styles.detailList}>
        <PayrollDetail
          label="Statutory nationality"
          value={formatNullableEnum(data.nationality)}
        />
        <PayrollDetail
          label="EPF / KWSP"
          value={formatParticipation(data.epfEnabled)}
        />
        <PayrollDetail
          label="KWSP member number"
          value={formatEnrollmentValue(
            data.epfEnabled,
            data.epfMemberNumber ?? data.epfMemberNumberMasked,
          )}
        />
        <PayrollDetail
          label="EPF member before Aug 1998"
          value={
            data.epfEnabled
              ? data.epfMemberBeforeAug1998
                ? "Yes"
                : "No"
              : "Not applicable"
          }
        />
        <PayrollDetail
          label="SOCSO"
          value={formatParticipation(data.socsoEnabled)}
        />
        <PayrollDetail
          label="SOCSO category"
          value={
            data.socsoEnabled
              ? formatSocsoCategory(data.socsoCategory)
              : "Not applicable"
          }
        />
        <PayrollDetail
          label="SOCSO member number"
          value={formatEnrollmentValue(
            data.socsoEnabled,
            data.socsoMemberNumber ?? data.socsoMemberNumberMasked,
          )}
        />
        <PayrollDetail
          label="EIS"
          value={formatParticipation(data.eisEnabled)}
        />
        <PayrollDetail
          label="Previously contributed to EIS"
          value={
            data.eisEnabled
              ? data.eisPreviouslyContributed
                ? "Yes"
                : "No"
              : "Not applicable"
          }
        />
      </div>
      <section
        className={styles.lindungCoverageCard}
        data-state={lindung24CoverageState(currentLindung24, data.lindung24OptIn)}
      >
        <div className={styles.lindungCoverageHeading}>
          <div>
            <span className={styles.lindungCoverageIcon}>L24</span>
            <div>
              <h4>LINDUNG 24 coverage</h4>
              <p>{lindung24CoverageDescription(currentLindung24, data.lindung24OptIn)}</p>
            </div>
          </div>
          <span>{lindung24CoverageLabel(currentLindung24, data.lindung24OptIn)}</span>
        </div>
        {currentLindung24 ? (
          <div className={styles.lindungCoverageFacts}>
            <div>
              <span>Employee classification</span>
              <strong>{lindung24EmployeeClassification(data.nationality)}</strong>
            </div>
            <div>
              <span>Participation requirement</span>
              <strong>{lindung24ParticipationRequirement(data.nationality)}</strong>
            </div>
            <div>
              <span>Applies from</span>
              <strong>{formatMonth(currentLindung24.effectiveFromMonth)}</strong>
            </div>
            <div>
              <span>Payroll employer</span>
              <strong>{formatLindung24Employer(currentLindung24.selectedEmployer)}</strong>
            </div>
            <div>
              <span>Act 4 coverage</span>
              <strong>{currentLindung24.act4Covered ? "Covered" : "Not covered"}</strong>
            </div>
            <div>
              <span>Evidence nature</span>
              <strong>
                {currentLindung24.evidenceNature === "SYNTHETIC_TESTING"
                  ? "Testing fixture"
                  : "Official / real evidence"}
              </strong>
            </div>
            <div>
              <span>Official export</span>
              <strong>
                {currentLindung24.officialExportEligible
                  ? "Eligible"
                  : "Disabled for this fixture"}
              </strong>
            </div>
            <div>
              <span>Evidence source</span>
              <strong>{formatLindung24Source(currentLindung24.sourceType)}</strong>
            </div>
            <div>
              <span>Evidence reference</span>
              <strong>{currentLindung24.sourceReference ?? "Not applicable to testing fixture"}</strong>
            </div>
            <div>
              <span>Official acknowledgement</span>
              <strong>{formatLindung24Acknowledgement(currentLindung24.officialSubmittedAt)}</strong>
            </div>
          </div>
        ) : (
          <div className={styles.lindungCoverageFacts}>
            <div>
              <span>Employee classification</span>
              <strong>{lindung24EmployeeClassification(data.nationality)}</strong>
            </div>
            <div>
              <span>Participation requirement</span>
              <strong>{lindung24ParticipationRequirement(data.nationality)}</strong>
            </div>
          </div>
        )}
        {data.lindung24ParticipationHistory.length ? (
          <details className={styles.lindungTechnicalDetails}>
            <summary>History &amp; technical details</summary>
            <div>
              {data.lindung24ParticipationHistory.map((record) => (
                <p key={`${record.effectiveFromMonth}:${record.revision}`}>
                  <strong>{formatMonth(record.effectiveFromMonth)}</strong>
                  <span>
                    {formatLindung24Status(record.status)} · {formatNullableEnum(record.employerContext)} · revision {record.revision}
                    {record.evidenceNature === "SYNTHETIC_TESTING" ? " · testing fixture" : ""}
                  </span>
                </p>
              ))}
            </div>
          </details>
        ) : null}
        {data.canEdit ? <Lindung24ParticipationForm data={data} /> : null}
      </section>
      <p className={styles.policyNote}>
        Full identifiers are visible to authorized HR editors. Contribution
        amounts are calculated and reviewed in individual Payroll Runs.
      </p>
      {data.canEdit && showStandaloneEdit ? (
        <StatutoryEditForm data={data} profileEditHref={profileEditHref} />
      ) : null}
    </section>
  );
}

function TaxPanel({
  result,
  showStandaloneEdit,
  statutoryResult,
}: {
  result: Extract<
    EmployeeStatutoryProfileResult,
    { status: "READY" }
  >["tax"];
  showStandaloneEdit: boolean;
  statutoryResult: Extract<
    EmployeeStatutoryProfileResult,
    { status: "READY" }
  >["statutory"];
}) {
  if (result.status === "ACCESS_DENIED") {
    if (result.reason === "CAPABILITY") return null;

    return (
      <RestrictedPanel
        eyebrow="Tax & submission identity"
        title="Tax profile is restricted"
        message={restrictedMessage(result.reason, "tax and submission identity")}
      />
    );
  }

  const { data } = result;
  return (
    <section className={styles.profilePanel}>
      <div className={styles.panelHeading}>
        <div>
          <h3>Tax &amp; submission IDs</h3>
          <p>Identity values used for official payroll submissions.</p>
        </div>
        <span>{taxSetupStatus(data)}</span>
      </div>
      <div className={styles.detailList}>
        <PayrollDetail
          label="Identity type"
          value={formatNullableEnum(data.identityType)}
        />
        <PayrollDetail
          label="Identity number"
          value={
            (data.canEdit ? data.identityNumber : data.identityNumberMasked) ??
            "Not configured"
          }
        />
        <PayrollDetail
          label="LHDN country code"
          value={data.countryCode ?? "Not configured"}
        />
        <PayrollDetail
          label="Tax Identification Number (TIN)"
          value={(data.canEdit ? data.tin : data.tinMasked) ?? "Not configured"}
        />
        <PayrollDetail
          label="Profile last updated"
          value={formatDate(data.profileUpdatedAt)}
        />
      </div>
      <p className={styles.policyNote}>
        {data.canEdit
          ? "Full numbers are visible only to HR users who can edit tax details."
          : "Protected identity and tax numbers are shown in masked form."}
      </p>
      {data.canEdit && showStandaloneEdit ? (
        <TaxEditForm
          data={data}
          epfMemberNumberMasked={
            statutoryResult.status === "READY"
              ? statutoryResult.data.epfMemberNumberMasked
              : null
          }
          epfMemberNumber={
            statutoryResult.status === "READY"
              ? statutoryResult.data.epfMemberNumber
              : null
          }
          socsoMemberNumberMasked={
            statutoryResult.status === "READY"
              ? statutoryResult.data.socsoMemberNumberMasked
              : null
          }
          socsoMemberNumber={
            statutoryResult.status === "READY"
              ? statutoryResult.data.socsoMemberNumber
              : null
          }
        />
      ) : null}
    </section>
  );
}

function StatutoryAndTaxEditForm({
  profileEditHref,
  statutoryData,
  taxData,
}: {
  profileEditHref: string;
  statutoryData: Extract<
    Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["statutory"],
    { status: "READY" }
  >["data"];
  taxData: Extract<
    Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["tax"],
    { status: "READY" }
  >["data"];
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Update contributions, identity and government numbers in one place."
      dialogId={`statutory-tax-edit-${statutoryData.membershipId}`}
      eyebrow="Statutory & tax"
      label="Edit details"
      size="compact"
      title="Edit statutory & tax"
      triggerClassName={styles.compactProfileAction}
      variant="button"
    >
      <form
        action={updateEmployeeStatutoryAndTaxProfilesAction}
        className={`${styles.payrollEditForm} ${styles.statutoryEditForm} ${styles.combinedStatutoryTaxForm}`}
      >
        <input
          name="statutoryCommandId"
          type="hidden"
          value={randomUUID()}
        />
        <input
          name="statutoryExpectedRevision"
          type="hidden"
          value={statutoryData.expectedRevision}
        />
        <input name="taxCommandId" type="hidden" value={randomUUID()} />
        <input
          name="taxExpectedRevision"
          type="hidden"
          value={taxData.expectedRevision}
        />
        <input
          name="membershipId"
          type="hidden"
          value={statutoryData.membershipId}
        />
        <input
          name="lindung24OptIn"
          type="hidden"
          value={statutoryData.lindung24OptIn ? "on" : "off"}
        />

        <div className={styles.combinedStatutoryTaxHeading}>
          <h3>Contributions</h3>
          <p>Choose the statutory schemes payroll should calculate.</p>
        </div>
        <EmployeeStatutorySettingsFields
          eisEnabled={statutoryData.eisEnabled}
          eisPreviouslyContributed={statutoryData.eisPreviouslyContributed}
          employeeAge={statutoryData.employeeAge}
          epfEnabled={statutoryData.epfEnabled}
          epfMemberBeforeAug1998={statutoryData.epfMemberBeforeAug1998}
          nationality={statutoryData.nationality}
          profileEditHref={profileEditHref}
          socsoCategory={statutoryData.socsoCategory}
          socsoEnabled={statutoryData.socsoEnabled}
        />

        <div className={styles.combinedStatutoryTaxHeading}>
          <h3>Tax &amp; government IDs</h3>
          <p>Maintain the identity and account numbers used for submissions.</p>
        </div>
        <section className={styles.taxFormSection}>
          <div className={styles.taxFormSectionHeading}>
            <div>
              <h3>Personal identity</h3>
              <p>Used to identify this employee in official submissions.</p>
            </div>
          </div>
          <div className={styles.payrollFormGrid}>
            <label>
              <span>ID type</span>
              <select
                defaultValue={taxData.identityType ?? ""}
                name="statutoryIdentityType"
              >
                <option value="">Not set</option>
                <option value="NEW_IC">MyKad / New IC</option>
                <option value="OLD_IC">Old IC</option>
                <option value="PASSPORT">Passport</option>
                <option value="OTHER">Other document</option>
              </select>
            </label>
            <TaxIdentifierField
              clearName="clearIdentity"
              currentMasked={taxData.identityNumberMasked}
              currentValue={taxData.identityNumber}
              label="ID number"
              name="statutoryIdentityNumber"
            />
            <input name="statutoryCountryCode" type="hidden" value="MY" />
          </div>
        </section>

        <section className={styles.taxFormSection}>
          <div className={styles.taxFormSectionHeading}>
            <div>
              <h3>Government account numbers</h3>
              <p>Only enter a new number when it changes.</p>
            </div>
          </div>
          <div className={styles.payrollFormGrid}>
            <TaxIdentifierField
              clearName="clearTaxIdentificationNumber"
              currentMasked={taxData.tinMasked}
              currentValue={taxData.tin}
              label="Tax Identification Number (TIN)"
              name="taxIdentificationNumber"
            />
            <TaxIdentifierField
              clearName="clearEpfMemberNumber"
              currentMasked={statutoryData.epfMemberNumberMasked}
              currentValue={statutoryData.epfMemberNumber}
              label="EPF / KWSP number"
              name="epfMemberNumber"
            />
            <TaxIdentifierField
              clearName="clearSocsoMemberNumber"
              currentMasked={statutoryData.socsoMemberNumberMasked}
              currentValue={statutoryData.socsoMemberNumber}
              label="SOCSO / PERKESO number"
              name="socsoMemberNumber"
            />
          </div>
        </section>

        <PcbProfileFields profile={taxData.pcbProfile} />

        <StatutoryImpactNotice impact={statutoryData.impact} />
        <EmployeeProfileProtectedSubmit>
          Save statutory &amp; tax
        </EmployeeProfileProtectedSubmit>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function StatutoryEditForm({
  data,
  profileEditHref,
}: {
  data: Extract<
    Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["statutory"],
    { status: "READY" }
  >["data"];
  profileEditHref: string;
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Manage EPF, SOCSO and EIS settings for this employee."
      dialogId={`statutory-contributions-edit-${data.membershipId}`}
      eyebrow="Statutory & tax"
      label="Edit statutory contributions"
      size="compact"
      title="Edit statutory contributions"
      variant="button"
    >
      <form
        action={updateEmployeeStatutoryProfileAction}
        className={`${styles.payrollEditForm} ${styles.statutoryEditForm}`}
      >
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="expectedRevision" type="hidden" value={data.expectedRevision} />
        <input name="membershipId" type="hidden" value={data.membershipId} />
        <input
          name="reasonNote"
          type="hidden"
          value="Statutory contribution settings updated from the employee profile."
        />
        <input name="reasonType" type="hidden" value="STATUTORY_CORRECTION" />
        <input
          name="lindung24OptIn"
          type="hidden"
          value={data.lindung24OptIn ? "on" : "off"}
        />
        <EmployeeStatutorySettingsFields
          eisEnabled={data.eisEnabled}
          eisPreviouslyContributed={data.eisPreviouslyContributed}
          employeeAge={data.employeeAge}
          epfEnabled={data.epfEnabled}
          epfMemberBeforeAug1998={data.epfMemberBeforeAug1998}
          nationality={data.nationality}
          profileEditHref={profileEditHref}
          socsoCategory={data.socsoCategory}
          socsoEnabled={data.socsoEnabled}
        />

        <StatutoryImpactNotice impact={data.impact} />
        <div className={styles.statutoryDialogActions}>
          <button type="submit">Save changes</button>
        </div>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function Lindung24ParticipationForm({
  data,
}: {
  data: Extract<
    Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["statutory"],
    { status: "READY" }
  >["data"];
}) {
  const isForeign = data.nationality === "NON_MALAYSIAN";
  const hasClassification = Boolean(data.nationality);
  const syntheticFixtureAvailable = !isProductionRuntime();
  return (
    <EmployeeProfilePayrollDialog
      description={
        isForeign
          ? "Foreign workers are mandatory when the official eligibility evidence is complete."
          : "Local participation is voluntary. Record participation or official opt-out evidence."
      }
      dialogId={`lindung24-participation-${data.membershipId}`}
      eyebrow="Statutory & tax"
      label="Edit coverage"
      size="compact"
      title="Edit LINDUNG 24 coverage"
      triggerClassName={styles.compactProfileAction}
      variant="button"
    >
      <form action={recordEmployeeLindung24ParticipationAction} className={styles.payrollEditForm}>
        <input name="expectedRevision" type="hidden" value={data.lindung24ExpectedRevision} />
        <input name="membershipId" type="hidden" value={data.membershipId} />
        <div className={styles.payrollFormGrid}>
          <label>
            <span>Evidence nature</span>
            <select defaultValue="REAL" name="evidenceNature" required>
              <option value="REAL">Official / real evidence</option>
              {syntheticFixtureAvailable ? (
                <option value="SYNTHETIC_TESTING">
                  Non-production payroll &amp; payslip fixture
                </option>
              ) : null}
            </select>
            <small>Testing fixtures can never be officially exported or submitted.</small>
          </label>
          {syntheticFixtureAvailable ? (
            <>
              <label>
                <span>Fixture environment</span>
                <select defaultValue="TESTING" name="evidenceEnvironment">
                  <option value="TESTING">Railway Testing</option>
                  <option value="LOCAL">Local development</option>
                </select>
              </label>
              <input name="fixturePurpose" type="hidden" value="PAYROLL_PAYSLIP_UAT" />
              <label>
                <span>Fixture statutory nationality</span>
                <select defaultValue={data.nationality ?? ""} name="statutoryNationalitySnapshot">
                  <option value="">Select for a testing fixture</option>
                  <option value="MALAYSIAN">Malaysian</option>
                  <option value="PERMANENT_RESIDENT">Permanent resident</option>
                  <option value="NON_MALAYSIAN">Non-Malaysian</option>
                </select>
                <small>This snapshot does not change the employee profile.</small>
              </label>
            </>
          ) : null}
          <label>
            <span>Coverage status</span>
            <select name="status" required>
              {!hasClassification ? <option value="">Set statutory nationality first</option> : null}
              {isForeign ? <option value="MANDATORY">Mandatory foreign-worker coverage</option> : null}
              {hasClassification && !isForeign ? (
                <>
                  <option value="DEFAULT_PARTICIPATING">Participating under transition default</option>
                  <option value="VOLUNTARY_OPT_IN">Employee joined voluntarily</option>
                  <option value="VOLUNTARY_OPT_OUT">Employee opted out with evidence</option>
                </>
              ) : null}
            </select>
          </label>
          <label>
            <span>Applies from</span>
            <input name="effectiveFromMonth" required type="month" />
          </label>
          <label>
            <span>Act 4 coverage</span>
            <select name="act4Covered" required>
              <option value="true">Covered by Act 4</option>
              <option value="false">Not covered by Act 4</option>
            </select>
          </label>
          <label>
            <span>Employer arrangement</span>
            <select name="employerContext" required>
              <option value="SINGLE_EMPLOYER">One employer</option>
              <option value="MULTIPLE_EMPLOYER">More than one employer</option>
            </select>
          </label>
          <label>
            <span>Payroll employer</span>
            <select name="selectedEmployer" required>
              <option value="CURRENT_BUSINESS">This business</option>
              <option value="OTHER_EMPLOYER">Another employer</option>
              <option value="PERKESO_SELECTION_PENDING">Waiting for PERKESO confirmation</option>
            </select>
          </label>
          <label>
            <span>How was this confirmed?</span>
            <select name="sourceType">
              <option value="">Not applicable to a testing fixture</option>
              <option value="OFFICIAL_TRANSITION">PERKESO official record</option>
              <option value="EMPLOYEE_OPT_IN">Employee confirmed joining</option>
              <option value="EMPLOYEE_OPT_OUT">Employee confirmed opting out</option>
              <option value="PERKESO_EMPLOYER_SELECTION">PERKESO selected the employer</option>
              <option value="EMPLOYMENT_CHANGE">Employment details changed</option>
              <option value="LEGACY_REVIEW">Existing record needs review</option>
            </select>
          </label>
          <label>
            <span>Official acknowledgement date</span>
            <input name="officialSubmittedAt" type="date" />
            <small>Required for voluntary join or opt-out evidence.</small>
          </label>
          <label>
            <span>Evidence reference</span>
            <input
              name="sourceReference"
              placeholder="PERKESO record, notice or acknowledgement reference"
              type="text"
            />
          </label>
          <label>
            <span>HR record note</span>
            <textarea
              name="reason"
              placeholder="Briefly record what HR verified"
              required
              rows={3}
            />
          </label>
        </div>
        <p className={styles.policyNote}>
          Saving updates this employee and automatically refreshes any eligible Draft payroll.
        </p>
        <button type="submit">Save participation</button>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function TaxEditForm({
  data,
  epfMemberNumber,
  epfMemberNumberMasked,
  socsoMemberNumber,
  socsoMemberNumberMasked,
}: {
  data: Extract<
    Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["tax"],
    { status: "READY" }
  >["data"];
  epfMemberNumber: string | null;
  epfMemberNumberMasked: string | null;
  socsoMemberNumber: string | null;
  socsoMemberNumberMasked: string | null;
}) {
  return (
    <EmployeeProfilePayrollDialog
      description="Update the employee's identity, LHDN, EPF and SOCSO numbers."
      dialogId={`tax-submission-identity-edit-${data.membershipId}`}
      eyebrow="Statutory & tax"
      label="Edit tax details"
      size="compact"
      title="Tax & government IDs"
      variant="button"
    >
      <form
        action={updateEmployeeTaxProfileAction}
        className={`${styles.payrollEditForm} ${styles.taxEditForm}`}
      >
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="expectedRevision" type="hidden" value={data.expectedRevision} />
        <input name="membershipId" type="hidden" value={data.membershipId} />
        <input name="reasonType" type="hidden" value="TAX_INFORMATION_UPDATE" />
        <input
          name="reasonNote"
          type="hidden"
          value="Tax and government IDs updated from the employee profile."
        />

        <section className={styles.taxFormSection}>
          <div className={styles.taxFormSectionHeading}>
            <span>1</span>
            <div>
              <h3>Personal identity</h3>
              <p>Used to identify this employee in official submissions.</p>
            </div>
          </div>
          <div className={styles.payrollFormGrid}>
            <label>
              <span>ID type</span>
              <select defaultValue={data.identityType ?? ""} name="statutoryIdentityType">
                <option value="">Not set</option>
                <option value="NEW_IC">MyKad / New IC</option>
                <option value="OLD_IC">Old IC</option>
                <option value="PASSPORT">Passport</option>
                <option value="OTHER">Other document</option>
              </select>
            </label>
            <TaxIdentifierField
              clearName="clearIdentity"
              currentMasked={data.identityNumberMasked}
              currentValue={data.identityNumber}
              label="ID number"
              name="statutoryIdentityNumber"
            />
            <input name="statutoryCountryCode" type="hidden" value="MY" />
          </div>
        </section>

        <section className={styles.taxFormSection}>
          <div className={styles.taxFormSectionHeading}>
            <span>2</span>
            <div>
              <h3>Government account numbers</h3>
              <p>Only enter a new number when it changes.</p>
            </div>
          </div>
          <div className={styles.payrollFormGrid}>
            <TaxIdentifierField
              clearName="clearTaxIdentificationNumber"
              currentMasked={data.tinMasked}
              currentValue={data.tin}
              label="Tax Identification Number (TIN)"
              name="taxIdentificationNumber"
            />
            <TaxIdentifierField
              clearName="clearEpfMemberNumber"
              currentMasked={epfMemberNumberMasked}
              currentValue={epfMemberNumber}
              label="EPF / KWSP number"
              name="epfMemberNumber"
            />
            <TaxIdentifierField
              clearName="clearSocsoMemberNumber"
              currentMasked={socsoMemberNumberMasked}
              currentValue={socsoMemberNumber}
              label="SOCSO / PERKESO number"
              name="socsoMemberNumber"
            />
          </div>
        </section>

        <PcbProfileFields profile={data.pcbProfile} />

        <p className={styles.taxProtectionNote}>
          These numbers are visible only to authorized HR users.
        </p>
        <EmployeeProfileProtectedSubmit>
          Save tax details
        </EmployeeProfileProtectedSubmit>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function PcbProfileFields({ profile }: { profile: EmployeePcbProfile | null }) {
  const readiness = getPcbProfileReadiness(profile);
  const readinessLabel = readiness.status === "MISSING" ? "BLOCKED" : readiness.status.replace("_", " ");
  const money = (cents: number | undefined) => ((cents ?? 0) / 100).toFixed(2);
  const count = (key: keyof EmployeePcbProfile["children"]) =>
    profile?.children[key] ?? 0;
  const governedProfile = profile?.version === 2 || profile?.version === 3 ? profile : null;
  const structuredProfile = profile?.version === 3 ? profile : null;
  const declaredAmount = (
    declaration: "tp1Declaration" | "tp3Declaration",
    code: string,
  ) => money(
    structuredProfile?.[declaration].entries.find((entry) => entry.categoryCode === code)
      ?.amountCents,
  );
  const hasTp1 = governedProfile
    ? governedProfile.tp1Declaration.status === "CONFIRMED"
    : Boolean(
        (profile?.currentAllowableDeductionsCents ?? 0) +
          (profile?.currentZakatCents ?? 0),
      );
  const hasTp3 = governedProfile
    ? governedProfile.tp3Declaration.status === "CONFIRMED"
    : Boolean(
        (profile?.priorEmployerGrossRemunerationCents ?? 0) +
          (profile?.priorEmployerEpfCents ?? 0) +
          (profile?.priorEmployerPcbCents ?? 0) +
          (profile?.priorEmployerAllowableDeductionsCents ?? 0) +
          (profile?.priorEmployerZakatCents ?? 0),
      );
  const hasReligiousTravelLevy = governedProfile
    ? governedProfile.religiousTravelLevyDeclaration.status === "CONFIRMED"
    : (profile?.currentReligiousTravelLevyCents ?? 0) > 0;

  return (
    <section className={styles.taxFormSection}>
      <div className={styles.taxFormSectionHeading}>
        <div>
          <h3>Monthly tax (PCB)</h3>
          <p>Confirm the employee facts used for the 2026 monthly tax calculation.</p>
        </div>
      </div>
      <div
        className={styles.taxPcbReadiness}
        data-status={readiness.status === "READY" ? "ready" : "attention"}
      >
        <div>
          <strong>PCB profile · {readinessLabel}</strong>
          <span>
            {readiness.status === "READY"
              ? "Tax year, TP1 and TP3 declarations are ready for automatic calculation."
              : readiness.reasons.join(" ")}
          </span>
        </div>
        <small>{profile ? `Tax year ${profile.taxYear}` : "Tax facts required"}</small>
      </div>
      <label className={styles.taxPcbConfirmation}>
        <input name="pcbProfilePresent" type="hidden" value="1" />
        <input
          name="pcbProfileRevision"
          type="hidden"
          value={structuredProfile?.profileRevision ?? 0}
        />
        <input
          defaultChecked={Boolean(profile)}
          name="pcbProfileMode"
          type="checkbox"
          value="CONFIRMED"
        />
        <span>
          <strong>Use automatic PCB calculation</strong>
          <small>Only turn this on after HR has checked the details below.</small>
        </span>
      </label>
      <div className={styles.payrollFormGrid}>
        <label>
          <span>Tax year</span>
          <select defaultValue={profile?.taxYear ?? 2026} name="pcbTaxYear">
            <option value="2026">2026</option>
          </select>
        </label>
        <label>
          <span>Tax treatment</span>
          <select defaultValue={profile?.taxRegime ?? "RESIDENT_STANDARD"} name="pcbTaxRegime">
            <option value="RESIDENT_STANDARD">Malaysia tax resident</option>
            <option value="NON_RESIDENT">Non-resident</option>
            <option value="RETURNING_EXPERT_PROGRAM">Returning Expert Programme</option>
            <option value="KNOWLEDGE_WORKER">Approved knowledge worker</option>
            <option value="C_SUITE_NON_CITIZEN">Non-citizen C-suite employee</option>
          </select>
        </label>
        <label>
          <span>Family category</span>
          <select defaultValue={profile?.employeeCategory ?? "CATEGORY_1"} name="pcbEmployeeCategory">
            <option value="CATEGORY_1">Single / spouse employed</option>
            <option value="CATEGORY_2">Married, spouse not employed</option>
            <option value="CATEGORY_3">Married, separate assessment</option>
          </select>
        </label>
      </div>
      <div className={styles.taxPcbChecks}>
        <label><input defaultChecked={profile?.individualDisabled} name="pcbIndividualDisabled" type="checkbox" /> Employee has disability relief</label>
        <label><input defaultChecked={profile?.spouseDisabled} name="pcbSpouseDisabled" type="checkbox" /> Spouse has disability relief</label>
      </div>
      <details className={styles.taxPcbDetails}>
        <summary>Reliefs, previous employment and supporting declarations</summary>
        <h4>Children claimed</h4>
        <div className={styles.payrollFormGrid}>
          <PcbNumber name="pcbUnder18Full" label="Under 18 · full relief" value={count("under18Full")} />
          <PcbNumber name="pcbUnder18Half" label="Under 18 · half relief" value={count("under18Half")} />
          <PcbNumber name="pcbStudying18PlusFull" label="18+ studying · full relief" value={count("studying18PlusFull")} />
          <PcbNumber name="pcbStudying18PlusHalf" label="18+ studying · half relief" value={count("studying18PlusHalf")} />
          <PcbNumber name="pcbDiplomaOrDegreeFull" label="Diploma / degree · full relief" value={count("diplomaOrDegreeFull")} />
          <PcbNumber name="pcbDiplomaOrDegreeHalf" label="Diploma / degree · half relief" value={count("diplomaOrDegreeHalf")} />
          <PcbNumber name="pcbDisabledFull" label="Disabled child · full relief" value={count("disabledFull")} />
          <PcbNumber name="pcbDisabledHalf" label="Disabled child · half relief" value={count("disabledHalf")} />
          <PcbNumber name="pcbDisabledStudyingFull" label="Disabled child studying · full" value={count("disabledStudyingFull")} />
          <PcbNumber name="pcbDisabledStudyingHalf" label="Disabled child studying · half" value={count("disabledStudyingHalf")} />
        </div>
        <div className={styles.taxPcbDeclaration}>
          <label className={styles.taxPcbDeclarationToggle}>
            <input defaultChecked={hasTp3} name="pcbTp3Confirmed" type="checkbox" />
            <span>
              <strong>Previous-employer declaration (TP3)</strong>
              <small>Turn on only when this employee worked for another employer during 2026.</small>
            </span>
          </label>
          <div className={styles.taxPcbDeclarationFields}>
            <div className={styles.payrollFormGrid}>
              <PcbMoney name="pcbPriorEmployerGross" label="Gross pay" value={money(profile?.priorEmployerGrossRemunerationCents)} />
              <PcbMoney name="pcbPriorEmployerEpf" label="EPF contributed" value={money(profile?.priorEmployerEpfCents)} />
              <PcbMoney name="pcbPriorEmployerPcb" label="PCB already deducted" value={money(profile?.priorEmployerPcbCents)} />
              <PcbMoney name="pcbPriorEmployerZakat" label="Zakat paid" value={money(profile?.priorEmployerZakatCents)} />
              <label>
                <span>TP3 reference</span>
                <input
                  defaultValue={governedProfile?.tp3Declaration.sourceReference ?? ""}
                  maxLength={240}
                  name="pcbTp3Reference"
                  placeholder="For example, signed TP3 dated 12 Jan 2026"
                  type="text"
                />
              </label>
            </div>
            <PcbDeclarationEntryFields
              categories={PCB_2026_TP3_CATEGORIES}
              declaration="tp3Declaration"
              prefix="pcbTp3"
              value={declaredAmount}
            />
          </div>
        </div>

        <div className={styles.taxPcbDeclaration}>
          <label className={styles.taxPcbDeclarationToggle}>
            <input defaultChecked={hasTp1} name="pcbTp1Confirmed" type="checkbox" />
            <span>
              <strong>Employee tax-relief declaration (TP1)</strong>
              <small>Turn on when an accepted TP1 declaration affects this payroll month.</small>
            </span>
          </label>
          <div className={styles.taxPcbDeclarationFields}>
            <div className={styles.payrollFormGrid}>
              <label>
                <span>TP1 reference</span>
                <input
                  defaultValue={governedProfile?.tp1Declaration.sourceReference ?? ""}
                  maxLength={240}
                  name="pcbTp1Reference"
                  placeholder="For example, signed TP1 dated 02 Aug 2026"
                  type="text"
                />
              </label>
            </div>
            <PcbDeclarationEntryFields
              categories={PCB_2026_TP1_CATEGORIES}
              declaration="tp1Declaration"
              prefix="pcbTp1"
              value={declaredAmount}
            />
          </div>
        </div>

        <div className={styles.taxPcbDeclaration}>
          <label className={styles.taxPcbDeclarationToggle}>
            <input
              defaultChecked={hasReligiousTravelLevy}
              name="pcbReligiousTravelLevyConfirmed"
              type="checkbox"
            />
            <span>
              <strong>Eligible religious-travel levy rebate</strong>
              <small>Leave off unless HR has checked the employee&apos;s eligible payment evidence.</small>
            </span>
          </label>
          <div className={styles.taxPcbDeclarationFields}>
            <div className={styles.payrollFormGrid}>
              <PcbMoney name="pcbReligiousTravelLevy" label="Eligible levy rebate" value={money(profile?.currentReligiousTravelLevyCents)} />
              <label>
                <span>Evidence reference</span>
                <input
                  defaultValue={governedProfile?.religiousTravelLevyDeclaration.sourceReference ?? ""}
                  maxLength={240}
                  name="pcbReligiousTravelLevyReference"
                  placeholder="For example, official receipt reference"
                  type="text"
                />
              </label>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}

function PcbDeclarationEntryFields({
  categories,
  declaration,
  prefix,
  value,
}: {
  categories: readonly { code: string; label: string; limitCents: number }[];
  declaration: "tp1Declaration" | "tp3Declaration";
  prefix: "pcbTp1" | "pcbTp3";
  value: (
    declaration: "tp1Declaration" | "tp3Declaration",
    code: string,
  ) => string;
}) {
  return (
    <details className={styles.taxPcbDetails}>
      <summary>Declaration categories and YA 2026 limits</summary>
      <p>
        Record each TP category separately. The total used by the calculator is
        derived from these reviewed entries.
      </p>
      <div className={styles.payrollFormGrid}>
        {categories.map(({ code, label, limitCents }) => (
          <label key={`${prefix}-${code}`}>
            <span>{code} · {label}</span>
            <input
              defaultValue={value(declaration, code)}
              max={prefix === "pcbTp1" && code === "D1" ? undefined : (limitCents / 100).toFixed(2)}
              min="0"
              name={`${prefix}${code}`}
              step="0.01"
              type="number"
            />
            <small>
              {prefix === "pcbTp1" && code === "D1"
                ? "Use the amount supported by the declaration."
                : `YA 2026 category limit: RM ${(limitCents / 100).toLocaleString("en-MY")}`}
            </small>
          </label>
        ))}
      </div>
    </details>
  );
}

function PcbNumber({ label, name, value }: { label: string; name: string; value: number }) {
  return <label><span>{label}</span><input defaultValue={value} min="0" name={name} step="1" type="number" /></label>;
}

function PcbMoney({ label, name, value }: { label: string; name: string; value: string }) {
  return <label><span>{label} (RM)</span><input defaultValue={value} min="0" name={name} step="0.01" type="number" /></label>;
}

function TaxIdentifierField({
  clearName,
  currentMasked,
  currentValue,
  label,
  name,
}: {
  clearName: string;
  currentMasked: string | null;
  currentValue?: string | null;
  label: string;
  name: string;
}) {
  const inputId = `tax-${name}`;

  return (
    <div className={styles.taxIdentifierField}>
      <div className={styles.taxIdentifierLabelRow}>
        <label htmlFor={inputId}>{label}</label>
        {currentMasked ? (
          <label className={styles.taxRemoveOption}>
            <input name={clearName} type="checkbox" />
            <span>Remove</span>
          </label>
        ) : null}
      </div>
      <input
        autoComplete="off"
        id={inputId}
        maxLength={30}
        name={name}
        defaultValue={currentValue ?? undefined}
        placeholder={
          currentValue
            ? undefined
            : currentMasked
            ? `${currentMasked} · Enter a new number to change`
            : "Enter number"
        }
      />
    </div>
  );
}

function StatutoryImpactNotice({
  impact,
}: {
  impact: {
    artifactCount: number;
    draftCount: number;
    finalizedCount: number;
    reviewCount: number;
  };
}) {
  const needsDraftRefresh = impact.draftCount > 0 || impact.reviewCount > 0;

  return (
    <div className={needsDraftRefresh ? styles.draftImpactWarning : styles.draftImpactNotice}>
      <strong>{needsDraftRefresh ? "Review current payroll" : "Used for the next payroll"}</strong>
      <span>
        {needsDraftRefresh
          ? "Refresh the current payroll draft to include these changes."
          : "Your changes will apply automatically to future payroll."}
      </span>
    </div>
  );
}

function BankPanel({
  dialogError,
  employeeName,
  initiallyOpen,
  result,
}: {
  dialogError?: string | null;
  employeeName: string;
  initiallyOpen: boolean;
  result: EmployeeBankSectionResult;
}) {
  if (result.status === "NOT_FOUND") return null;
  if (result.status === "ACCESS_DENIED") {
    if (result.reason === "CAPABILITY") return null;
    return (
      <RestrictedPanel
        eyebrow="Bank details"
        title="Salary bank account is restricted"
        message="Viewing salary bank details requires all-branch payroll access. No bank record was loaded."
      />
    );
  }

  const { bank } = result.data;
  const isActive = bank?.status === "ACTIVE";
  const bankAccountMfaEnabled = isPayrollBankAccountMfaEnabled();
  return (
    <section
      className={`${styles.profilePanel} ${styles.payrollSetupCard}`}
      data-bank-profile="safe"
    >
      <div className={styles.panelHeading}>
        <div>
          <h3>Salary bank</h3>
          <p>Where future salary payments will be sent.</p>
        </div>
        <span data-tone={isActive ? "ready" : "warning"}>
          {bank ? formatEnum(bank.status) : "Not configured"}
        </span>
      </div>

      {bank ? (
        <div className={styles.detailList}>
          <PayrollDetail label="Bank" value={bank.bankName} />
          <PayrollDetail label="Holder name" value={bank.accountHolderName} />
          <PayrollDetail label="Account number" value={bank.accountNumber} />
        </div>
      ) : (
        <div className={styles.profileEmpty}>
          <strong>No salary bank account</strong>
          <p>Add an encrypted bank account before preparing a future payroll payment batch.</p>
        </div>
      )}

      <details className={styles.payrollTechnicalDetails}>
        <summary>Security &amp; history</summary>
        <p>Account numbers are encrypted in storage and shown only to authorised payroll users on this employee profile.</p>
        {bank ? (
          <p>
            Effective {formatDate(bank.effectiveFrom)} · Revision {bank.revision} · {formatEnum(bank.status)}
          </p>
        ) : null}
      </details>

      {result.data.canEdit ? (
        <BankAccountDialog
          bank={bank}
          dialogError={dialogError}
          employeeName={employeeName}
          initiallyOpen={initiallyOpen}
          membershipId={result.data.membershipId}
        />
      ) : null}

      {isActive && result.data.canEdit ? (
        <details className={styles.payrollEditDisclosure}>
          <summary>Deactivate bank account</summary>
          <form action={deactivateEmployeeBankVersionAction} className={styles.payrollEditForm}>
            <input name="bankAccountVersionId" type="hidden" value={bank.id} />
            <input name="commandId" type="hidden" value={randomUUID()} />
            <input name="expectedRevision" type="hidden" value={bank.revision} />
            <input name="membershipId" type="hidden" value={result.data.membershipId} />
            <input name="reasonType" type="hidden" value="ACCOUNT_DEACTIVATED" />
            <label className={styles.reasonField}>
              <span>Deactivation reason</span>
              <textarea
                maxLength={500}
                minLength={5}
                name="reason"
                placeholder="Explain why this salary bank account is being deactivated"
                required
                rows={3}
              />
            </label>
            <div className={styles.draftImpactWarning}>
              <strong>Historical payment instructions stay unchanged</strong>
              <span>Deactivation does not delete this version or rewrite an existing batch.</span>
            </div>
            {bankAccountMfaEnabled ? (
              <PayrollHighRiskMfaFields actionLabel="Deactivate this employee bank account" />
            ) : null}
            <button type="submit">Deactivate bank account</button>
          </form>
        </details>
      ) : null}
    </section>
  );
}

function BankAccountDialog({
  bank,
  dialogError,
  employeeName,
  initiallyOpen,
  membershipId,
}: {
  bank: Extract<EmployeeBankSectionResult, { status: "READY" }>["data"]["bank"];
  dialogError?: string | null;
  employeeName: string;
  initiallyOpen: boolean;
  membershipId: string;
}) {
  const replacing = bank?.status === "ACTIVE";
  const selectedBankCode = salaryBankOptions.some(
    (option) => option.code === bank?.bankCode,
  )
    ? bank!.bankCode
    : salaryBankOptions[0].code;
  const effectiveDate = minimumBankEffectiveDate(bank?.effectiveFrom ?? null);
  const bankAccountMfaEnabled = isPayrollBankAccountMfaEnabled();

  return (
    <EmployeeProfilePayrollDialog
      description="Choose where this employee should receive salary payments."
      dialogId={`bank-account-edit-${membershipId}`}
      initiallyOpen={initiallyOpen}
      label={replacing ? "Change bank" : "Add bank"}
      title={replacing ? "Change bank" : "Add bank"}
      variant="button"
    >
      {dialogError ? (
        <div className={styles.payrollUpdateNotice} data-status="error" role="alert">
          <div>
            <strong>Bank account not saved</strong>
            <p>{dialogError}</p>
          </div>
        </div>
      ) : null}
      {bank ? (
        <div className={styles.bankCurrentSummary}>
          <div>
            <span>Current account</span>
            <strong>{bank.bankName}</strong>
          </div>
          <div>
            <span>Account</span>
            <strong>{bank.accountNumber}</strong>
          </div>
        </div>
      ) : null}
      <form action={createEmployeeBankVersionAction} className={styles.bankAccountForm}>
        <input name="commandId" type="hidden" value={randomUUID()} />
        <input name="expectedRevision" type="hidden" value={bank?.revision ?? 0} />
        <input name="effectiveFrom" type="hidden" value={effectiveDate} />
        <input name="membershipId" type="hidden" value={membershipId} />
        <input name="returnTo" type="hidden" value="profile" />
        <input
          name="reasonType"
          type="hidden"
          value={bank ? "ACCOUNT_CHANGE" : "INITIAL_SETUP"}
        />
        <input
          name="reason"
          type="hidden"
          value={bank ? "Salary bank account replaced" : "Salary bank account added"}
        />
        <div className={styles.bankFormGrid}>
          <label>
            <span>Receiving bank or e-wallet</span>
            <select defaultValue={selectedBankCode} name="bankCode" required>
              {salaryBankGroups.map((group) => (
                <optgroup key={group.code} label={group.label}>
                  {salaryBankOptions
                    .filter((option) => option.group === group.code)
                    .map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>Holder name</span>
            <input
              autoComplete="name"
              defaultValue={bank?.accountHolderName ?? employeeName}
              maxLength={160}
              name="accountHolderName"
              required
            />
          </label>
          <label>
            <span>Account number or wallet ID</span>
            <input
              autoComplete="off"
              inputMode="numeric"
              maxLength={48}
              minLength={5}
              name="accountNumber"
              placeholder="Enter the new account number or wallet ID"
              required
            />
          </label>
        </div>
        <div className={styles.bankSecurityNote}>
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Protected bank details</strong>
            <p>The account number is encrypted when saved.</p>
          </div>
        </div>
        {bankAccountMfaEnabled ? (
          <div className={styles.bankMfaSection}>
            <PayrollHighRiskMfaFields actionLabel="Confirm bank account" />
          </div>
        ) : null}
        <div className={styles.bankEditActions}>
          <p>Existing payroll runs and payment batches stay unchanged.</p>
          <button type="submit">
            {replacing ? "Save bank change" : "Save bank account"}
          </button>
        </div>
      </form>
    </EmployeeProfilePayrollDialog>
  );
}

function minimumBankEffectiveDate(currentEffectiveFrom: string | null) {
  const today = new Date();
  const minimum = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  if (currentEffectiveFrom) {
    const afterCurrent = new Date(currentEffectiveFrom);
    afterCurrent.setUTCDate(afterCurrent.getUTCDate() + 1);
    if (afterCurrent > minimum) minimum.setTime(afterCurrent.getTime());
  }
  return minimum.toISOString().slice(0, 10);
}

function payrollReadinessHeading(status: "READY" | "REVIEW_REQUIRED" | "BLOCKED") {
  if (status === "READY") return "Ready to prepare payroll";
  if (status === "REVIEW_REQUIRED") return "Review employee details before final payment";
  return "Payroll setup needs attention";
}

function payrollReadinessLabel(status: "READY" | "REVIEW_REQUIRED" | "BLOCKED") {
  if (status === "READY") return "Ready";
  if (status === "REVIEW_REQUIRED") return "Review needed";
  return "Blocked";
}

function RestrictedPanel({
  eyebrow,
  message,
  title,
}: {
  eyebrow: string;
  message: string;
  title: string;
}) {
  return (
    <section className={styles.profilePanel}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h3>{title}</h3>
          <p>{message}</p>
        </div>
        <span>Restricted</span>
      </div>
      <div className={styles.profileEmpty}>
        <strong>Information not available</strong>
        <p>No protected values were loaded for this section.</p>
      </div>
    </section>
  );
}

function restrictedMessage(
  reason: "CAPABILITY" | "WHOLE_BUSINESS_SCOPE",
  subject: string,
) {
  return reason === "WHOLE_BUSINESS_SCOPE"
    ? `Viewing ${subject} requires all-branch payroll access.`
    : `You do not have permission to view this employee's ${subject}.`;
}

function PayrollDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PayrollSetupMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function baseRateLabel(payBasis: "MONTHLY" | "DAILY" | "HOURLY") {
  if (payBasis === "DAILY") return "Base daily rate";
  if (payBasis === "HOURLY") return "Base hourly rate";
  return "Base monthly salary";
}

function formatMoney(value: string | null) {
  if (value === null) return "Not configured";
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (!hours) return `${minutes} min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatParticipation(value: boolean) {
  return value ? "Enrolled" : "Not enrolled";
}

type Lindung24ProfileRecord = Extract<
  Extract<EmployeeStatutoryProfileResult, { status: "READY" }>["statutory"],
  { status: "READY" }
>["data"]["lindung24ParticipationHistory"][number];

function lindung24CoverageState(
  record: Lindung24ProfileRecord | null,
  legacyOptIn: boolean,
) {
  if (!record) return legacyOptIn ? "review" : "missing";
  if (record.selectedEmployer === "PERKESO_SELECTION_PENDING") return "review";
  if (record.status === "VOLUNTARY_OPT_OUT") return "excluded";
  return "included";
}

function lindung24CoverageLabel(
  record: Lindung24ProfileRecord | null,
  legacyOptIn: boolean,
) {
  const state = lindung24CoverageState(record, legacyOptIn);
  if (state === "included") return "Included";
  if (state === "excluded") return "Not included";
  if (state === "review") return "Review needed";
  return "Not set";
}

function lindung24CoverageDescription(
  record: Lindung24ProfileRecord | null,
  legacyOptIn: boolean,
) {
  if (!record) {
    return legacyOptIn
      ? "An older opt-in record exists. Confirm the current payroll coverage."
      : "Applicability information and the employee's participation decision have not been recorded.";
  }
  if (record.selectedEmployer === "PERKESO_SELECTION_PENDING") {
    return "The responsible payroll employer still needs confirmation.";
  }
  if (record.status === "VOLUNTARY_OPT_OUT") {
    return "Payroll will not calculate a LINDUNG 24 contribution for this employee.";
  }
  return "Payroll will calculate the employee contribution using the active rule.";
}

function lindung24EmployeeClassification(nationality: string | null) {
  if (nationality === "NON_MALAYSIAN") return "Foreign worker";
  if (nationality === "MALAYSIAN" || nationality === "PERMANENT_RESIDENT") {
    return "Local employee";
  }
  return "Not determined";
}

function lindung24ParticipationRequirement(nationality: string | null) {
  if (nationality === "NON_MALAYSIAN") return "Mandatory when eligible";
  if (nationality === "MALAYSIAN" || nationality === "PERMANENT_RESIDENT") {
    return "Voluntary — decision required";
  }
  return "Applicability information incomplete";
}

function formatLindung24Source(source: Lindung24ProfileRecord["sourceType"]) {
  if (!source) return "Synthetic testing fixture";
  if (source === "OFFICIAL_TRANSITION") return "PERKESO official record";
  if (source === "EMPLOYEE_OPT_IN") return "Employee opt-in acknowledgement";
  if (source === "EMPLOYEE_OPT_OUT") return "Employee opt-out notice";
  if (source === "PERKESO_EMPLOYER_SELECTION") return "PERKESO employer selection";
  if (source === "EMPLOYMENT_CHANGE") return "Employment eligibility evidence";
  return "Legacy record requiring review";
}

function formatLindung24Acknowledgement(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium" }).format(new Date(value));
}

function formatLindung24Status(status: Lindung24ProfileRecord["status"]) {
  if (status === "MANDATORY") return "Required by PERKESO";
  if (status === "DEFAULT_PARTICIPATING") return "Included by default";
  if (status === "VOLUNTARY_OPT_IN") return "Joined voluntarily";
  return "Opted out";
}

function formatLindung24Employer(
  employer: Lindung24ProfileRecord["selectedEmployer"],
) {
  if (employer === "CURRENT_BUSINESS") return "This business";
  if (employer === "OTHER_EMPLOYER") return "Another employer";
  return "Confirmation pending";
}

function formatEnrollmentValue(enabled: boolean, value: string | null) {
  if (!enabled) return "Not applicable";
  return value ?? "Not configured";
}

function statutorySetupStatus(data: {
  eisEnabled: boolean;
  epfEnabled: boolean;
  epfMemberNumberMasked: string | null;
  nationality: string | null;
  profileUpdatedAt: string | null;
  socsoCategory: string | null;
  socsoEnabled: boolean;
  socsoMemberNumberMasked: string | null;
}) {
  if (!data.profileUpdatedAt) return "Not configured";
  if (!data.nationality) return "Incomplete";
  if (data.epfEnabled && !data.epfMemberNumberMasked) return "Incomplete";
  if (
    data.socsoEnabled &&
    (!data.socsoCategory || !data.socsoMemberNumberMasked)
  ) {
    return "Incomplete";
  }
  return "Complete";
}

function taxSetupStatus(data: {
  countryCode: string | null;
  identityNumberMasked: string | null;
  identityType: string | null;
  profileUpdatedAt: string | null;
  tinMasked: string | null;
}) {
  if (!data.profileUpdatedAt) return "Not configured";
  if (
    !data.identityType ||
    !data.identityNumberMasked ||
    !data.countryCode ||
    !data.tinMasked
  ) {
    return "Incomplete";
  }
  return "Complete";
}

function formatNullableEnum(value: string | null) {
  return value ? formatEnum(value) : "Not configured";
}

function formatSocsoCategory(value: string | null) {
  if (value === "FIRST") return "Standard coverage (First category)";
  if (value === "SECOND") return "Employment injury only (Second category)";
  return "Not configured";
}

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function formatMonth(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(value));
}

function formatMonthValue(value: string) {
  return formatMonth(`${value}-01T00:00:00.000Z`);
}
