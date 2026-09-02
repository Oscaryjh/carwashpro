"use client";

import { useEffect } from "react";
import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-attendance-history-v2.module.css";

export default function StaffAttendanceHistoryError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Staff Attendance History route failed", error);
  }, [error]);

  return (
    <section className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader
        title="Attendance history"
        meta="Your actual clock-ins and worked time."
      />
      <div className={staffV2Styles.inlineError} role="alert">
        <span>
          <strong>Attendance couldn&apos;t load.</strong>
          <small>Please check your connection and try again.</small>
        </span>
        <button className={styles.textButton} onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
