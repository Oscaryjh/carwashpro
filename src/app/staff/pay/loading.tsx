import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-pay-hub-v2.module.css";

export default function StaffPayLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Pay" className={`${staffV2Styles.scope} ${styles.payHub}`}>
      <StaffV2PageHeader meta="Your published pay records and earnings." title="Pay" />
      <section aria-labelledby="staff-pay-loading-heading" className={styles.section}>
        <StaffV2SectionLabel id="staff-pay-loading-heading">Current pay</StaffV2SectionLabel>
        <div aria-hidden="true" className={styles.currentPayStack}>
          <div className={styles.loadingPanel}>
            <div className={styles.loadingPeriod} />
            <div className={styles.loadingAmount} />
            <div className={styles.loadingGross} />
          </div>
          <div className={staffV2Styles.skeleton} />
        </div>
      </section>
      <div aria-hidden="true" className={staffV2Styles.stack}>
        <div className={staffV2Styles.skeleton} />
        <div className={staffV2Styles.skeleton} />
      </div>
    </section>
  );
}
