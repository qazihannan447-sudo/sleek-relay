import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { NotificationsIcon } from '../../../components/icons';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildNotificationFiltersHref,
  type NotificationFilterInput,
} from '../../../lib/notifications/helpers';
import { loadNotificationsPageData } from '../../../lib/notifications/load-notifications';
import { loadConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { ConversationDetailDrawer } from '../conversations/conversation-detail-drawer';
import { ConversationTableRow } from '../conversations/conversation-table-row';
import { NotificationFiltersForm } from './notification-filters-form';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

type NotificationsPageProps = {
  searchParams: Promise<
    NotificationFilterInput & { conversationId?: string | string[] }
  >;
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

function statusPillClass(status: string): string {
  if (status === 'sent') {
    return 'status-pill status-pill-completed';
  }
  if (status === 'failed') {
    return 'status-pill status-pill-failed';
  }
  return 'status-pill status-pill-starting';
}

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const resolvedParams = await searchParams;
  const activeConversationId = Array.isArray(resolvedParams.conversationId)
    ? resolvedParams.conversationId[0]
    : resolvedParams.conversationId;

  const [pageData, detailData] = await Promise.all([
    loadNotificationsPageData(resolvedParams),
    activeConversationId
      ? loadConversationDetailPageData(activeConversationId)
      : Promise.resolve(null),
  ]);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fnotifications');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="notifications"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          subtitle="The portal could not finish loading the tenant notifications workspace."
          title="Notifications unavailable"
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

  const clearFiltersHref = '/dashboard/notifications';
  const currentListHref = buildNotificationFiltersHref(
    clearFiltersHref,
    pageData.filters,
  );
  const previousPageHref = buildNotificationFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: Math.max(1, pageData.pagination.page - 1) },
  );
  const nextPageHref = buildNotificationFiltersHref(
    clearFiltersHref,
    pageData.filters,
    { page: pageData.pagination.page + 1 },
  );

  return (
    <DashboardShell
      currentSection="notifications"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        subtitle="Review post-call close-off notifications logged for this workspace. WhatsApp sends when Green API is configured; otherwise entries are stored for the demo inbox."
        title="Notifications"
      />

      <NotificationFiltersForm
        agents={pageData.agents}
        filters={pageData.filters}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Notification inbox</h2>
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
                    <th>Sent</th>
                    <th>Channel</th>
                    <th>Agent</th>
                    <th>Destination</th>
                    <th>Preview</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.notifications.map((notification) => {
                    const isSelected =
                      notification.conversationId === activeConversationId;
                    const itemDrawerHref = `${currentListHref}${
                      currentListHref.includes('?') ? '&' : '?'
                    }conversationId=${notification.conversationId}`;

                    return (
                      <ConversationTableRow
                        conversationId={notification.conversationId}
                        isSelected={isSelected}
                        key={notification.id}
                      >
                        <td data-label="Sent">
                          <Link
                            className="table-link"
                            href={itemDrawerHref}
                            prefetch={true}
                          >
                            {formatTimestamp(notification.createdAt)}
                          </Link>
                        </td>
                        <td data-label="Channel">
                          {notification.channelLabel}
                        </td>
                        <td data-label="Agent">{notification.agentName}</td>
                        <td data-label="Destination">
                          {notification.destination}
                        </td>
                        <td data-label="Preview">{notification.bodyPreview}</td>
                        <td data-label="Status">
                          <span className={statusPillClass(notification.status)}>
                            <span className="status-dot" />
                            {notification.statusLabel}
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
                Page {pageData.pagination.page} of{' '}
                {pageData.pagination.totalPages}
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
                  tabIndex={
                    pageData.pagination.hasPreviousPage ? undefined : -1
                  }
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
                    pageData.pagination.hasNextPage
                      ? nextPageHref
                      : clearFiltersHref
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
              <NotificationsIcon />
            </div>
            <h3 className="empty-state-heading">No results found</h3>
            <p className="empty-state-text">
              No notifications matched the current filters.
            </p>
            <Link className="button-secondary" href={clearFiltersHref}>
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">
              <NotificationsIcon />
            </div>
            <h3 className="empty-state-heading">No notifications yet</h3>
            <p className="empty-state-text">
              Post-call close-off notifications will appear here after a voice
              test completes, when a notification email or WhatsApp number is
              configured on Business Configuration.
            </p>
          </div>
        )}
      </section>

      <ConversationDetailDrawer detailData={detailData} />
    </DashboardShell>
  );
}
