import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function TeamApprovalsLoading() {
  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`} aria-busy="true" aria-label="Loading approvals">
      <div className={`${staffV2Styles.skeleton} ${styles.skeletonHeader}`} />
      <div className={`${staffV2Styles.skeleton} ${styles.skeletonTabs}`} />
      <div className={styles.filterStrip}>
        <div className={`${staffV2Styles.skeleton} ${styles.skeletonTabs}`} />
        <div className={`${staffV2Styles.skeleton} ${styles.skeletonTabs}`} />
        <div className={`${staffV2Styles.skeleton} ${styles.skeletonTabs}`} />
      </div>
      {[0, 1, 2].map((item) => <div className={`${staffV2Styles.skeleton} ${styles.skeletonRow}`} key={item} />)}
    </section>
  );
}
