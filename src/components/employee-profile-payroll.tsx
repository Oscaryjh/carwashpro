import type { EmployeeCompensationSectionResult } from "@/lib/team/employee-profile-compensation-read";
import type { EmployeeStatutoryProfileResult } from "@/lib/team/employee-profile-statutory-read";
import styles from "./employee-profile-shell.module.css";

export function EmployeeProfilePayroll({
  compensation,
  statutoryProfile,
}: {
  compensation: EmployeeCompensationSectionResult;
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
            Current compensation, statutory participation and masked submission
            identifiers. Bank, payment, payslip and Payroll Entry records are not
            loaded here.
          </p>
        </div>
        <span className={styles.scopeBadge}>Sensitive · Read only</span>
      </section>

      <div className={styles.profileGrid}>
        <CompensationPanels result={compensation} />
        <StatutoryPanel result={statutoryProfile.statutory} />
        <TaxPanel result={statutoryProfile.tax} />
      </div>
    </div>
  );
}

function CompensationPanels({
  result,
}: {
  result: Exclude<EmployeeCompensationSectionResult, { status: "NOT_FOUND" }>;
}) {
  if (result.status === "ACCESS_DENIED") {
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
        <span>{data.profileUpdatedAt ? "Profile saved" : "Not configured"}</span>
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
          value={data.epfMemberNumberMasked ?? "Not configured"}
        />
        <PayrollDetail
          label="EPF member before Aug 1998"
          value={data.epfMemberBeforeAug1998 ? "Yes" : "No"}
        />
        <PayrollDetail
          label="SOCSO"
          value={formatParticipation(data.socsoEnabled)}
        />
        <PayrollDetail
          label="SOCSO category"
          value={formatNullableEnum(data.socsoCategory)}
        />
        <PayrollDetail
          label="SOCSO member number"
          value={data.socsoMemberNumberMasked ?? "Not configured"}
        />
        <PayrollDetail
          label="EIS"
          value={formatParticipation(data.eisEnabled)}
        />
        <PayrollDetail
          label="Previously contributed to EIS"
          value={data.eisPreviouslyContributed ? "Yes" : "No"}
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
        <span>{data.profileUpdatedAt ? "Profile saved" : "Not configured"}</span>
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
  return value ? "Enabled" : "Not enabled";
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
