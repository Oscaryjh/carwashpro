"use client";

import Link from "next/link";
import styles from "./workspace.module.css";

export default function PayrollWorkspaceError({ reset }: { reset: () => void }) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>HR &amp; Payroll</p>
          <h1>Payroll Workspace</h1>
        </div>
      </header>
      <section className={`${styles.statePanel} ${styles.errorPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Unable to load</p>
          <h2>Payroll Workspace could not be loaded</h2>
          <p>No stale calculation or employee data is shown. Try again or return later.</p>
          <div className={styles.stateActions}>
            <button onClick={reset} type="button">Try again</button>
            <Link href="/team">Back to HR &amp; Payroll</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
