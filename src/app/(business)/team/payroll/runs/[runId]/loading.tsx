import styles from "../runs.module.css";

export default function PayrollRunDetailLoading() {
  return (
    <main className={`content hr-module-page ${styles.page}`} aria-busy="true">
      <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
      <div className={`${styles.skeleton} ${styles.skeletonHero}`} />
      <div className={`${styles.skeleton} ${styles.skeletonTable}`} />
      <p className={styles.loadingText}>Loading the payroll run…</p>
    </main>
  );
}
