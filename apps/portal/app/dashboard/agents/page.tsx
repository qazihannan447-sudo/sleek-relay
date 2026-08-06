import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { logout } from '../actions';
import { loadAgentsPageData } from '../../../lib/agents/load-agents';
import { setAgentStatus } from './actions';

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

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default async function AgentsPage() {
  const pageData = await loadAgentsPageData();

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fagents');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="agents"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Agents</p>
          <h1 className="page-title">Agents unavailable</h1>
          <p className="page-subtitle">
            The portal could not finish loading the tenant agent workspace.
          </p>
        </div>

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{pageData.message}</div>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  return (
    <DashboardShell
      currentSection="agents"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <div className="page-header">
        <p className="eyebrow">Agents</p>
        <h1 className="page-title">Tenant agents</h1>
        <p className="page-subtitle">
          View and manage the tenant-owned agents that share{' '}
          {pageData.businessName ?? 'the current business configuration'} for
          grounded answers.
        </p>
      </div>

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Tenant agent inventory</h2>
              <p className="panel-subtitle">
                Loaded server-side using the authenticated Supabase session and
                row-level security.
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Tenant</span>
              <span className="kv-value">{pageData.tenantName}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Shared business configuration</span>
              <span className="kv-value">
                {pageData.businessName ?? 'Missing business configuration'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Membership role</span>
              <span className="kv-value">{pageData.membershipRole}</span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Access rules</h2>
              <p className="panel-subtitle">
                Members have read-only access. Owners and admins may create,
                edit, activate, and pause agents.
              </p>
            </div>
          </div>
          {pageData.canManageAgents ? (
            <Link className="button" href="/dashboard/agents/new">
              Create agent
            </Link>
          ) : (
            <div className="notice">
              Your role may review agents but cannot change tenant agent
              settings.
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Agent table</h2>
            <p className="panel-subtitle">
              Each agent remains tenant-scoped and uses the shared business
              profile separately from its own runtime settings.
            </p>
          </div>
        </div>

        {pageData.agents.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agent name</th>
                  <th>Role</th>
                  <th>Language</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageData.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>
                      <Link
                        className="table-link"
                        href={`/dashboard/agents/${agent.id}`}
                        prefetch={true}
                      >
                        {agent.name}
                      </Link>
                    </td>
                    <td>{agent.role}</td>
                    <td>{agent.language.toUpperCase()}</td>
                    <td>
                      <span className={`status-pill status-pill-${agent.status}`}>
                        <span className="status-dot" />
                        {agent.status}
                      </span>
                    </td>
                    <td>{formatTimestamp(agent.lastUpdated)}</td>
                    <td>
                      <div className="table-actions">
                        <Link
                          className="button-secondary table-button"
                          href={`/dashboard/agents/${agent.id}`}
                          prefetch={true}
                        >
                          {pageData.canManageAgents ? 'Edit' : 'View'}
                        </Link>
                        {pageData.canManageAgents ? (
                          <form action={setAgentStatus}>
                            <input name="agentId" type="hidden" value={agent.id} />
                            <input
                              name="status"
                              type="hidden"
                              value={agent.status === 'active' ? 'paused' : 'active'}
                            />
                            <button className="button-danger table-button" type="submit">
                              {agent.status === 'active' ? 'Pause' : 'Activate'}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">No agents exist for this tenant yet.</div>
            {pageData.canManageAgents ? (
              <Link className="button" href="/dashboard/agents/new">
                Create the first agent
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
