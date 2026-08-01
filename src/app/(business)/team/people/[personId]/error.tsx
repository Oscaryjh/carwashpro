"use client";

import Link from "next/link";
import styles from "@/components/employee-profile-shell.module.css";

export default function EmployeeProfileError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.page}>
      <section className={styles.state} data-tone="denied" role="alert">
        <span aria-hidden="true" className={styles.stateIcon}>!</span>
        <div>
          <p className={styles.eyebrow}>Profile error</p>
          <h2>Employee profile could not be loaded</h2>
          <p>No employee or sensitive payroll data was changed. Retry the request or return to People.</p>
          <div className={styles.errorActions}>
            <button onClick={reset} type="button">Try again</button>
            <Link href="/team?section=people">Back to People</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
