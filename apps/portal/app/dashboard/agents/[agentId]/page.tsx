import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../../components/dashboard-shell';
import { ToastNotification } from '../../../../components/toast-notification';
import { ArrowLeftIcon } from '../../../../components/icons';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { loadAgentDetailPageData } from '../../../../lib/agents/load-agents';
import { AgentEditorProvider } from '../agent-editor-state';
import { AgentForm } from '../agent-form';
import { AgentHeaderActions } from '../agent-header-actions';
import { AgentTestDrawer } from '../agent-test-drawer';
import { VoiceConnectWarmup } from '../voice-connect-warmup';

export const dynamic = 'force-dynamic';

type AgentDetailPageProps = {
  params: Promise<{
    agentId: string;
  }>;
  searchParams: Promise<{
    name?: string;
    saved?: string;
    test?: string | string[];
  }>;
};

export default async function AgentDetailPage({
  params,
  searchParams,
}: AgentDetailPageProps) {
  const { agentId } = await params;
  const resolvedSearchParams = await searchParams;
  const isTestOpen = resolvedSearchParams.test === 'true';

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
          <div className="notice notice-danger notice-full">
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
      <AgentEditorProvider>
        {resolvedSearchParams.saved ? (
          <ToastNotification
            message={`Agent "${resolvedSearchParams.name || pageData.values.name || 'Agent'}" saved successfully!`}
          />
        ) : null}
        <div className="page-header">
          <div className="header-title-row">
            <Link
              aria-label="Back to agents"
              className="table-action-icon-button"
              href="/dashboard/agents"
              title="Back to agents"
            >
              <ArrowLeftIcon />
            </Link>
            <h1 className="page-title">{pageData.values.name || 'Agent detail'}</h1>
          </div>
          <div className="page-header-subtitle-row">
            <p className="page-subtitle">
              Review and edit agent-specific runtime settings without mixing shared
              business configuration into the agent record.
            </p>
            <AgentHeaderActions
              agentId={pageData.agentId}
              canEdit={pageData.canManageAgents}
              formId="agent-configuration-form"
              isActive={pageData.values.status === 'active'}
              saveLabel={pageData.agentId ? 'Save agent' : 'Create agent'}
            />
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
            handoffDestinationType={pageData.handoffDestinationType}
            initialVoiceName={pageData.voiceName}
          />
        </section>

        {pageData.agentId && pageData.values.status === 'active' ? (
          <VoiceConnectWarmup agentId={pageData.agentId} />
        ) : null}

        {isTestOpen && pageData.agentId && (
          <AgentTestDrawer
            agent={{
              fallbackMessage: pageData.values.fallbackMessage,
              greeting: pageData.values.greeting,
              id: pageData.agentId,
              language: pageData.values.language,
              name: pageData.values.name || 'Unnamed agent',
              role: pageData.values.role || 'Unassigned role',
              specialInstructions: pageData.values.specialInstructions,
              status: pageData.values.status,
              tone: pageData.values.tone,
              voiceId: pageData.values.voiceId,
            }}
          />
        )}
      </AgentEditorProvider>
    </DashboardShell>
  );
}

