"use client";

import { useEffect } from "react";

export default function StaffRosterError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[staff-schedule] Unable to load schedule", error);
  }, [error]);

  return (
    <section className="staff-roster-page">
      <header className="staff-page-title staff-section-hero">
        <p>My roster</p>
        <h1>Schedule</h1>
      </header>
      <div className="staff-roster-error-card staff-page-card" role="alert">
        <strong>Unable to load schedule</strong>
        <p>Check your connection and try again.</p>
        <button className="staff-roster-retry" onClick={retry} type="button">Try again</button>
      </div>
    </section>
  );
}

