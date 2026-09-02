import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function AttendanceCorrectionQueueLoading() {
  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`} aria-busy="true" aria-label="Loading Attendance approvals">
      <div className={`${staffV2Styles.skeleton} ${styles.skeletonHeader}`} />
      {[0, 1, 2].map((item) => <div className={`${staffV2Styles.skeleton} ${styles.skeletonRow}`} key={item} />)}
    </section>
  );
}
