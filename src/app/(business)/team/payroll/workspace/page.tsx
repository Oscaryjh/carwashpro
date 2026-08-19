import Link from "next/link";
import type { ReactNode } from "react";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { requireUser } from "@/lib/auth/session";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import {
  loadPayrollWorkspace,
  loadPayrollWorkspaceStatutoryStatuses,
  payrollCalculationDescription,
  payrollCalculationLabel,
  payrollPayslipLabel,
  payrollPrimaryActionLabel,
  payrollStatutoryLabel,
} from "@/lib/payroll/workspace";
import { getPayrollPeriodReadiness } from "@/lib/payroll/readiness";
import { prisma } from "@/lib/prisma";
import styles from "./workspace.module.css";

export const dynamic = "force-dynamic";

export default async function PayrollWorkspacePage() {
  const identity = await requireUser();
  const context = await requireBusinessUser(
    identity.activeBusinessId !== identity.homeBusinessId
      ? "VIEW_DASHBOARD"
      : undefined,
  );
  const canViewPayroll = hasBusinessCapability(
    context.access,
    "VIEW_PAYROLL_RUN",
  );

  if (!canViewPayroll) {
    return <PayrollWorkspaceAccessDenied />;
  }

  const [scope, activeBranchCount] = await Promise.all([
    resolveAttendanceScope(context.access),
    prisma.branch.count({
      where: { businessId: context.businessId, status: "ACTIVE" },
    }),
  ]);
  const hasWholeBusinessScope =
    scope.allowedBranchIds.length === activeBranchCount &&
    !(
      context.access.effectiveBusinessRole === "STAFF" &&
      !context.access.permissions.includes("ALL_BRANCHES")
    );

  if (!hasWholeBusinessScope) {
    return <PayrollWorkspaceAccessDenied scopeRestricted />;
  }

  const canEditPayroll = hasBusinessCapability(
    context.access,
    "EDIT_PAYROLL_ENTRY",
  );
  const canCreatePayroll = hasBusinessCapability(
    context.access,
    "CREATE_PAYROLL_RUN",
  );
  const canViewPayslip = hasBusinessCapability(
    context.access,
    "VIEW_PAYSLIP",
  );
  const canViewPayments = hasBusinessCapability(
    context.access,
    "VIEW_PAYMENT_BATCH",
  );
  const canViewTeamDirectory = hasBusinessCapability(
    context.access,
    "VIEW_TEAM_DIRECTORY",
  );
  const canViewBankProfile = hasBusinessCapability(
    context.access,
    "VIEW_BANK_ACCOUNT",
  );
  const canEditBankProfile = hasBusinessCapability(
    context.access,
    "EDIT_BANK_ACCOUNT",
  );
  const canViewStatutoryProfile =
    hasBusinessCapability(context.access, "VIEW_STATUTORY_PROFILE") ||
    hasBusinessCapability(context.access, "VIEW_TAX_PROFILE");
  const canEditStatutoryProfile =
    hasBusinessCapability(context.access, "EDIT_STATUTORY_PROFILE") ||
    hasBusinessCapability(context.access, "EDIT_TAX_PROFILE");
  const canViewStatutory =
    hasBusinessCapability(context.access, "VIEW_STATUTORY_SUBMISSION") &&
    hasBusinessCapability(context.access, "VIEW_STATUTORY_PROFILE") &&
    hasBusinessCapability(context.access, "VIEW_TAX_PROFILE");
  const data = await loadPayrollWorkspace(context.businessId);
  const readiness = await getPayrollPeriodReadiness({
    businessId: context.businessId,
    month: data.currentMonth,
    runId: data.currentRun?.id,
  });
  const statutoryStatuses =
    canViewStatutory && data.currentRun?.status === "FINALIZED"
      ? await loadPayrollWorkspaceStatutoryStatuses(
          context.businessId,
          data.currentRun.id,
        )
      : canViewStatutory
        ? []
        : null;
  const publishedPayslipCount =
    canViewPayslip && data.currentRun?.status === "FINALIZED"
      ? await prisma.payrollPayslipPublication.count({
          where: { businessId: context.businessId, payrollRunId: data.currentRun.id },
        })
      : 0;
  const monthLabel = formatMonth(data.currentPeriodStart);
  const calculationLabel = payrollCalculationLabel(data.currentRun?.status);
  const primaryActionLabel = payrollPrimaryActionLabel(
    data.currentRun?.status,
    monthLabel,
    canEditPayroll,
  );
  const payslipLabel = payrollPayslipLabel(
    data.currentRun?.status,
    canViewPayslip,
    publishedPayslipCount,
    data.currentRun?.employeeCount ?? 0,
  );
  const statutoryLabel = payrollStatutoryLabel(
    data.currentRun?.status,
    statutoryStatuses,
  );
  const finalizedRun = data.recentRuns.find(
    (run) => run.status === "FINALIZED",
  );
  const bankWarnings = readiness.warnings.filter((issue) =>
    issue.code === "MISSING_BANK_ACCOUNT" || issue.code === "BANK_ACCOUNT_UNVERIFIED",
  );
  const statutoryProfileWarnings = readiness.warnings.filter((issue) =>
    issue.code === "STATUTORY_PROFILE_INCOMPLETE",
  );

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>HR &amp; Payroll</p>
          <h1>Payroll Workspace</h1>
          <p>See the current payroll state and take the next valid action.</p>
        </div>
      </header>

      <section className={styles.currentPanel} aria-labelledby="current-payroll-heading">
        <div className={styles.currentMain}>
          <div className={styles.periodLine}>
            <span>Current payroll period · {monthLabel}</span>
            <StatusBadge status={data.currentRun?.status}>
              {calculationLabel}
            </StatusBadge>
          </div>
          <div className={styles.currentCopy}>
            <h2 id="current-payroll-heading">
              {currentHeading(data.currentRun?.status, monthLabel)}
            </h2>
            <p>{payrollCalculationDescription(data.currentRun?.status)}</p>
          </div>
          <Link
            className={styles.primaryAction}
            href={
              data.currentRun
                ? `/team/payroll/runs/${data.currentRun.id}`
                : `/team/payroll/runs?month=${data.currentMonth}`
            }
          >
            {primaryActionLabel}
          </Link>
        </div>

        <div className={styles.runSummary}>
          <p>Current Payroll Run</p>
          {data.currentRun ? (
            <>
              <strong>{data.currentRun.employeeCount} employees</strong>
              <span>{formatMoney(data.currentRun.grossPayroll)} gross payroll</span>
              <span>{formatMoney(data.currentRun.netPayroll)} net payroll</span>
              <small>Calculation totals · not payment status</small>
            </>
          ) : (
            <>
              <strong>No run yet</strong>
              <span>The selected period has no payroll calculation.</span>
            </>
          )}
        </div>
      </section>

      <section className={styles.statusGrid} aria-label="Independent payroll statuses">
        <StatusItem label="Calculation" value={calculationLabel} />
        <StatusItem label="Payslips" value={payslipLabel} />
        <StatusItem
          label="Payment"
          value={canViewPayments ? "Readiness & approval available" : "Access not granted"}
        />
        <StatusItem label="Statutory" value={statutoryLabel} />
      </section>

      <section className={styles.readinessPanel} aria-labelledby="payroll-readiness-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Payroll readiness</p>
          <h2 id="payroll-readiness-heading">What needs attention</h2>
          <p>
            {readiness.employeeCount} eligible employees · {readiness.readyCount} ready · {readiness.reviewRequiredCount} review required · {readiness.blockedCount} blocked.
            Profile warnings do not block payroll calculation, Review or Finalize.
          </p>
        </div>
        <div className={styles.boundaryGrid} aria-label="Payroll processing gates">
          <BoundaryStatus
            description={
              readiness.blockers.length
                ? "Resolve blocking payroll or Attendance evidence before continuing."
                : "Draft, Review and Finalize can continue for this period."
            }
            label="Payroll calculation"
            status={readiness.blockers.length ? "Blocked" : "Ready"}
            tone={readiness.blockers.length ? "blocked" : "ready"}
          />
          <BoundaryStatus
            description={
              !canViewPayments
                ? "Payment batch access is not granted to this role."
                : bankWarnings.length
                  ? `${bankWarnings.length} employee bank profile${bankWarnings.length === 1 ? "" : "s"} must be completed before a bank payment batch.`
                  : "Employee bank profiles are ready for payment-batch preparation."
            }
            label="Bank payment batch"
            status={!canViewPayments ? "Not available" : bankWarnings.length ? "Action required" : "Ready"}
            tone={!canViewPayments ? "neutral" : bankWarnings.length ? "action" : "ready"}
          />
          <BoundaryStatus
            description={
              !canViewStatutory
                ? "Statutory submission access is not granted to this role."
                : statutoryProfileWarnings.length
                  ? `${statutoryProfileWarnings.length} employee profile${statutoryProfileWarnings.length === 1 ? "" : "s"} must be completed before official submission files.`
                  : "Employee statutory and tax profiles are ready for submission preparation."
            }
            label="Statutory submission"
            status={!canViewStatutory ? "Not available" : statutoryProfileWarnings.length ? "Action required" : "Ready"}
            tone={!canViewStatutory ? "neutral" : statutoryProfileWarnings.length ? "action" : "ready"}
          />
        </div>
        <div className={styles.readinessCounts}>
          <StatusItem label="Blocking issues" value={String(readiness.blockers.length)} />
          <StatusItem label="Bank profile actions" value={String(bankWarnings.length)} />
          <StatusItem label="Statutory profile actions" value={String(statutoryProfileWarnings.length)} />
          <StatusItem label="Pending variable pay" value={String(readiness.counts.PENDING_VARIABLE_PAY)} />
        </div>
        {readiness.blockers.length || readiness.warnings.length ? (
          <div className={styles.issueColumns}>
            <ReadinessIssues
              access={{
                canEditBankProfile,
                canEditStatutoryProfile,
                canViewBankProfile: canViewTeamDirectory && canViewBankProfile,
                canViewStatutoryProfile:
                  canViewTeamDirectory && canViewStatutoryProfile,
              }}
              title="Must fix before payroll"
              issues={readiness.blockers}
            />
            <ReadinessIssues
              access={{
                canEditBankProfile,
                canEditStatutoryProfile,
                canViewBankProfile: canViewTeamDirectory && canViewBankProfile,
                canViewStatutoryProfile:
                  canViewTeamDirectory && canViewStatutoryProfile,
              }}
              title="Fix before payment or submission"
              issues={readiness.warnings}
            />
          </div>
        ) : (
          <div className={styles.readyState} role="status">
            No blockers or warnings for this payroll period.
          </div>
        )}
        {!data.currentRun && canCreatePayroll ? (
          <div className={styles.preflightAction}>
            <div>
              <strong>{readiness.canProceed ? "Ready to create the payroll draft" : "Resolve blockers before creating payroll"}</strong>
              <span>Eligible employees are included automatically from their join and termination dates.</span>
            </div>
            <Link href={`/team/payroll/runs?month=${data.currentMonth}`}>Review and create payroll</Link>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="payroll-modules-heading">
        <SectionHeading
          id="payroll-modules-heading"
          title="Payroll modules"
          description="Only current, authorized destinations are interactive."
        />
        <div className={styles.moduleGrid}>
          <ModuleCard
            current
            description="Browse monthly payroll calculations and employee entries in a read-only workspace."
            href="/team/payroll/runs"
            linkLabel="Open payroll runs"
            title="Payroll Runs"
          />
          {canViewPayslip ? (
            <ModuleCard
              current
              description="Preview finalized PDFs and publish frozen payslips for staff self-service."
              href={
                finalizedRun
                  ? `/team/payroll/runs/${finalizedRun.id}`
                  : `/team/payroll/runs?month=${data.currentMonth}`
              }
              linkLabel={finalizedRun ? "View available payslips" : "View payroll runs"}
              title="Payslip PDFs"
            />
          ) : null}
          {canViewStatutory ? (
            <ModuleCard
              current
              description="Monthly statutory export and submission tracking only."
              href={`/team/payroll/statutory?month=${data.currentMonth}`}
              linkLabel="Open statutory submissions"
              title="Statutory Submissions"
            />
          ) : null}
          {canEditPayroll ? (
            <ModuleCard
              current
              description="Maintain business calculation policy and branch public holidays outside monthly runs."
              href={`/team/payroll/settings?month=${data.currentMonth}`}
              linkLabel="Open payroll settings"
              title="Payroll Settings"
            />
          ) : null}
          <ModuleCard
            description="Planned as a checking and navigation layer. No employee metrics or editing are included in W1."
            state="Future"
            title="Employee Payroll Setup"
          />
          {canViewPayments ? (
            <ModuleCard
              current
              description="Review finalized payroll readiness and manage draft payment approval. Bank files and payment completion are not included."
              href="/team/payroll/payments"
              linkLabel="Open payroll payments"
              title="Payroll Payments"
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="recent-runs-heading">
        <SectionHeading
          id="recent-runs-heading"
          title="Recent payroll runs"
          description="Calculation history only; not payment history."
        />
        {data.recentRuns.length ? (
          <div className={styles.runTableWrap}>
            <table className={styles.runTable}>
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Calculation status</th>
                  <th>Employees</th>
                  <th>Updated</th>
                  <th><span className={styles.visuallyHidden}>Action</span></th>
                </tr>
              </thead>
              <tbody>
                {data.recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td data-label="Period"><strong>{formatMonth(run.periodStart)}</strong></td>
                    <td data-label="Calculation status">
                      <StatusBadge status={run.status}>
                        {payrollCalculationLabel(run.status)}
                      </StatusBadge>
                    </td>
                    <td data-label="Employees">{run.employeeCount}</td>
                    <td data-label="Updated">{formatDate(run.updatedAt)}</td>
                    <td className={styles.rowActionCell}>
                      <Link href={`/team/payroll/runs/${run.id}`}>View run</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.emptyRuns}>
            <span aria-hidden="true">—</span>
            <div>
              <h3>No payroll run history</h3>
              <p>Completed and in-progress payroll periods will appear here.</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function PayrollWorkspaceAccessDenied({
  scopeRestricted = false,
}: {
  scopeRestricted?: boolean;
}) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>HR &amp; Payroll</p>
          <h1>Payroll Workspace</h1>
        </div>
      </header>
      <section className={`${styles.statePanel} ${styles.deniedPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Access denied</p>
          <h2>
            {scopeRestricted
              ? "Payroll requires authorized access to every active branch"
              : "You do not have permission to view Payroll"}
          </h2>
          <p>
            No payroll period, employee, calculation, payslip, payment or statutory
            data was loaded.
          </p>
          <Link href="/team">Back to HR &amp; Payroll</Link>
        </div>
      </section>
    </main>
  );
}

function SectionHeading({
  description,
  id,
  title,
}: {
  description: string;
  id: string;
  title: string;
}) {
  return (
    <div className={styles.sectionHeading}>
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <article className={styles.statusItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function BoundaryStatus({
  description,
  label,
  status,
  tone,
}: {
  description: string;
  label: string;
  status: string;
  tone: "action" | "blocked" | "neutral" | "ready";
}) {
  return (
    <article className={`${styles.boundaryStatus} ${styles[`boundary_${tone}`]}`}>
      <div>
        <span>{label}</span>
        <strong>{status}</strong>
      </div>
      <p>{description}</p>
    </article>
  );
}

function ReadinessIssues({
  access,
  issues,
  title,
}: {
  access: {
    canEditBankProfile: boolean;
    canEditStatutoryProfile: boolean;
    canViewBankProfile: boolean;
    canViewStatutoryProfile: boolean;
  };
  issues: Awaited<ReturnType<typeof getPayrollPeriodReadiness>>["blockers"];
  title: string;
}) {
  return (
    <div className={styles.issueList}>
      <strong>{title} · {issues.length}</strong>
      {issues.length ? (
        <ul>
          {issues.slice(0, 6).map((issue, index) => (
            <li key={`${issue.code}-${issue.membershipId ?? "run"}-${index}`}>
              <span>{issue.employeeName ?? "Payroll run"} · {issue.source}</span>
              <small>{issue.message}</small>
              <small>{issue.resolutionHint}</small>
              <ReadinessIssueAction access={access} issue={issue} />
            </li>
          ))}
        </ul>
      ) : <p>None</p>}
    </div>
  );
}

function ReadinessIssueAction({
  access,
  issue,
}: {
  access: {
    canEditBankProfile: boolean;
    canEditStatutoryProfile: boolean;
    canViewBankProfile: boolean;
    canViewStatutoryProfile: boolean;
  };
  issue: Awaited<ReturnType<typeof getPayrollPeriodReadiness>>["issues"][number];
}) {
  if (!issue.membershipId) return null;
  if (
    (issue.code === "MISSING_BANK_ACCOUNT" || issue.code === "BANK_ACCOUNT_UNVERIFIED") &&
    access.canViewBankProfile
  ) {
    const canOpenEditor = issue.code === "MISSING_BANK_ACCOUNT" && access.canEditBankProfile;
    return (
      <Link
        className={styles.issueAction}
        href={
          canOpenEditor
            ? `/team/people/${issue.membershipId}/payroll/bank/edit`
            : `/team/people/${issue.membershipId}?section=payroll`
        }
      >
        {canOpenEditor ? "Add bank account" : "Review bank profile"}
      </Link>
    );
  }
  if (issue.code === "STATUTORY_PROFILE_INCOMPLETE" && access.canViewStatutoryProfile) {
    return (
      <Link
        className={styles.issueAction}
        href={`/team/people/${issue.membershipId}?section=statutory`}
      >
        {access.canEditStatutoryProfile
          ? "Complete statutory profile"
          : "Review statutory profile"}
      </Link>
    );
  }
  return null;
}

function StatusBadge({
  children,
  status,
}: {
  children: ReactNode;
  status?: "DRAFT" | "REVIEW" | "FINALIZED" | null;
}) {
  const tone =
    status === "DRAFT"
      ? styles.draft
      : status === "REVIEW"
        ? styles.review
        : status === "FINALIZED"
          ? styles.finalized
          : styles.notGenerated;
  return <span className={`${styles.statusBadge} ${tone}`}>{children}</span>;
}

function ModuleCard({
  current = false,
  description,
  href,
  linkLabel,
  state,
  title,
}: {
  current?: boolean;
  description: string;
  href?: string;
  linkLabel?: string;
  state?: "Future" | "Not available";
  title: string;
}) {
  return (
    <article
      className={`${styles.moduleCard} ${
        current
          ? styles.currentModule
          : state === "Not available"
            ? styles.unavailableModule
            : styles.futureModule
      }`}
    >
      <div className={styles.moduleTitle}>
        <h3>{title}</h3>
        <span>{current ? "Current" : state}</span>
      </div>
      <p>{description}</p>
      {href && linkLabel ? <Link href={href}>{linkLabel}</Link> : null}
    </article>
  );
}

function currentHeading(
  status: "DRAFT" | "REVIEW" | "FINALIZED" | null | undefined,
  monthLabel: string,
) {
  if (status === "DRAFT") return `Continue the ${monthLabel} payroll draft`;
  if (status === "REVIEW") return `${monthLabel} payroll is awaiting review`;
  if (status === "FINALIZED") return `${monthLabel} payroll calculations are locked`;
  return `${monthLabel} payroll has not been generated`;
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(date);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
  }).format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-MY", {
    currency: "MYR",
    currencyDisplay: "narrowSymbol",
    style: "currency",
  }).format(value);
}
