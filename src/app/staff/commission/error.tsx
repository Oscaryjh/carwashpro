"use client";

import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-commission-v2.module.css";

export default function StaffCommissionError({ reset }: { reset: () => void }) {
  return (
    <section aria-label="Commission" className={`${staffV2Styles.scope} ${styles.page}`}>
      <StaffV2PageHeader title="Commission" meta="Your commission statements." />
      <div className={staffV2Styles.emptyState} role="alert">
        <strong>Commission couldn&apos;t load.</strong>
        <span>No amount has been changed.</span>
        <button className={styles.errorAction} onClick={reset} type="button">Try again</button>
      </div>
    </section>
  );
}
