"use client";

export default function AttendanceResolutionError({ reset }: { reset: () => void }) {
  return (
    <section className="content hr-module-page">
      <header className="page-header hr-module-header">
        <div><h1>Attendance Resolution Queue</h1><p>Unable to load resolution cases.</p></div>
      </header>
      <button onClick={reset} type="button">Try again</button>
    </section>
  );
}
