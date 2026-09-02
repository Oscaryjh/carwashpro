"use client";

import { useEffect } from "react";
import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-timesheet-v2.module.css";

export default function StaffTimesheetError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[staff-timesheet] Unable to load monthly work record", error);
  }, [error]);

  return (
    <section className={staffV2Styles.scope}>
      <StaffV2PageHeader
        title="Timesheet & overtime"
        meta="Monthly work results used for review and payroll."
      />
      <div className={staffV2Styles.inlineError} role="alert">
        <span>
          <strong>Timesheet couldn&apos;t load.</strong>
          <small>Please check your connection and try again.</small>
        </span>
        <button className={styles.retry} onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
