"use client";

import { useEffect } from "react";
import styles from "./attendance-settings.module.css";

export default function AttendanceSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[attendance-settings]", error);
  }, [error]);

  return (
    <section className={`content ${styles.page}`}>
      <div className={styles.errorState} role="alert">
        <h1>Attendance Settings could not be loaded</h1>
        <p>No settings were changed. Try loading this page again.</p>
        <button onClick={reset} type="button">
          Try again
        </button>
      </div>
    </section>
  );
}
