import Link from "next/link";
import type { ReactNode } from "react";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
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
import { prisma } from "@/lib/prisma";
import styles from "./workspace.module.css";

export const dynamic = "force-dynamic";

export default async function PayrollWorkspacePage() {
  const context = await requireBusinessUser();
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
  const canViewPayslip = hasBusinessCapability(
    context.access,
    "VIEW_PAYSLIP",
  );
  const canViewStatutory =
    hasBusinessCapability(context.access, "VIEW_STATUTORY_SUBMISSION") &&
    hasBusinessCapability(context.access, "VIEW_STATUTORY_PROFILE") &&
    hasBusinessCapability(context.access, "VIEW_TAX_PROFILE");
  const data = await loadPayrollWorkspace(context.businessId);
  const statutoryStatuses =
    canViewStatutory && data.currentRun?.status === "FINALIZED"
      ? await loadPayrollWorkspaceStatutoryStatuses(
          context.businessId,
          data.currentRun.id,
        )
      : canViewStatutory
        ? []
        : null;
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
  );
  const statutoryLabel = payrollStatutoryLabel(
    data.currentRun?.status,
    statutoryStatuses,
  );
  const finalizedRun = data.recentRuns.find(
    (run) => run.status === "FINALIZED",
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
            href={`/team/payroll?month=${data.currentMonth}`}
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
        <StatusItem label="Payment" value="Not available in this release" />
        <StatusItem label="Statutory" value={statutoryLabel} />
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
            description="The main monthly calculation workflow remains on the existing Payroll page."
            href={`/team/payroll?month=${data.currentMonth}`}
            linkLabel="Open payroll runs"
            title="Payroll Runs"
          />
          {canViewPayslip ? (
            <ModuleCard
              current
              description="Download PDFs from locked payroll calculations. Publishing is not included."
              href={
                finalizedRun
                  ? `/team/payroll?month=${finalizedRun.month}`
                  : `/team/payroll?month=${data.currentMonth}`
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
              description="Existing calculation settings remain on Monthly Payroll during W1."
              href={`/team/payroll?month=${data.currentMonth}`}
              linkLabel="Open existing settings"
              title="Payroll Settings"
            />
          ) : null}
          <ModuleCard
            description="Planned as a checking and navigation layer. No employee metrics or editing are included in W1."
            state="Future"
            title="Employee Payroll Setup"
          />
          <ModuleCard
            description="No payment batch, bank export or paid-status workflow exists in this release."
            state="Not available"
            title="Payroll Payments"
          />
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
                      <Link href={`/team/payroll?month=${run.month}`}>View run</Link>
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
