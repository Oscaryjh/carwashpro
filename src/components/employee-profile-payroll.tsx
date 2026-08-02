import Link from "next/link";
import type { EmployeeCompensationSectionResult } from "@/lib/team/employee-profile-compensation-read";
import type { EmployeePayrollNavigationResult } from "@/lib/team/employee-profile-payroll-navigation-read";
import type { EmployeeStatutoryProfileResult } from "@/lib/team/employee-profile-statutory-read";
import styles from "./employee-profile-shell.module.css";

export function EmployeeProfilePayroll({
  compensation,
  navigation,
  statutoryProfile,
}: {
  compensation: EmployeeCompensationSectionResult;
  navigation: EmployeePayrollNavigationResult;
  statutoryProfile: EmployeeStatutoryProfileResult;
}) {
  if (
    compensation.status === "NOT_FOUND" ||
    statutoryProfile.status === "NOT_FOUND"
  ) {
    return null;
  }

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Payroll</p>
          <h2>Payroll profile</h2>
          <p>
            Current long-term payroll setup and secure links available to your
            role. Monthly calculation details remain in Payroll Runs.
          </p>
        </div>
        <span className={styles.scopeBadge}>Sensitive · Read only</span>
      </section>

      <div className={styles.profileGrid}>
        <CompensationPanels result={compensation} />
        <StatutoryPanel result={statutoryProfile.statutory} />
        <TaxPanel result={statutoryProfile.tax} />
      </div>
      <PayrollNavigation result={navigation} />
    </div>
  );
}

function PayrollNavigation({
  result,
}: {
  result: EmployeePayrollNavigationResult;
}) {
  const states = [
    result.payrollRuns.status,
    result.payslip.status,
    result.bankDetails.status,
    result.payment.status,
  ];
  if (states.every((status) => status === "HIDDEN")) return null;

  return (
    <section className={styles.payrollNavigation} aria-labelledby="payroll-access-heading">
      <div className={styles.payrollNavigationHeading}>
        <div>
          <p className={styles.eyebrow}>Payroll access</p>
          <h3 id="payroll-access-heading">Monthly payroll and documents</h3>
          <p>
            Open authorized payroll workspaces without copying monthly records
            into this employee profile.
          </p>
        </div>
        <span>Capability aware</span>
      </div>
      <div className={styles.payrollActionGrid}>
        <PayrollRunsCard state={result.payrollRuns} />
        <PayslipCard state={result.payslip} />
        <UnavailableCard
          state={result.bankDetails}
          eyebrow="Bank Details"
          title="Not available in this release."
          description="Employee bank account storage and salary payment files have not been implemented."
        />
        <UnavailableCard
          state={result.payment}
          eyebrow="Payment"
          title="Payment tracking is not available"
          description="Finalized means calculations are locked; it does not mean this employee has been paid."
        />
      </div>
    </section>
  );
}

function PayrollRunsCard({
  state,
}: {
  state: EmployeePayrollNavigationResult["payrollRuns"];
}) {
  if (state.status === "HIDDEN") return null;
  if (state.status === "ACCESS_DENIED") {
    return <NavigationRestricted title="Payroll Runs" />;
  }
  return (
    <article className={styles.payrollActionCard}>
      <div>
        <p className={styles.eyebrow}>Payroll Runs</p>
        <h4>Monthly calculations</h4>
        <p>Review authorized payroll periods in the canonical Payroll Runs workspace.</p>
      </div>
      <Link className={styles.payrollActionLink} href={state.href}>
        View Payroll Runs
      </Link>
    </article>
  );
}

function PayslipCard({
  state,
}: {
  state: EmployeePayrollNavigationResult["payslip"];
}) {
  if (state.status === "HIDDEN") return null;
  if (state.status === "ACCESS_DENIED") {
    return <NavigationRestricted title="Payslip PDF" />;
  }
  if (state.status === "EMPTY") {
    return (
      <article className={styles.payrollActionCard}>
        <div>
          <p className={styles.eyebrow}>Payslip PDF</p>
          <h4>No finalized payslip available</h4>
          <p>A PDF becomes available here only after a Payroll Run is finalized.</p>
        </div>
        <span className={styles.truthfulState}>Not available</span>
      </article>
    );
  }
  return (
    <article className={styles.payrollActionCard}>
      <div>
        <p className={styles.eyebrow}>Payslip PDF</p>
        <h4>{formatMonth(state.periodStart)} finalized payslip</h4>
        <p>Available for download</p>
        <p>This administrator download does not mean the payslip was published to the employee.</p>
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

function UnavailableCard({
  description,
  eyebrow,
  state,
  title,
}: {
  description: string;
  eyebrow: string;
  state: EmployeePayrollNavigationResult["bankDetails"];
  title: string;
}) {
  if (state.status === "HIDDEN") return null;
  if (state.status === "ACCESS_DENIED") {
    return <NavigationRestricted title={eyebrow} />;
  }
  return (
    <article className={`${styles.payrollActionCard} ${styles.unavailableCard}`}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <span className={styles.truthfulState}>Not available</span>
    </article>
  );
}

function NavigationRestricted({ title }: { title: string }) {
  return (
    <article className={`${styles.payrollActionCard} ${styles.restrictedCard}`}>
      <div>
        <p className={styles.eyebrow}>{title}</p>
        <h4>All-branch access required</h4>
        <p>No payroll record or document was loaded for this link.</p>
      </div>
      <span className={styles.truthfulState}>Restricted</span>
    </article>
  );
}

function CompensationPanels({
  result,
}: {
  result: Exclude<EmployeeCompensationSectionResult, { status: "NOT_FOUND" }>;
}) {
  if (result.status === "ACCESS_DENIED") {
    if (result.reason === "CAPABILITY") return null;

    return (
      <RestrictedPanel
        eyebrow="Pay setup"
        title="Compensation access is restricted"
        message={
          result.reason === "WHOLE_BUSINESS_SCOPE"
            ? "Payroll compensation requires all-branch access. No salary or work-target data was loaded."
            : "You do not have permission to view employee compensation. No salary or work-target data was loaded."
        }
      />
    );
  }

  const { data } = result;
  const plannedSpanMinutes =
    data.normalWorkMinutesPerDay + data.targetBreakMinutes;

  return (
    <>
      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Pay setup</p>
            <h3>Current compensation</h3>
            <p>Current profile values used when a new Payroll Draft is created.</p>
          </div>
          <span>{data.baseRate === null ? "Incomplete" : "Configured"}</span>
        </div>
        <div className={styles.detailList}>
          <PayrollDetail label="Pay basis" value={formatEnum(data.payBasis)} />
          <PayrollDetail
            label={baseRateLabel(data.payBasis)}
            value={formatMoney(data.baseRate)}
          />
          <PayrollDetail label="Currency" value="MYR" />
          <PayrollDetail label="Effective date" value="Not tracked" />
        </div>
        <p className={styles.policyNote}>
          This is the current setup, not salary history. Existing Payroll Runs
          retain their own pay-basis and base-rate snapshots.
        </p>
      </section>

      <section className={styles.profilePanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Payroll work target</p>
            <h3>Calculation inputs</h3>
            <p>Paid work and break targets used to prepare future drafts.</p>
          </div>
          <span>Current policy</span>
        </div>
        <div className={styles.detailList}>
          <PayrollDetail
            label="Normal working days / month"
            value={`${data.workingDaysPerMonth} days`}
          />
          <PayrollDetail
            label="Paid work target / day"
            value={formatMinutes(data.normalWorkMinutesPerDay)}
          />
          <PayrollDetail
            label="Expected break / day"
            value={formatMinutes(data.targetBreakMinutes)}
          />
          <PayrollDetail
            label="Planned span / day"
            value={formatMinutes(plannedSpanMinutes)}
          />
        </div>
        <div className={styles.policyNote}>
          Paid work target: {data.normalWorkPolicySource}. Expected break: {data.targetBreakPolicySource}.
          These targets do not classify attendance as overtime.
        </div>
      </section>
    </>
  );
}

function StatutoryPanel({
  result,
}: {
  result: Extract<
    EmployeeStatutoryProfileResult,
    { status: "READY" }
  >["statutory"];
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
  return (
    <section className={styles.profilePanel}>
      <div className={styles.panelHeading}>
        <div>
          <p className={styles.eyebrow}>Statutory contributions</p>
          <h3>Contribution profile</h3>
          <p>Current participation settings and masked membership identifiers.</p>
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
            data.epfMemberNumberMasked,
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
              ? formatNullableEnum(data.socsoCategory)
              : "Not applicable"
          }
        />
        <PayrollDetail
          label="SOCSO member number"
          value={formatEnrollmentValue(
            data.socsoEnabled,
            data.socsoMemberNumberMasked,
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
        <PayrollDetail
          label="LINDUNG 24"
          value={data.lindung24OptIn ? "Opted in" : "Not opted in"}
        />
      </div>
      <p className={styles.policyNote}>
        Identifiers remain masked in Employee Profile. Contribution amounts are
        calculated and reviewed in individual Payroll Runs.
      </p>
    </section>
  );
}

function TaxPanel({
  result,
}: {
  result: Extract<
    EmployeeStatutoryProfileResult,
    { status: "READY" }
  >["tax"];
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
          <p className={styles.eyebrow}>Tax & submission identity</p>
          <h3>Submission identifiers</h3>
          <p>Masked identity values used for official payroll submissions.</p>
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
          value={data.identityNumberMasked ?? "Not configured"}
        />
        <PayrollDetail
          label="LHDN country code"
          value={data.countryCode ?? "Not configured"}
        />
        <PayrollDetail
          label="Tax Identification Number"
          value={data.tinMasked ?? "Not configured"}
        />
        <PayrollDetail
          label="Profile last updated"
          value={formatDate(data.profileUpdatedAt)}
        />
      </div>
      <p className={styles.policyNote}>
        Full identity and tax numbers are not returned to this read-only profile.
        Editing remains in the existing authorized payroll administration flow.
      </p>
    </section>
  );
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
