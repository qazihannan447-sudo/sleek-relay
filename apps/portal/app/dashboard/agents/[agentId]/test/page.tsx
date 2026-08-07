import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../../../components/dashboard-page-header';
import { DashboardShell } from '../../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../../lib/auth/paths';
import { loadAgentDetailPageData } from '../../../../../lib/agents/load-agents';
import { VoiceTestPanel } from './voice-test-panel';

export const dynamic = 'force-dynamic';

type AgentVoiceTestPageProps = {
  params: Promise<{
    agentId: string;
  }>;
};

export default async function AgentVoiceTestPage({
  params,
}: AgentVoiceTestPageProps) {
  const { agentId } = await params;
  const pageData = await loadAgentDetailPageData(agentId);

  if (pageData.kind === 'unauthenticated') {
    redirect(`/login?next=%2Fdashboard%2Fagents%2F${agentId}%2Ftest`);
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
          eyebrow="Voice Test"
          subtitle="The selected agent could not be loaded in the current tenant scope."
          title="Voice test unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">
              {pageData.message}
            </div>
            <Link className="button-secondary" href="/dashboard/agents">
              Back to agents
            </Link>
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
        eyebrow="Voice Test"
        subtitle="Validate the local browser voice flow against the existing Pipecat worker without sending any runtime package yet."
        title={`Test ${pageData.values.name || 'agent'}`}
      />

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Agent context</h2>
              <p className="panel-subtitle">
                Loaded with the existing authenticated tenant session and
                row-level security.
              </p>
            </div>
            <Link
              className="button-secondary"
              href={`/dashboard/agents/${agentId}`}
              prefetch={true}
            >
              Back to agent
            </Link>
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Tenant</span>
              <span className="kv-value">{pageData.tenantName}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Membership role</span>
              <span className="kv-value">{pageData.membershipRole}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Shared business configuration</span>
              <span className="kv-value">
                {pageData.businessName ?? 'Missing business configuration'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Agent status</span>
              <span className="kv-value">{pageData.values.status}</span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Local test scope</h2>
              <p className="panel-subtitle">
                This page connects only to the local SmallWebRTC runner at{' '}
                <code>http://localhost:7860</code> through the public runner URL
                environment setting.
              </p>
            </div>
          </div>

          <div className="notice">
            This browser test now creates a tenant-scoped conversation shell
            before the local runner connects. Transcript ingestion,
            finalization, recordings, and usage events still depend on later
            worker-integrated phases.
          </div>
        </section>
      </div>

      <VoiceTestPanel
        agentId={agentId}
        agentLanguage={pageData.values.language}
        agentName={pageData.values.name || 'Unnamed agent'}
        agentRole={pageData.values.role || 'Unassigned role'}
        agentVoiceId={pageData.values.voiceId}
      />
    </DashboardShell>
  );
}
