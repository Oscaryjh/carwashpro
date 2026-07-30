export default function GroupClosingLoading() {
  return (
    <div className="content group-closing-page" aria-busy="true">
      <div className="group-report-loading">
        <span aria-hidden="true" />
        <h1>Loading Closing Audit</h1>
        <p>
          Checking required branch closings and frozen reconciliation records.
        </p>
      </div>
    </div>
  );
}
