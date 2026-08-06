export default function BusinessConfigurationLoading() {
  return (
    <main className="dashboard-content">
      <div className="page-header">
        <p className="eyebrow">Business Configuration</p>
        <h1 className="page-title">Loading business configuration</h1>
        <p className="page-subtitle">
          Fetching the current tenant profile through the authenticated session.
        </p>
      </div>
      <section className="panel">
        <div className="notice">Loading shared business configuration...</div>
      </section>
    </main>
  );
}
