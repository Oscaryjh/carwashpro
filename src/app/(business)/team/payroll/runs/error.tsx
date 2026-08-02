"use client";

import Link from "next/link";
import styles from "./runs.module.css";

export default function PayrollRunsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <section className={`${styles.statePanel} ${styles.errorPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Unable to load</p>
          <h1>Payroll Runs could not be loaded</h1>
          <p>No stale run or employee calculation data is shown.</p>
          <div className={styles.stateActions}>
            <button type="button" onClick={reset}>Try again</button>
            <Link href="/team/payroll/workspace">Back to Payroll Workspace</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
