import {
  StaffV2PageHeader,
  StaffV2SectionLabel,
  staffV2Styles as styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffLeaveLoading() {
  return (
    <section aria-busy="true" aria-label="Loading Leave" className={styles.scope}>
      <StaffV2PageHeader title="Leave" meta="Loading balances and requests…" />
      <div className={styles.skeleton} />
      <div>
        <StaffV2SectionLabel>Balances</StaffV2SectionLabel>
        <div className={styles.stack}>{[0, 1].map((row) => <div className={styles.skeleton} key={row} />)}</div>
      </div>
      <div>
        <StaffV2SectionLabel>Recent requests</StaffV2SectionLabel>
        <div className={styles.stack}>{[0, 1, 2].map((row) => <div className={styles.skeleton} key={row} />)}</div>
      </div>
    </section>
  );
}
