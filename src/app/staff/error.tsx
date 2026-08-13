"use client";

export default function StaffAppError({ reset }: { reset: () => void }) {
  return (
    <section className="staff-pwa-card" role="alert" aria-labelledby="staff-app-error-heading">
      <p>Staff App</p>
      <h1 id="staff-app-error-heading">This page could not be loaded</h1>
      <p>No unavailable or stale employee data is shown. Check your connection and try again.</p>
      <button type="button" className="staff-secondary-button" onClick={reset}>Try again</button>
    </section>
  );
}
