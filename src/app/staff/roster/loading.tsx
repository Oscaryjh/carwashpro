import { StaffV2PageHeader, staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-schedule-v2.module.css";

export default function StaffRosterLoading() {
  return (
    <section
      aria-label="Loading schedule"
      aria-live="polite"
      className={`${staffV2Styles.scope} ${styles.page}`}
    >
      <StaffV2PageHeader title="Schedule" meta="Your expected work and approved time away." />
      <div aria-hidden="true" className={styles.navigatorSkeleton} />
      <div aria-hidden="true" className={styles.weekSkeleton}>
        {Array.from({ length: 7 }, (_, index) => (
          <div className={staffV2Styles.skeleton} key={index} />
        ))}
      </div>
      <span className={staffV2Styles.srOnly}>Loading schedule…</span>
    </section>
  );
}
