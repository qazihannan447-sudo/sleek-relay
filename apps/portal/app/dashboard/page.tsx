import { redirect } from 'next/navigation';
import Link from 'next/link';

import { DashboardPageHeader } from '../../components/dashboard-page-header';
import { DashboardShell } from '../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../lib/auth/paths';
import {
  type OverviewAgent,
  loadOverviewData,
} from '../../lib/dashboard/load-overview';

export const dynamic = 'force-dynamic';

function AgentsPanel({ agents }: { agents: OverviewAgent[] }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Tenant agents</h2>
          <p className="panel-subtitle">
            Loaded server-side through tenant-scoped RLS.
          </p>
        </div>
      </div>

      {agents.length > 0 ? (
        <div className="agent-list">
          {agents.map((agent) => (
            <Link
              className="agent-row agent-row-link"
              href="/dashboard/agents"
              key={agent.id}
            >
              <div className="agent-row-copy">
                <p className="agent-name">{agent.name}</p>
                <p className="agent-role">
                  {agent.role} / {agent.language.toUpperCase()}
                </p>
              </div>
              <span className={`status-pill status-pill-${agent.status}`}>
                <span className="status-dot" />
                {agent.status}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="notice">
          No agents are available for this tenant yet.
        </div>
      )}
    </section>
  );
}

export default async function DashboardPage() {
  const overview = await loadOverviewData();

  if (overview.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard');
  }

  if (overview.kind === 'error') {
    return (
      <DashboardShell
        currentSection="overview"
        email={overview.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          eyebrow="Overview"
          subtitle="The portal could not finish loading the authenticated overview."
          title="Workspace unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{overview.message}</div>
            <p className="muted-copy">
              This phase intentionally uses only the signed-in user session and
              RLS-backed reads. No service-role fallback is enabled.
            </p>
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (overview.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  return (
    <DashboardShell
      currentSection="overview"
      email={overview.email}
      membershipRole={overview.membershipRole}
      tenantName={overview.tenantName}
    >
      <DashboardPageHeader
        eyebrow="Overview"
        subtitle="Review the current tenant status, business readiness, and agent availability from one place."
        title="Overview"
      />

      <div className="overview-grid">
        <div className="stat-grid">
          <section className="stat-card">
            <div className="stat-label">Accessible agents</div>
            <div className="stat-value">{overview.agents.length}</div>
            <div className="stat-detail">
              Agents returned by the authenticated tenant query only.
            </div>
          </section>

          <section className="stat-card">
            <div className="stat-label">Business profile</div>
            <div className="stat-value">
              {overview.businessName ? 'Ready' : 'Missing'}
            </div>
            <div className="stat-detail">
              Missing business configuration is handled without breaking the
              page.
            </div>
          </section>
        </div>

        <AgentsPanel agents={overview.agents} />
      </div>
    </DashboardShell>
  );
}
