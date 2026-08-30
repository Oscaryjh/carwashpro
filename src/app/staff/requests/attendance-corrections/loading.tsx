export default function AttendanceCorrectionQueueLoading() {
  return (
    <section className="staff-attendance-approval-page" aria-busy="true">
      <header className="staff-approval-header">
        <div><p className="staff-kicker">TEAM ATTENDANCE</p><h1>Attendance</h1></div>
      </header>
      <div className="staff-attendance-approval-loading">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}
