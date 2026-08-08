import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildConversationFiltersHref,
  formatConversationDuration,
  formatConversationOutcomeLabel,
  type ConversationFilterInput,
} from '../../../lib/conversations/helpers';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { loadConversationsPageData } from '../../../lib/conversations/load-conversations';
import { loadConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';
import { ConversationDetailDrawer } from './conversation-detail-drawer';
import { ConversationFiltersForm } from './conversation-filters-form';
import { ConversationTableRow } from './conversation-table-row';
import { ConversationsListRefresh } from './conversations-list-refresh';
import { ConversationsIcon } from '../../../components/icons';
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

function formatOutcome(value: string | null) {
  return formatConversationOutcomeLabel(value);
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
      <ConversationsListRefresh />
      <DashboardPageHeader
        subtitle="Review tenant-scoped browser test conversations, outcomes, and completion reasons without exposing another workspace's data."
        title="Conversations"
      />

      <ConversationFiltersForm agents={pageData.agents} filters={pageData.filters} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Conversation list</h2>
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
                    <th>Est. cost</th>
                    <th>Outcome</th>
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
                            {formatTimestamp(conversation.startedAt, {
                              timeZone: pageData.timezone,
                            })}
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
                        <td data-label="Est. cost">
                          <span
                            className="conversation-est-cost"
                            title="Estimated from connected minutes only. STT, TTS, and token costs are not included yet."
                          >
                            {conversation.estimatedCostLabel}
                          </span>
                        </td>
                        <td data-label="Outcome">
                          {formatOutcome(conversation.outcome)}
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
            <div className="empty-state-icon">
              <ConversationsIcon />
            </div>
            <h3 className="empty-state-heading">No results found</h3>
            <p className="empty-state-text">
              No conversations matched the current filters.
            </p>
            <Link className="button-secondary" href={clearFiltersHref}>
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ConversationsIcon />
            </div>
            <h3 className="empty-state-heading">No conversations yet</h3>
            <p className="empty-state-text">
              Conversations will appear here once a voice agent session has been completed.
            </p>
          </div>
        )}
      </section>

      <ConversationDetailDrawer detailData={detailData} />
    </DashboardShell>
  );
}
