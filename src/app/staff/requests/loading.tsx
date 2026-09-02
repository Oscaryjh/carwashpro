import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles as styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffRequestsLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Requests" className={styles.scope}>
      <StaffV2PageHeader
        meta="Manage your leave, claims and attendance corrections."
        title="Requests"
      />
      <section aria-labelledby="staff-requests-loading-heading">
        <StaffV2SectionLabel id="staff-requests-loading-heading">My requests</StaffV2SectionLabel>
        <div aria-hidden="true" className={styles.stack}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
        </div>
      </section>
    </section>
  );
}
