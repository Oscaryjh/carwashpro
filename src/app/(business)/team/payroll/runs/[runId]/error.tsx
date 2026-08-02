"use client";

import Link from "next/link";
import styles from "../runs.module.css";

export default function PayrollRunDetailError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <section className={`${styles.statePanel} ${styles.errorPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Unable to load</p>
          <h1>This payroll run could not be loaded</h1>
          <p>No stale employee entries or calculation totals are shown.</p>
          <div className={styles.stateActions}>
            <button type="button" onClick={reset}>Try again</button>
            <Link href="/team/payroll/runs">Back to Payroll Runs</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
