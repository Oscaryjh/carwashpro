"use client";

import { useEffect } from "react";
import styles from "@/components/staff-pwa/staff-approval-center-v2.module.css";
import { StaffV2PageHeader, staffV2Styles } from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffAttendanceApprovalsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section aria-label="Attendance approvals error" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Attendance" meta="Review missing punches and submitted time corrections." />
      <div className={staffV2Styles.inlineError} role="alert">
        <span><strong>Attendance approvals couldn&apos;t load.</strong><small>No decision was changed. Check your connection and try again.</small></span>
        <button onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
