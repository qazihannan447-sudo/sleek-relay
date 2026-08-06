import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { loadAgentDetailPageData } from '../../../../lib/agents/load-agents';
import { setAgentStatus } from '../actions';
import { AgentForm } from '../agent-form';

export const dynamic = 'force-dynamic';

type AgentDetailPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return 'New unsaved agent';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }

  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default async function AgentDetailPage({
  params,
}: AgentDetailPageProps) {
  const { agentId } = await params;
  const pageData = await loadAgentDetailPageData(agentId);

  if (pageData.kind === 'unauthenticated') {
    redirect(`/login?next=%2Fdashboard%2Fagents%2F${agentId}`);
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  if (pageData.kind !== 'authenticated') {
    return (
      <DashboardShell
        currentSection="agents"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Agents</p>
          <h1 className="page-title">Agent unavailable</h1>
          <p className="page-subtitle">
            The selected agent could not be loaded inside the current tenant
            scope.
          </p>
        </div>

        <section className="panel">
          <div className="notice notice-danger">
            {pageData.message}
          </div>
        </section>
      </DashboardShell>
    );
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
        <h1 className="page-title">{pageData.values.name || 'Agent detail'}</h1>
        <p className="page-subtitle">
          Review and edit agent-specific runtime settings without mixing shared
          business configuration into the agent record.
        </p>
      </div>

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Agent context</h2>
              <p className="panel-subtitle">
                Tenant-scoped server load through RLS and the authenticated
                Supabase session.
              </p>
            </div>
            <Link className="button-secondary" href="/dashboard/agents">
              Back to agents
            </Link>
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
              <span className="kv-label">Status</span>
              <span className="kv-value">{pageData.values.status}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Last updated</span>
              <span className="kv-value">
                {formatTimestamp(pageData.lastUpdated)}
              </span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Quick controls</h2>
              <p className="panel-subtitle">
                Owners and admins may activate or pause the selected agent.
              </p>
            </div>
          </div>

          {pageData.agentId ? (
            <Link
              className="button-secondary"
              href={`/dashboard/agents/${pageData.agentId}/test`}
              prefetch={true}
            >
              Test Agent
            </Link>
          ) : null}

          {pageData.canManageAgents && pageData.agentId ? (
            <form action={setAgentStatus} className="inline-form">
              <input name="agentId" type="hidden" value={pageData.agentId} />
              <input
                name="status"
                type="hidden"
                value={pageData.values.status === 'active' ? 'paused' : 'active'}
              />
              <button className="button" type="submit">
                {pageData.values.status === 'active' ? 'Pause agent' : 'Activate agent'}
              </button>
            </form>
          ) : (
            <div className="notice">
              Your role may review this agent but cannot change its status.
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Agent settings</h2>
            <p className="panel-subtitle">
              Agent-specific fields only. Shared business facts stay in Business
              Configuration.
            </p>
          </div>
        </div>

        <AgentForm
          agentId={pageData.agentId}
          canEdit={pageData.canManageAgents}
          defaultValues={pageData.values}
        />
      </section>
    </DashboardShell>
  );
}
