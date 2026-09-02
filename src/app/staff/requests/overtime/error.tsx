"use client";

import { useEffect } from "react";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { StaffV2PageHeader, staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffOvertimeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section aria-label="Overtime approvals error" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Overtime" meta="Review potential overtime that needs your decision." />
      <div className={staffV2Styles.inlineError} role="alert">
        <span><strong>Overtime reviews couldn&apos;t load.</strong><small>No decision was changed. Check your connection and try again.</small></span>
        <button onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
