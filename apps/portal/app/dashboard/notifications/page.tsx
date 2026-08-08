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
import { loadNotificationDetailPageData } from '../../../lib/notifications/load-notification-detail';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { NotificationDetailDrawer } from './notification-detail-drawer';
import { NotificationFiltersForm } from './notification-filters-form';
import { NotificationTableRow } from './notification-table-row';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

type NotificationsPageProps = {
  searchParams: Promise<
    NotificationFilterInput & {
      conversationId?: string | string[];
      notificationId?: string | string[];
    }
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

export default async function NotificationsPage({
  searchParams,
}: NotificationsPageProps) {
  const resolvedParams = await searchParams;
  const activeNotificationId = Array.isArray(resolvedParams.notificationId)
    ? resolvedParams.notificationId[0]
    : resolvedParams.notificationId;

  const [pageData, detailData] = await Promise.all([
    loadNotificationsPageData(resolvedParams),
    activeNotificationId
      ? loadNotificationDetailPageData(activeNotificationId)
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
        subtitle="Post-call close-off emails for this workspace, with Resend delivery status."
        title="Notifications"
      />

      <NotificationFiltersForm
        agents={pageData.agents}
        filters={pageData.filters}
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Email notifications</h2>
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
                    <th>Created</th>
                    <th>Channel</th>
                    <th>Status</th>
                    <th>Destination</th>
                    <th>Agent</th>
                    <th>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.notifications.map((notification) => {
                    const isSelected = notification.id === activeNotificationId;
                    const itemDrawerHref = `${currentListHref}${
                      currentListHref.includes('?') ? '&' : '?'
                    }notificationId=${notification.id}`;

                    return (
                      <NotificationTableRow
                        isSelected={isSelected}
                        key={notification.id}
                        notificationId={notification.id}
                      >
                        <td data-label="Created">
                          <Link
                            className="table-link"
                            href={itemDrawerHref}
                            prefetch={true}
                          >
                            {formatTimestamp(notification.createdAt)}
                          </Link>
                        </td>
                        <td data-label="Channel">{notification.channelLabel}</td>
                        <td data-label="Status">{notification.statusLabel}</td>
                        <td data-label="Destination">
                          {notification.destination}
                        </td>
                        <td data-label="Agent">{notification.agentName}</td>
                        <td data-label="Preview">{notification.bodyPreview}</td>
                      </NotificationTableRow>
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
              Post-call close-off emails appear here after a voice test completes,
              when a notification email is set in Business configuration.
            </p>
          </div>
        )}
      </section>

      <NotificationDetailDrawer detailData={detailData} />
    </DashboardShell>
  );
}
