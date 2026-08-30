export default function StaffRosterLoading() {
  return (
    <section className="staff-roster-page staff-roster-loading" aria-label="Loading schedule" aria-live="polite">
      <div className="staff-roster-skeleton staff-roster-skeleton-hero" />
      <div className="staff-roster-skeleton staff-roster-skeleton-today" />
      <div className="staff-roster-week" aria-hidden="true">
        <div className="staff-roster-skeleton staff-roster-skeleton-week">
          {Array.from({ length: 7 }, (_, index) => (
            <div className="staff-roster-skeleton-row" key={index} />
          ))}
        </div>
      </div>
      <span className="staff-visually-hidden">Loading schedule…</span>
    </section>
  );
}

