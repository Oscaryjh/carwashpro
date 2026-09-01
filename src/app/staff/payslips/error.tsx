"use client";

import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import styles from "@/components/staff-pwa/staff-payslips-v2.module.css";

export default function StaffPayslipsError({ reset }: { reset: () => void }) {
  return (
    <section aria-label="Payslips" className={`${staffV2Styles.scope} ${styles.payslips}`}>
      <StaffV2PageHeader meta="Your published pay records." title="Payslips" />
      <div className={staffV2Styles.emptyState} role="alert">
        <strong>Payslips couldn&apos;t load.</strong>
        <span>No stale or unpublished payslip is shown.</span>
        <button className={styles.errorAction} type="button" onClick={reset}>Try again</button>
      </div>
    </section>
  );
}
