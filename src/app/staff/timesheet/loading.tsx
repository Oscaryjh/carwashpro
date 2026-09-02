export default function StaffTimesheetLoading() {
  return (
    <section className="staff-timesheet-page staff-timesheet-loading" aria-label="Loading monthly work record" aria-live="polite">
      <div className="staff-timesheet-skeleton staff-timesheet-skeleton-hero" />
      <div className="staff-timesheet-skeleton staff-timesheet-skeleton-summary" />
      <div className="staff-timesheet-skeleton staff-timesheet-skeleton-list">
        {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
      </div>
      <span className="staff-visually-hidden">Loading monthly work record…</span>
    </section>
  );
}

