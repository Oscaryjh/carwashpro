import styles from "./employee.module.css";

export default function AttendanceEmployeesLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.loadingHeader}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonTitle} />
        <span className={styles.skeletonLine} />
      </div>
      <div className={styles.loadingPanel}>
        <span className={styles.spinner} aria-hidden="true" />
        <strong>Loading employees...</strong>
        <p>Checking your business and branch scope.</p>
      </div>
    </main>
  );
}
