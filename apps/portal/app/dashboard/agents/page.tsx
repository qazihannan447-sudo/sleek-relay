import Link from 'next/link';
import { redirect } from 'next/navigation';


import { PrefetchOnIntentLink } from '../../../components/prefetch-on-intent-link';
import { ToastNotification } from '../../../components/toast-notification';
import { DashboardShell } from '../../../components/dashboard-shell';
import { EditIcon, EyeIcon, PauseIcon, PlayIcon } from '../../../components/icons';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { formatTimestamp } from '../../../lib/format-timestamp';
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

type AgentsPageProps = {
  searchParams: Promise<{
    name?: string;
    saved?: string;
  }>;
};

export default async function AgentsPage({ searchParams }: AgentsPageProps) {
  const resolvedSearchParams = await searchParams;
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
          <h1 className="page-title">Agents unavailable</h1>
          <p className="page-subtitle">The portal could not finish loading the tenant agent workspace.</p>
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
      {resolvedSearchParams.saved ? (
        <ToastNotification
          message={
            resolvedSearchParams.saved === 'created'
              ? `Agent "${resolvedSearchParams.name || 'New Agent'}" created successfully!`
              : `Agent "${resolvedSearchParams.name || 'Agent'}" saved successfully!`
          }
        />
      ) : null}
      <div className="page-header">
        <h1 className="page-title">Tenant agents</h1>
        <div className="page-header-subtitle-row">
          <p className="page-subtitle">{`View and manage the tenant-owned agents that share ${
            pageData.businessName ?? 'the current business configuration'
          } for grounded answers.`}</p>
          {pageData.canManageAgents && (
            <Link className="button" href="/dashboard/agents/new">
              Create agent
            </Link>
          )}
        </div>
      </div>

      <section className="panel">
        {pageData.agents.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Agent name</th>
                  <th className="text-left">Role</th>
                  <th className="text-left">Language</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Last updated</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageData.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td className="text-left">
                      <PrefetchOnIntentLink
                        className="table-link"
                        href={`/dashboard/agents/${agent.id}`}
                        prefetch={true}
                        prefetchHref={
                          agent.status === 'active'
                            ? `/dashboard/agents/${agent.id}/test`
                            : undefined
                        }
                      >
                        {agent.name}
                      </PrefetchOnIntentLink>
                    </td>
                    <td className="text-left text-capitalize">{agent.role}</td>
                    <td className="text-left">{agent.language.toUpperCase()}</td>
                    <td className="text-left">
                      <span className={`status-pill status-pill-${agent.status}`}>
                        <span className="status-dot" />
                        {agent.status}
                      </span>
                    </td>
                    <td className="text-left">{formatTimestamp(agent.lastUpdated)}</td>
                    <td className="text-right">
                      <div className="table-actions table-actions-end">
                        <PrefetchOnIntentLink
                          aria-label={
                            pageData.canManageAgents ? 'Edit agent' : 'View agent'
                          }
                          className="table-action-icon-button"
                          href={`/dashboard/agents/${agent.id}`}
                          prefetch={true}
                          prefetchHref={
                            agent.status === 'active'
                              ? `/dashboard/agents/${agent.id}/test`
                              : undefined
                          }
                          title={
                            pageData.canManageAgents ? 'Edit agent' : 'View agent'
                          }
                        >
                          {pageData.canManageAgents ? <EditIcon /> : <EyeIcon />}
                        </PrefetchOnIntentLink>
                        {pageData.canManageAgents ? (
                          <form action={setAgentStatus}>
                            <input name="agentId" type="hidden" value={agent.id} />
                            <input
                              name="status"
                              type="hidden"
                              value={agent.status === 'active' ? 'paused' : 'active'}
                            />
                            <button
                              aria-label={
                                agent.status === 'active'
                                  ? 'Pause agent'
                                  : 'Activate agent'
                              }
                              className="table-action-icon-button table-action-icon-button-danger"
                              title={
                                agent.status === 'active'
                                  ? 'Pause agent'
                                  : 'Activate agent'
                              }
                              type="submit"
                            >
                              {agent.status === 'active' ? (
                                <PauseIcon />
                              ) : (
                                <PlayIcon />
                              )}
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
