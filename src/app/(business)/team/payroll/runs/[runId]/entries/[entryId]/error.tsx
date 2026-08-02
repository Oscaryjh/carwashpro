"use client";

import Link from "next/link";
import styles from "../../../runs.module.css";

export default function PayrollEntryEditorError({ reset }: { reset: () => void }) {
  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <section className={`${styles.statePanel} ${styles.errorPanel}`} role="alert">
        <span className={styles.stateMark} aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Unable to load</p>
          <h2>Payroll entry editor could not be loaded</h2>
          <p>No employee entry was changed.</p>
          <div className={styles.stateActions}>
            <button type="button" onClick={() => reset()}>Try again</button>
            <Link href="/team/payroll/runs">Back to Payroll Runs</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
