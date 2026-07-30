"use client";

import { useEffect } from "react";
import styles from "./employee.module.css";

export default function AttendanceEmployeesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[attendance-employees]", error);
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.errorPanel} role="alert">
        <span aria-hidden="true">!</span>
        <div>
          <p className={styles.eyebrow}>Employee workspace</p>
          <h1>Unable to load employees</h1>
          <p>
            No employee data was changed. Try loading the workspace again.
          </p>
          <button className={styles.primaryButton} onClick={reset} type="button">
            Try again
          </button>
        </div>
      </section>
    </main>
  );
}
