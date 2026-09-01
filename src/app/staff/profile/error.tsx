"use client";

import { useEffect } from "react";
import styles from "@/components/staff-pwa/staff-profile-v2.module.css";
import { StaffV2PageHeader, staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section aria-label="Profile" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Profile" />
      <div className={`${styles.surface} ${styles.errorPanel}`} role="alert">
        <h2>Profile couldn&apos;t load.</h2>
        <p>No unavailable or stale employee data is shown. Check your connection and try again.</p>
        <button className={styles.retryButton} onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
