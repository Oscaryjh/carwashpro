"use client";

import { useEffect } from "react";
import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffPayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <section aria-label="Pay error" className={staffV2Styles.scope}>
      <StaffV2PageHeader meta="Your published pay records and earnings." title="Pay" />
      <div className={staffV2Styles.inlineError} role="alert">
        <span>
          <strong>Pay couldn&apos;t load.</strong>
          <small>Try again.</small>
        </span>
        <button onClick={reset} type="button">Try again</button>
      </div>
    </section>
  );
}
