"use client";

import { useEffect } from "react";
import { StaffV2PageHeader, staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-schedule-v2.module.css";

export default function StaffRosterError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[staff-schedule] Unable to load schedule", error);
  }, [error]);

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Schedule" meta="Your expected work and approved time away." />
      <div className={styles.errorState} role="alert">
        <strong>Unable to load schedule</strong>
        <p>Check your connection and try again.</p>
        <button onClick={reset} type="button">Try again</button>
      </div>
    </section>
  );
}
