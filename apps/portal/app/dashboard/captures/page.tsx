import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { CapturesIcon } from '../../../components/icons';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildCaptureFiltersHref,
  type CaptureFilterInput,
} from '../../../lib/captures/helpers';
import { loadCapturesPageData } from '../../../lib/captures/load-captures';
import { loadConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { ConversationDetailDrawer } from '../conversations/conversation-detail-drawer';
import { ConversationTableRow } from '../conversations/conversation-table-row';
import { CaptureFiltersForm } from './capture-filters-form';
import { CapturesListRefresh } from './captures-list-refresh';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

type CapturesPageProps = {
  searchParams: Promise<CaptureFilterInput & { conversationId?: string | string[] }>;
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

export default async function CapturesPage({ searchParams }: CapturesPageProps) {
  const resolvedParams = await searchParams;
  const activeConversationId = Array.isArray(resolvedParams.conversationId)
    ? resolvedParams.conversationId[0]
    : resolvedParams.conversationId;

  const [pageData, detailData] = await Promise.all([
    loadCapturesPageData(resolvedParams),
    activeConversationId
      ? loadConversationDetailPageData(activeConversationId)
      : Promise.resolve(null),
  ]);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fcaptures');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="captures"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          subtitle="The portal could not finish loading the tenant captures workspace."
          title="Captures unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger notice-full">
              {pageData.message}
            </div>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  const clearFiltersHref = '/dashboard/captures';
  const currentListHref = buildCaptureFiltersHref(
    clearFiltersHref,
    pageData.filters,
  );
  const previousPageHref = buildCaptureFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: Math.max(1, pageData.pagination.page - 1) },
  );
  const nextPageHref = buildCaptureFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: pageData.pagination.page + 1 },
  );

  return (
    <DashboardShell
      currentSection="captures"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        subtitle="Review leads, messages, appointment requests, and handoff requests captured during voice sessions."
        title="Captures"
      />

      <CapturesListRefresh />

      <CaptureFiltersForm agents={pageData.agents} filters={pageData.filters} />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Capture inbox</h2>
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
                    <th>Captured</th>
                    <th>Type</th>
                    <th>Agent</th>
                    <th>Summary</th>
                    <th>Contact</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.captures.map((capture) => {
                    const isSelected =
                      capture.conversationId === activeConversationId;
                    const itemDrawerHref = `${currentListHref}${
                      currentListHref.includes('?') ? '&' : '?'
                    }conversationId=${capture.conversationId}`;

                    return (
                      <ConversationTableRow
                        conversationId={capture.conversationId}
                        isSelected={isSelected}
                        key={capture.id}
                      >
                        <td data-label="Captured">
                          <Link
                            className="table-link"
                            href={itemDrawerHref}
                            prefetch={true}
                          >
                            {formatTimestamp(capture.createdAt, {
                              timeZone: pageData.timezone,
                            })}
                          </Link>
                        </td>
                        <td data-label="Type">{capture.captureTypeLabel}</td>
                        <td data-label="Agent">{capture.agentName}</td>
                        <td data-label="Summary">{capture.primarySummary}</td>
                        <td data-label="Contact">{capture.contactSummary}</td>
                        <td data-label="Status">
                          <span
                            className={`status-pill status-pill-${
                              capture.status === 'requested'
                                ? 'starting'
                                : 'completed'
                            }`}
                          >
                            <span className="status-dot" />
                            {capture.statusLabel}
                          </span>
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
              <CapturesIcon />
            </div>
            <h3 className="empty-state-heading">No results found</h3>
            <p className="empty-state-text">
              No captures matched the current filters.
            </p>
            <Link className="button-secondary" href={clearFiltersHref}>
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <CapturesIcon />
            </div>
            <h3 className="empty-state-heading">No captures yet</h3>
            <p className="empty-state-text">
              Leads, messages, appointment requests, and handoff requests will
              appear here once a voice agent captures them.
            </p>
          </div>
        )}
      </section>

      <ConversationDetailDrawer detailData={detailData} variant="captures" />
    </DashboardShell>
  );
}
