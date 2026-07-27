export default function GroupOverviewLoading() {
  return (
    <div className="content group-overview-page" aria-busy="true">
      <header className="page-header">
        <div>
          <p className="eyebrow">Business Group</p>
          <h1>All Stores</h1>
          <p>Loading authorized group performance…</p>
        </div>
      </header>
      <section className="group-report-state">
        <h2>Loading group performance</h2>
        <p>Sales, collections, refunds and store details are being prepared.</p>
      </section>
    </div>
  );
}
