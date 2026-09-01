"use client";

import { useEffect } from "react";
import {
  StaffV2PageHeader,
  staffV2Styles as styles,
} from "@/components/staff-pwa/staff-v2-primitives";

export default function StaffLeaveError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section aria-label="Leave error" className={styles.scope}>
      <StaffV2PageHeader title="Leave" meta="Balances, requests and time off." />
      <div className={styles.inlineError} role="alert">
        <span><strong>Leave could not load.</strong><small>Try again to reload your balances and requests.</small></span>
        <button onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}
