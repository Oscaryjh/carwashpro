import styles from "./workspace.module.css";

export default function PayrollWorkspaceLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading Payroll Workspace"
      className={`content hr-module-page ${styles.page}`}
    >
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>HR &amp; Payroll</p>
          <h1>Payroll Workspace</h1>
          <p>Loading the current payroll state.</p>
        </div>
      </header>
      <section className={styles.loadingPanel}>
        <span className={`${styles.loadingLine} ${styles.loadingLineShort}`} />
        <span className={styles.loadingLine} />
        <span className={`${styles.loadingLine} ${styles.loadingLineMedium}`} />
      </section>
      <section className={styles.loadingGrid} aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <span className={styles.loadingTile} key={index} />
        ))}
      </section>
      <section className={styles.loadingPanel} aria-hidden="true">
        <span className={`${styles.loadingLine} ${styles.loadingLineShort}`} />
        <span className={styles.loadingLine} />
      </section>
    </main>
  );
}
