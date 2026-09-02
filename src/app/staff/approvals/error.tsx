"use client";

import { useEffect } from "react";
import {
  StaffV2PageHeader,
  staffV2Styles,
} from "@/components/staff-pwa/staff-v2-primitives";
import approvalStyles from "@/components/staff-pwa/staff-approval-center-v2.module.css";

export default function StaffApprovalsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section
      aria-label="Approvals error"
      className={`${staffV2Styles.scope} ${approvalStyles.page}`}
    >
      <StaffV2PageHeader
        title="Approvals"
        meta="Review requests that need your decision."
      />
      <div className={staffV2Styles.inlineError} role="alert">
        <span>
          <strong>Approvals couldn&apos;t load.</strong>
          <small>Please check your connection and try again.</small>
        </span>
        <button onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
