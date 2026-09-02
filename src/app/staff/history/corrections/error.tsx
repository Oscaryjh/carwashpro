"use client";

import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffAttendanceCorrectionsError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <section aria-label="Attendance corrections error" className={staffV2Styles.scope}>
      <StaffV2PageHeader
        title="Attendance corrections"
        meta="Track attendance corrections you've submitted."
      />
      <div className={staffV2Styles.inlineError} role="alert">
        <span>
          <strong>Attendance corrections couldn&apos;t load.</strong>
          <small>Please check your connection and try again.</small>
        </span>
        <button onClick={() => retry()} type="button">Try again</button>
      </div>
    </section>
  );
}
