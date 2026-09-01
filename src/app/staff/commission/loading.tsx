import {
  StaffV2PageHeader,
  StaffV2PeriodNavigator,
  StaffV2SectionLabel,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-commission-v2.module.css";

export default function StaffCommissionLoading() {
  return (
    <section aria-busy="true" aria-label="Loading commission" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Commission" meta="Your commission statements." />
      <StaffV2PeriodNavigator
        ariaLabel="Loading commission earning period"
        label="Loading period"
        previousHref={null}
        previousLabel="Previous commission period unavailable while loading"
        nextHref={null}
        nextLabel="Next commission period unavailable while loading"
      />
      <section aria-label="Loading current statement" className={styles.statementSummary}>
        <StaffV2SectionLabel>Current statement</StaffV2SectionLabel>
        <span aria-hidden="true" className={styles.loadingMoney} />
        <span aria-hidden="true" className={styles.loadingBadge} />
      </section>
      <section aria-label="Loading commission breakdown" className={styles.section}>
        <StaffV2SectionLabel>Breakdown</StaffV2SectionLabel>
        <div aria-hidden="true" className={styles.rowGroup}>
          {[0, 1, 2].map((row) => <div className={styles.loadingLine} key={row} />)}
        </div>
      </section>
    </section>
  );
}
