"use client";

export default function StaffOvertimeError({ reset }: { reset: () => void }) {
  return <section className="staff-overtime-page"><div className="staff-page-card staff-overtime-empty" role="alert"><strong>Overtime reviews could not be loaded</strong><span>No decision was changed. Check your connection and load the latest Attendance results again.</span><button onClick={reset} type="button">Try again</button></div></section>;
}
