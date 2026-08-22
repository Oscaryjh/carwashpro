"use client";

import { useEffect } from "react";

export default function StaffTimesheetError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[staff-timesheet] Unable to load monthly work record", error);
  }, [error]);

  return (
    <section className="staff-timesheet-page">
      <header className="staff-page-title staff-section-hero">
        <p>Timesheet</p>
        <h1>Monthly work record</h1>
      </header>
      <div className="staff-timesheet-error staff-page-card" role="alert">
        <strong>Unable to load work records</strong>
        <p>Check your connection and try again.</p>
        <button onClick={reset} type="button">Try again</button>
      </div>
    </section>
  );
}
