import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { loadAgentDetailPageData } from '../../../../lib/agents/load-agents';
import { AgentForm } from '../agent-form';

export const dynamic = 'force-dynamic';

export default async function NewAgentPage() {
  const pageData = await loadAgentDetailPageData(null);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fagents%2Fnew');
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
          <h1 className="page-title">New agent unavailable</h1>
          <p className="page-subtitle">
            The portal could not prepare the new agent workspace.
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
        <h1 className="page-title">Create tenant agent</h1>
        <p className="page-subtitle">
          Add an agent-specific persona and runtime profile while reusing the
          shared business configuration for grounded business answers.
        </p>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">New agent settings</h2>
            <p className="panel-subtitle">
              Shared business configuration: {pageData.businessName ?? 'Missing'}
            </p>
          </div>
          <Link className="button-secondary" href="/dashboard/agents">
            Back to agents
          </Link>
        </div>

        <AgentForm
          agentId={null}
          canEdit={pageData.canManageAgents}
          defaultValues={pageData.values}
        />
      </section>
    </DashboardShell>
  );
}
