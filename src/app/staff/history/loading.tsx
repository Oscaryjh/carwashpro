import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles as styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffTimeLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Time" className={styles.scope}>
      <StaffV2PageHeader
        meta="Attendance records, corrections and monthly work results."
        title="Time"
      />
      <section>
        <StaffV2SectionLabel>My time</StaffV2SectionLabel>
        <div className={styles.rowGroup}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      </section>
    </section>
  );
}
