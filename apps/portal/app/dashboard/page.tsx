import { redirect } from 'next/navigation';

import { DashboardShell } from '../../components/dashboard-shell';
import {
  type OverviewAgent,
  loadOverviewData,
} from '../../lib/dashboard/load-overview';
import { logout } from './actions';

export const dynamic = 'force-dynamic';

function LogoutButton() {
  return (
    <form action={logout}>
      <button className="button-danger" type="submit">
        Log out
      </button>
    </form>
  );
}

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
            <div key={agent.id} className="agent-row">
              <div>
                <p className="agent-name">{agent.name}</p>
                <p className="agent-role">
                  {agent.role} / {agent.language.toUpperCase()}
                </p>
              </div>
              <span className={`status-pill status-pill-${agent.status}`}>
                <span className="status-dot" />
                {agent.status}
              </span>
            </div>
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
        <div className="page-header">
          <p className="eyebrow">Overview</p>
          <h1 className="page-title">Workspace unavailable</h1>
          <p className="page-subtitle">
            The portal could not finish loading the authenticated overview.
          </p>
        </div>

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{overview.message}</div>
            <p className="muted-copy">
              This phase intentionally uses only the signed-in user session and
              RLS-backed reads. No service-role fallback is enabled.
            </p>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (overview.kind === 'missing-membership') {
    return (
      <DashboardShell
        currentSection="overview"
        email={overview.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Overview</p>
          <h1 className="page-title">No tenant membership found</h1>
          <p className="page-subtitle">
            Your sign-in is valid, but no accessible tenant membership was
            returned through RLS.
          </p>
        </div>

        <section className="panel">
          <div className="empty-state">
            <div className="notice">
              Ask an administrator to provision a tenant membership for{' '}
              <strong>{overview.email}</strong>.
            </div>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      currentSection="overview"
      email={overview.email}
      membershipRole={overview.membershipRole}
      tenantName={overview.tenantName}
    >
      <div className="page-header">
        <p className="eyebrow">Overview</p>
        <h1 className="page-title">Authenticated tenant overview</h1>
        <p className="page-subtitle">
          Basic verification data for the current signed-in user and tenant
          scope.
        </p>
      </div>

      <div className="overview-grid">
        <div className="overview-top-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2 className="panel-title">Session and tenant context</h2>
                <p className="panel-subtitle">
                  Loaded server-side using Supabase SSR and row-level security.
                </p>
              </div>
              <LogoutButton />
            </div>

            <div className="kv-list">
              <div className="kv-row">
                <span className="kv-label">Signed-in email</span>
                <span className="kv-value">{overview.email}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Tenant name</span>
                <span className="kv-value">{overview.tenantName}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Tenant slug</span>
                <span className="kv-value">{overview.tenantSlug}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Membership role</span>
                <span className="kv-value">{overview.membershipRole}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Business configuration</span>
                <span className="kv-value">
                  {overview.businessName ?? 'Missing business configuration'}
                </span>
              </div>
            </div>
          </section>

          <section className="shell-card">
            <div className="panel-heading">
              <div>
                <h2 className="panel-title">Current scope</h2>
                <p className="panel-subtitle">
                  Overview and Business Configuration are the active dashboard
                  sections in this phase.
                </p>
              </div>
            </div>
            <div className="notice notice-success">
              Login, logout, cookie-based auth, proxy refresh, protected
              routing, and RLS-backed reads are active.
            </div>
            <p className="muted-copy" style={{ margin: '18px 0 0' }}>
              Business Configuration now supports shared tenant profile viewing
              and editing. Agents and Conversations remain placeholder
              navigation items until later phases.
            </p>
          </section>
        </div>

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
