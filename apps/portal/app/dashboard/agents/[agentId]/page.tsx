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
          <h1 className="page-title">Agent unavailable</h1>
          <p className="page-subtitle">
            The selected agent could not be loaded inside the current tenant scope.
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
        <h1 className="page-title">{pageData.values.name || 'Agent detail'}</h1>
        <div className="page-header-subtitle-row">
          <p className="page-subtitle">
            Review and edit agent-specific runtime settings without mixing shared
            business configuration into the agent record.
          </p>
          <div className="page-header-actions">
            <Link className="button-secondary" href="/dashboard/agents">
              Back to agents
            </Link>
            {pageData.agentId && (
              <Link
                className="button-secondary"
                href={`/dashboard/agents/${pageData.agentId}/test`}
                prefetch={true}
              >
                Test agent
              </Link>
            )}
            {pageData.canManageAgents && pageData.agentId && (
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
            )}
          </div>
        </div>
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
