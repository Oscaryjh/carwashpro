"use client";

export default function StaffAppError({ reset }: { reset: () => void }) {
  return (
    <section className="staff-section-hero staff-system-state" role="alert" aria-labelledby="staff-app-error-heading">
      <p>UNAVAILABLE</p>
      <h1 id="staff-app-error-heading">This page could not be loaded</h1>
      <p>Check your connection, then try again.</p>
      <button type="button" className="staff-secondary-button" onClick={reset}>Try again</button>
    </section>
  );
}
