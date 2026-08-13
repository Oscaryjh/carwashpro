"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "@/components/hr-payroll-workspace.module.css";

export default function TeamError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className={styles.routeState} role="alert">
      <h1>This workforce page could not be loaded</h1>
      <p>No HR, attendance, payroll or employee data was changed. Try loading the page again.</p>
      <div className={styles.routeStateActions}>
        <button onClick={reset} type="button">Try again</button>
        <Link href="/team">Return to People</Link>
      </div>
    </section>
  );
}
