import type { EmployeeCompensationSectionResult } from "@/lib/team/employee-profile-compensation-read";
import styles from "./employee-profile-shell.module.css";

export function EmployeeProfilePayroll({
  result,
}: {
  result: EmployeeCompensationSectionResult;
}) {
  if (result.status === "ACCESS_DENIED") {
    return (
      <div className={styles.sectionContent}>
        <section className={styles.sectionIntro}>
          <div>
            <p className={styles.eyebrow}>Payroll</p>
            <h2>Compensation access is restricted</h2>
            <p>
              This Payroll tab is available for another payroll responsibility,
              but Pay Setup requires compensation access across the whole business.
            </p>
          </div>
          <span className={styles.scopeBadge}>Restricted</span>
        </section>
        <section className={styles.profilePanel}>
          <div className={styles.profileEmpty}>
            <strong>Pay Setup is not available</strong>
            <p>
              {result.reason === "WHOLE_BUSINESS_SCOPE"
                ? "Payroll compensation requires all-branch access. No salary or work-target data was loaded."
                : "You do not have permission to view employee compensation. No salary or work-target data was loaded."}
            </p>
          </div>
        </section>
      </div>
    );
  }

  if (result.status === "NOT_FOUND") {
    return null;
  }

  const { data } = result;
  const plannedSpanMinutes =
    data.normalWorkMinutesPerDay + data.targetBreakMinutes;

  return (
    <div className={styles.sectionContent}>
      <section className={styles.sectionIntro}>
        <div>
          <p className={styles.eyebrow}>Payroll</p>
          <h2>Compensation profile</h2>
          <p>
            Current pay setup and payroll work targets. Monthly calculations,
            statutory, tax, bank and payment records are not loaded here.
          </p>
        </div>
        <span className={styles.scopeBadge}>Sensitive · Read only</span>
      </section>

      <div className={styles.profileGrid}>
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
      </div>
    </div>
  );
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

function formatEnum(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
