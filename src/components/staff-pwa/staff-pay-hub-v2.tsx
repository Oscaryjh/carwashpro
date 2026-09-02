import {
  StaffV2ActionRow,
  StaffV2CompactSummary,
  StaffV2EmptyState,
  StaffV2ListRow,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  StaffV2StatusBadge,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import { StaffAppIcon } from "@/components/staff-pwa/staff-app-icon";
import styles from "./staff-pay-hub-v2.module.css";

type MoneyValue = number | { toString(): string };

export type StaffPayHubV2Props = Readonly<{
  payrollEnabled: boolean;
  commissionEnabled: boolean;
  latestPayslip: Readonly<{
    id: string;
    periodStart: Date;
    grossPay: MoneyValue;
    netPay: MoneyValue;
  }> | null;
}>;

export function StaffPayHubV2({
  payrollEnabled,
  commissionEnabled,
  latestPayslip,
}: StaffPayHubV2Props) {
  const period = latestPayslip ? formatMonth(latestPayslip.periodStart) : null;

  return (
    <section aria-label="Pay" className={`${staffV2Styles.scope} ${styles.payHub}`}>
      <StaffV2PageHeader
        meta="Your published pay records and earnings."
        title="Pay"
      />

      {payrollEnabled ? (
        <section aria-labelledby="staff-current-pay-heading" className={styles.section}>
          <StaffV2SectionLabel id="staff-current-pay-heading">Current pay</StaffV2SectionLabel>
          {latestPayslip && period ? (
            <div className={styles.currentPayStack}>
              <article aria-label={`Current pay for ${period}`} className={styles.currentPayPanel}>
                <header className={styles.periodHeader}>
                  <h2>{period}</h2>
                  <StaffV2StatusBadge tone="success">Available</StaffV2StatusBadge>
                </header>
                <div aria-label={`Net pay ${formatMoney(latestPayslip.netPay)}`} className={styles.netPay}>
                  <span>Net pay</span>
                  <strong>{formatMoney(latestPayslip.netPay)}</strong>
                </div>
                <StaffV2CompactSummary
                  items={[{
                    label: "Gross pay",
                    value: <span className={styles.grossPay}>{formatMoney(latestPayslip.grossPay)}</span>,
                  }]}
                />
              </article>
              <StaffV2ActionRow
                ariaLabel={`Download ${period} payslip PDF`}
                href={`/staff/payslips/${latestPayslip.id}`}
                leading={<StaffAppIcon name="document" />}
                meta={period}
                title="Download PDF"
              />
            </div>
          ) : (
            <StaffV2EmptyState
              description="Your payslip will appear here when your employer makes it available."
              title="Payslip not available yet."
            />
          )}
        </section>
      ) : null}

      {commissionEnabled ? (
        <section aria-labelledby="staff-pay-earnings-heading" className={styles.section}>
          <StaffV2SectionLabel id="staff-pay-earnings-heading">Earnings</StaffV2SectionLabel>
          <StaffV2RowGroup ariaLabel="Earnings">
            <StaffV2ListRow
              ariaLabel="Open Commission statements"
              href="/staff/commission"
              leading={<StaffAppIcon name="money" />}
              meta="View statements"
              title="Commission"
            />
          </StaffV2RowGroup>
        </section>
      ) : null}

      {payrollEnabled ? (
        <section aria-labelledby="staff-pay-history-heading" className={styles.section}>
          <StaffV2SectionLabel id="staff-pay-history-heading">History</StaffV2SectionLabel>
          <StaffV2RowGroup ariaLabel="Pay history">
            <StaffV2ListRow
              ariaLabel="Open all published Payslips"
              href="/staff/payslips"
              leading={<StaffAppIcon name="document" />}
              meta="View all published payslips"
              title="Payslips"
            />
          </StaffV2RowGroup>
        </section>
      ) : null}

      <p className={styles.privacy}>Your pay information is private to this employee account.</p>
    </section>
  );
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function formatMoney(value: MoneyValue) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(Number(value));
}
