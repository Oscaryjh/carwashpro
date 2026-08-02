import styles from "./runs.module.css";

export default function PayrollRunsLoading() {
  return (
    <main className={`content hr-module-page ${styles.page}`} aria-busy="true">
      <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
      <div className={`${styles.skeleton} ${styles.skeletonIntro}`} />
      <div className={`${styles.skeleton} ${styles.skeletonTable}`} />
      <p className={styles.loadingText}>Loading payroll run history…</p>
    </main>
  );
}
