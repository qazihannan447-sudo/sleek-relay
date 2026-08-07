import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildConversationFiltersHref,
  conversationStatuses,
  formatConversationDuration,
  type ConversationFilterInput,
  type NormalizedConversationFilters,
} from '../../../lib/conversations/helpers';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { loadConversationsPageData } from '../../../lib/conversations/load-conversations';
import { loadConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';
import { CustomSelect } from '../agents/custom-select';
import { DatePicker } from '../../../components/date-picker';
import { ConversationDetailDrawer } from './conversation-detail-drawer';
import { ConversationTableRow } from './conversation-table-row';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

type ConversationsPageProps = {
  searchParams: Promise<ConversationFilterInput & { conversationId?: string | string[] }>;
};

function LogoutButton() {
  return (
    <form action={logout}>
      <button className="button-danger" type="submit">
        Log out
      </button>
    </form>
  );
}

function formatValue(value: string | null) {
  return value?.trim() ? value : 'Not set';
}

function FiltersPanel({
  agents,
  filters,
}: {
  agents: { id: string; name: string }[];
  filters: NormalizedConversationFilters;
}) {
  const statusOptions = [
    { label: 'All statuses', value: '' },
    ...conversationStatuses.map((status) => ({
      label: status.charAt(0).toUpperCase() + status.slice(1),
      value: status,
    })),
  ];

  const agentOptions = [
    { label: 'All agents', value: '' },
    ...agents.map((agent) => ({
      label: agent.name,
      value: agent.id,
    })),
  ];

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">Filters</h2>
          <p className="panel-subtitle">
            Filters are resolved server-side inside the authenticated tenant scope.
          </p>
        </div>
      </div>

      <form className="filter-form" method="get">
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="conversation-status-filter">Status</label>
            <CustomSelect
              id="conversation-status-filter"
              name="status"
              options={statusOptions}
              value={filters.status ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-agent-filter">Agent</label>
            <CustomSelect
              id="conversation-agent-filter"
              name="agent"
              options={agentOptions}
              value={filters.agentId ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-from-filter">From</label>
            <DatePicker
              id="conversation-from-filter"
              name="from"
              placeholder="mm/dd/yyyy"
              value={filters.from ?? ''}
            />
          </div>

          <div className="field">
            <label htmlFor="conversation-to-filter">To</label>
            <DatePicker
              id="conversation-to-filter"
              name="to"
              placeholder="mm/dd/yyyy"
              value={filters.to ?? ''}
            />
          </div>
          <div className="filter-actions">
            <button className="button" type="submit">
              Apply filters
            </button>
            <Link className="button-secondary" href="/dashboard/conversations">
              Clear filters
            </Link>
          </div>
        </div>
      </form>
    </section>
  );
}

export default async function ConversationsPage({
  searchParams,
}: ConversationsPageProps) {
  const resolvedParams = await searchParams;
  const activeConversationId = Array.isArray(resolvedParams.conversationId)
    ? resolvedParams.conversationId[0]
    : resolvedParams.conversationId;

  const [pageData, detailData] = await Promise.all([
    loadConversationsPageData(resolvedParams),
    activeConversationId
      ? loadConversationDetailPageData(activeConversationId)
      : Promise.resolve(null),
  ]);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fconversations');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="conversations"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          subtitle="The portal could not finish loading the tenant conversation workspace."
          title="Conversations unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{pageData.message}</div>
            <p className="muted-copy">
              The page keeps tenant scoping on the server and still depends on
              row-level security for the final read boundary.
            </p>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  const clearFiltersHref = '/dashboard/conversations';
  const currentListHref = buildConversationFiltersHref(
    clearFiltersHref,
    pageData.filters,
  );
  const previousPageHref = buildConversationFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: Math.max(1, pageData.pagination.page - 1) },
  );
  const nextPageHref = buildConversationFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: pageData.pagination.page + 1 },
  );

  return (
    <DashboardShell
      currentSection="conversations"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        subtitle="Review tenant-scoped browser test conversations, outcomes, and completion reasons without exposing another workspace's data."
        title="Conversations"
      />

      <FiltersPanel agents={pageData.agents} filters={pageData.filters} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Conversation list</h2>
            <p className="panel-subtitle">
              Ordered by newest `started_at` first and limited to the current page.
            </p>
          </div>
          <div className="table-summary">
            {pageData.pagination.totalCount === 0
              ? 'No visible results'
              : `Showing ${pageData.pagination.startIndex}-${pageData.pagination.endIndex} of ${pageData.pagination.totalCount}`}
          </div>
        </div>

        {pageData.emptyState === 'results' ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Agent</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>End reason</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.conversations.map((conversation) => {
                    const isSelected = conversation.id === activeConversationId;
                    const itemDrawerHref = `${currentListHref}${currentListHref.includes('?') ? '&' : '?'}conversationId=${conversation.id}`;

                    return (
                      <ConversationTableRow
                        conversationId={conversation.id}
                        isSelected={isSelected}
                        key={conversation.id}
                      >
                        <td data-label="Started">
                          <Link
                            className="table-link"
                            href={itemDrawerHref}
                            prefetch={true}
                          >
                            {formatTimestamp(conversation.startedAt)}
                          </Link>
                        </td>
                        <td data-label="Agent">{conversation.agentName}</td>
                        <td data-label="Source">{conversation.sourceLabel}</td>
                        <td data-label="Status">
                          <span
                            className={`status-pill status-pill-${conversation.status}`}
                          >
                            <span className="status-dot" />
                            {conversation.statusLabel}
                          </span>
                        </td>
                        <td data-label="Duration">
                          {formatConversationDuration(conversation.durationMs)}
                        </td>
                        <td data-label="Outcome">
                          {formatValue(conversation.outcome)}
                        </td>
                        <td data-label="End reason">
                          {formatValue(conversation.endReason)}
                        </td>
                      </ConversationTableRow>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-row">
              <p className="muted-copy pagination-copy">
                Page {pageData.pagination.page} of {pageData.pagination.totalPages}
              </p>
              <div className="table-actions">
                <Link
                  aria-disabled={!pageData.pagination.hasPreviousPage}
                  className={
                    pageData.pagination.hasPreviousPage
                      ? 'button-secondary'
                      : 'button-secondary button-disabled'
                  }
                  href={
                    pageData.pagination.hasPreviousPage
                      ? previousPageHref
                      : clearFiltersHref
                  }
                  tabIndex={pageData.pagination.hasPreviousPage ? undefined : -1}
                >
                  Previous
                </Link>
                <Link
                  aria-disabled={!pageData.pagination.hasNextPage}
                  className={
                    pageData.pagination.hasNextPage
                      ? 'button-secondary'
                      : 'button-secondary button-disabled'
                  }
                  href={
                    pageData.pagination.hasNextPage ? nextPageHref : clearFiltersHref
                  }
                  tabIndex={pageData.pagination.hasNextPage ? undefined : -1}
                >
                  Next
                </Link>
              </div>
            </div>
          </>
        ) : pageData.emptyState === 'filtered-empty' ? (
          <div className="empty-state">
            <div className="notice">
              No conversations matched the current filters for this tenant.
            </div>
            <Link className="button-secondary" href={clearFiltersHref}>
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              No conversations have been captured for this tenant yet.
            </div>
          </div>
        )}
      </section>

      <ConversationDetailDrawer detailData={detailData} />
    </DashboardShell>
  );
}
