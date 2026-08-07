import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../../components/dashboard-page-header';
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
        <DashboardPageHeader
          eyebrow="Agents"
          subtitle="The portal could not prepare the new agent workspace."
          title="New agent unavailable"
        />

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
      <DashboardPageHeader
        eyebrow="Agents"
        subtitle="Configure how this agent introduces itself, speaks, and behaves when talking with customers."
        title="Create agent"
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">New agent settings</h2>
            <div style={{ marginTop: '6px' }}>
              <span className="business-badge">
                Business: {pageData.businessName ?? 'Missing'}
              </span>
            </div>
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
