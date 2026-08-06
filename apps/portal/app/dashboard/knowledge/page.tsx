import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { logout } from '../actions';
import { loadBusinessKnowledgePageData } from '../../../lib/knowledge/load-knowledge';
import { setBusinessKnowledgeStatus } from './actions';

export const dynamic = 'force-dynamic';

function LogoutButton() {
  return (
    <form action={logout}>
      <button className="button-danger" type="submit">
        Log out
      </button>
    </form>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown';
  }
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusAction(status: string) {
  if (status === 'approved') {
    return { label: 'Disable', next: 'disabled' };
  }

  return { label: 'Approve', next: 'approved' };
}

export default async function BusinessKnowledgePage() {
  const pageData = await loadBusinessKnowledgePageData();

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fknowledge');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="knowledge"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Business Knowledge</p>
          <h1 className="page-title">Business knowledge unavailable</h1>
          <p className="page-subtitle">
            The portal could not finish loading the tenant knowledge workspace.
          </p>
        </div>

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

  return (
    <DashboardShell
      currentSection="knowledge"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <div className="page-header">
        <p className="eyebrow">Business Knowledge</p>
        <h1 className="page-title">Approved business knowledge</h1>
        <p className="page-subtitle">
          Manage tenant-approved knowledge records that can later flow into the
          voice runtime package alongside shared business configuration and
          agent-specific settings.
        </p>
      </div>

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Tenant knowledge context</h2>
              <p className="panel-subtitle">
                Knowledge records are tenant-scoped and loaded server-side
                through RLS.
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Tenant</span>
              <span className="kv-value">{pageData.tenantName}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Shared business configuration</span>
              <span className="kv-value">
                {pageData.businessName ?? 'Missing business configuration'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Membership role</span>
              <span className="kv-value">{pageData.membershipRole}</span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Approval flow</h2>
              <p className="panel-subtitle">
                Only approved records are eligible for future runtime use.
                Members can review but cannot change states.
              </p>
            </div>
          </div>

          {pageData.canManageKnowledge ? (
            <Link className="button" href="/dashboard/knowledge/new">
              Create knowledge
            </Link>
          ) : (
            <div className="notice">
              Your role may review tenant knowledge but cannot modify it.
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Knowledge records</h2>
            <p className="panel-subtitle">
              Supported record types: FAQ, policy, business fact, and service
              information.
            </p>
          </div>
        </div>

        {pageData.items.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Last updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((item) => {
                  const action = statusAction(item.status);

                  return (
                    <tr key={item.id}>
                      <td>
                        <Link
                          className="table-link"
                          href={`/dashboard/knowledge/${item.id}`}
                          prefetch={true}
                        >
                          {item.title}
                        </Link>
                      </td>
                      <td>{item.kind.replaceAll('_', ' ')}</td>
                      <td>
                        <span className={`status-pill status-pill-${item.status}`}>
                          <span className="status-dot" />
                          {item.status}
                        </span>
                      </td>
                      <td>{formatTimestamp(item.lastUpdated)}</td>
                      <td>
                        <div className="table-actions">
                          <Link
                            className="button-secondary table-button"
                            href={`/dashboard/knowledge/${item.id}`}
                            prefetch={true}
                          >
                            {pageData.canManageKnowledge ? 'Edit' : 'View'}
                          </Link>
                          {pageData.canManageKnowledge ? (
                            <form action={setBusinessKnowledgeStatus}>
                              <input name="itemId" type="hidden" value={item.id} />
                              <input name="status" type="hidden" value={action.next} />
                              <button className="button-danger table-button" type="submit">
                                {action.label}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              No business knowledge records exist for this tenant yet.
            </div>
            {pageData.canManageKnowledge ? (
              <Link className="button" href="/dashboard/knowledge/new">
                Create the first knowledge record
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
