import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { DashboardPageHeader } from '../../components/dashboard-page-header';
import { DashboardShell } from '../../components/dashboard-shell';
import { AgentsIcon } from '../../components/icons';
import { WORKSPACE_ONBOARDING_PATH } from '../../lib/auth/paths';
import {
  type OverviewAgent,
  type OverviewData,
  loadOverviewData,
} from '../../lib/dashboard/load-overview';
import {
  overviewReadinessStatusLabel,
  selectOverviewAgentPreview,
  type OverviewReadinessItem,
} from '../../lib/dashboard/overview-readiness';
import {
  formatMinutes,
  usageCapStatusLabel,
} from '../../lib/usage/format';

export const dynamic = 'force-dynamic';

type AuthenticatedOverview = Extract<OverviewData, { kind: 'authenticated' }>;

const OVERVIEW_AGENT_PREVIEW_LIMIT = 3;

function OverviewEmptyState({
  heading,
  icon,
  text,
}: {
  heading: string;
  icon: ReactNode;
  text: string;
}) {
  return (
    <div className="empty-state overview-empty-state">
      <div className="empty-state-icon">{icon}</div>
      <h3 className="empty-state-heading">{heading}</h3>
      <p className="empty-state-text">{text}</p>
    </div>
  );
}

function ReadinessPanel({
  items,
  status,
  completedCount,
  totalCount,
}: {
  completedCount: number;
  items: OverviewReadinessItem[];
  status: AuthenticatedOverview['readiness']['status'];
  totalCount: number;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Workspace readiness</h2>
          <p className="panel-subtitle">
            {completedCount} of {totalCount} setup checks complete
          </p>
        </div>
        <span className={`status-pill status-pill-readiness-${status}`}>
          <span className="status-dot" />
          {overviewReadinessStatusLabel(status)}
        </span>
      </div>

      <ul className="overview-readiness-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              className={
                item.complete
                  ? 'overview-readiness-item overview-readiness-item-complete'
                  : 'overview-readiness-item overview-readiness-item-incomplete'
              }
              href={item.href}
            >
              <span className="overview-readiness-mark" aria-hidden="true">
                {item.complete ? '✓' : '○'}
              </span>
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentsPanel({ agents }: { agents: OverviewAgent[] }) {
  const previewAgents = selectOverviewAgentPreview(
    agents,
    OVERVIEW_AGENT_PREVIEW_LIMIT,
  );

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Agents</h2>
          <p className="panel-subtitle">
            {previewAgents.length > 0
              ? `Displaying only ${previewAgents.length} agent${
                  previewAgents.length === 1 ? '' : 's'
                }`
              : 'No agents yet'}
          </p>
        </div>
        <div className="overview-panel-actions">
          {agents.length === 0 ? (
            <Link className="button" href="/dashboard/agents/new">
              Create agent
            </Link>
          ) : (
            <Link className="button-secondary" href="/dashboard/agents">
              View all
            </Link>
          )}
        </div>
      </div>

      {previewAgents.length > 0 ? (
        <div className="agent-list">
          {previewAgents.map((agent) => (
            <Link
              className="agent-row agent-row-link"
              href={`/dashboard/agents/${agent.id}`}
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
        <OverviewEmptyState
          heading="No agents yet"
          icon={<AgentsIcon />}
          text="Create a voice agent to start browser testing for this workspace."
        />
      )}
    </section>
  );
}

function NextStepsPanel({ overview }: { overview: AuthenticatedOverview }) {
  const incomplete = overview.readiness.items.filter((item) => !item.complete);
  const latestConversation = overview.recentConversations[0] ?? null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Next steps</h2>
          <p className="panel-subtitle">Suggested actions for this workspace</p>
        </div>
      </div>

      <ul className="overview-next-steps">
        {incomplete[0] ? (
          <li>
            <Link className="table-link" href={incomplete[0].href}>
              Finish setup: {incomplete[0].label.toLowerCase()}
            </Link>
          </li>
        ) : (
          <li>
            <span className="muted-copy">Workspace setup looks complete.</span>
          </li>
        )}

        {overview.primaryTestAgentId ? (
          <li>
            <Link
              className="table-link"
              href={`/dashboard/agents/${overview.primaryTestAgentId}?test=true`}
            >
              Test an active agent in the browser
            </Link>
          </li>
        ) : (
          <li>
            <Link className="table-link" href="/dashboard/agents">
              Activate or create an agent to test
            </Link>
          </li>
        )}

        {latestConversation ? (
          <li>
            <Link className="table-link" href={latestConversation.href}>
              Review the latest conversation
            </Link>
          </li>
        ) : (
          <li>
            <Link className="table-link" href="/dashboard/conversations">
              Open conversations after your first test
            </Link>
          </li>
        )}

        {overview.notificationCount > 0 ? (
          <li>
            <Link className="table-link" href="/dashboard/notifications">
              Review {overview.notificationCount} notification
              {overview.notificationCount === 1 ? '' : 's'}
            </Link>
          </li>
        ) : null}
      </ul>
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
          subtitle="The portal could not finish loading the workspace overview."
          title="Workspace unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{overview.message}</div>
            <p className="muted-copy">
              Sign out and back in, then try again. If this continues, check
              that your account still belongs to a tenant.
            </p>
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (overview.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  const headerAction = overview.primaryTestAgentId ? (
    <Link
      className="button"
      href={`/dashboard/agents/${overview.primaryTestAgentId}?test=true`}
    >
      Test agent
    </Link>
  ) : overview.agents.length === 0 ? (
    <Link className="button" href="/dashboard/agents/new">
      Create agent
    </Link>
  ) : (
    <Link className="button" href="/dashboard/agents">
      Manage agents
    </Link>
  );

  return (
    <DashboardShell
      currentSection="overview"
      email={overview.email}
      membershipRole={overview.membershipRole}
      tenantName={overview.tenantName}
    >
      <DashboardPageHeader
        action={headerAction}
        subtitle={
          overview.businessName
            ? `Status and recent activity for ${overview.businessName}.`
            : 'Status, readiness, and recent activity for this workspace.'
        }
        title="Overview"
      />

      <div className="overview-grid">
        <div className="stat-grid overview-stat-grid">
          <Link className="stat-card stat-card-link" href="/dashboard/usage">
            <div className="stat-label">Sessions this month</div>
            <div className="stat-value">{overview.usage.sessionCount}</div>
            <div className="stat-detail">From completed and failed tests</div>
          </Link>

          <Link className="stat-card stat-card-link" href="/dashboard/usage">
            <div className="stat-label">Connected minutes</div>
            <div className="stat-value">
              {formatMinutes(overview.usage.connectedMinutes)} /{' '}
              {overview.usage.capMinutes}
            </div>
            <div className="stat-detail">
              {usageCapStatusLabel(overview.usage.capStatus)} ·{' '}
              {overview.usage.usedPercent}% of monthly budget
            </div>
          </Link>

          <Link className="stat-card stat-card-link" href="/dashboard/agents">
            <div className="stat-label">Active agents</div>
            <div className="stat-value">
              {overview.activeAgentCount}
              <span className="stat-value-suffix">
                {' '}
                / {overview.agents.length}
              </span>
            </div>
            <div className="stat-detail">
              {overview.pausedAgentCount > 0
                ? `${overview.pausedAgentCount} paused`
                : 'Ready for browser testing'}
            </div>
          </Link>

          <Link
            className="stat-card stat-card-link"
            href="/dashboard/notifications"
          >
            <div className="stat-label">Notifications</div>
            <div className="stat-value">{overview.notificationCount}</div>
            <div className="stat-detail">Close-off notices in this workspace</div>
          </Link>
        </div>

        <div className="overview-split-grid">
          <ReadinessPanel
            completedCount={overview.readiness.completedCount}
            items={overview.readiness.items}
            status={overview.readiness.status}
            totalCount={overview.readiness.totalCount}
          />
          <NextStepsPanel overview={overview} />
        </div>

        <AgentsPanel agents={overview.agents} />
      </div>
    </DashboardShell>
  );
}
