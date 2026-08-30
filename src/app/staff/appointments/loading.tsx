export default function StaffAppointmentsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading appointments" className="staff-appointments-stack staff-appointments-loading">
      <div className="staff-skeleton tall" />
      <div className="staff-skeleton nav" />
      <div className="staff-skeleton row" />
      <div className="staff-skeleton row" />
      <div className="staff-skeleton row" />
    </div>
  );
}

