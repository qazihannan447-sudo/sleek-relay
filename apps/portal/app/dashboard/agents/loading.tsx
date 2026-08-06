import { DashboardShell } from '../../../components/dashboard-shell';

export default function AgentsLoading() {
  return (
    <DashboardShell
      currentSection="agents"
      email={null}
      membershipRole={null}
      tenantName={null}
    >
      <div className="page-header">
        <p className="eyebrow">Agents</p>
        <h1 className="page-title">Loading agents</h1>
        <p className="page-subtitle">
          Pulling the current tenant agent workspace through server-side
          Supabase access.
        </p>
      </div>

      <section className="panel">
        <div className="notice">Loading the agent management workspace...</div>
      </section>
    </DashboardShell>
  );
}

