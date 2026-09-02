import {
  StaffV2EmptyState,
  StaffV2PageHeader,
  StaffV2RowGroup,
  StaffV2SectionLabel,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "./staff-payslips-v2.module.css";

type MoneyValue = number | { toString(): string };

export type StaffPayslipsV2Props = Readonly<{
  payslips: ReadonlyArray<Readonly<{
    id: string;
    periodStart: Date;
    publishedAt: Date;
    netPay: MoneyValue;
  }>>;
}>;

export function StaffPayslipsV2({ payslips }: StaffPayslipsV2Props) {
  return (
    <section aria-label="Payslips" className={`${staffV2Styles.scope} ${styles.payslips}`}>
      <StaffV2PageHeader
        meta="Your published pay records."
        title="Payslips"
      />

      <section aria-labelledby="staff-published-payslips-heading" className={styles.section}>
        <StaffV2SectionLabel id="staff-published-payslips-heading">
          Published payslips
        </StaffV2SectionLabel>
        {payslips.length ? (
          <StaffV2RowGroup ariaLabel="Published payslips" className={styles.rowGroup}>
            {payslips.map((payslip) => {
              const period = formatMonth(payslip.periodStart);
              const netPay = formatMoney(payslip.netPay);
              return (
                <a
                  aria-label={`Download ${period} payslip PDF, net pay ${netPay}`}
                  className={styles.row}
                  href={`/staff/payslips/${payslip.id}`}
                  key={payslip.id}
                  role="listitem"
                >
                  <span className={styles.rowCopy}>
                    <strong>{period}</strong>
                    <small>Available since {formatDate(payslip.publishedAt)}</small>
                  </span>
                  <span aria-label={`Net pay ${netPay}`} className={styles.amount}>
                    <small>Net pay</small>
                    <strong>{netPay}</strong>
                  </span>
                  <span aria-hidden="true" className={styles.downloadIcon}>
                    <DownloadIcon />
                  </span>
                </a>
              );
            })}
          </StaffV2RowGroup>
        ) : (
          <StaffV2EmptyState
            description="Your published payslips will appear here when they become available."
            title="No payslips available yet."
          />
        )}
      </section>
    </section>
  );
}

function DownloadIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function formatMonth(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
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
