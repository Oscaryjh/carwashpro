export default function GroupReportsLoading() {
  return (
    <div className="content group-reports-page" aria-busy="true">
      <div className="group-report-loading">
        <span aria-hidden="true" />
        <h1>Loading group reports</h1>
        <p>Preparing authorized transactions and financial totals.</p>
      </div>
    </div>
  );
}
