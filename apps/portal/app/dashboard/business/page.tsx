import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildMissingBusinessConfigurationValues,
  loadBusinessConfigurationPageData,
} from '../../../lib/business-configuration/load-business-configuration';
import { formatTimestamp } from '../../../lib/format-timestamp';
import { setBusinessKnowledgeStatus } from '../knowledge/actions';
import { BusinessConfigurationForm } from './business-form';

export const dynamic = 'force-dynamic';

function statusAction(status: string) {
  if (status === 'approved') {
    return { label: 'Disable', next: 'disabled' };
  }

  return { label: 'Approve', next: 'approved' };
}

export default async function BusinessConfigurationPage() {
  const pageData = await loadBusinessConfigurationPageData();

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fbusiness');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="business"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          eyebrow="Business Configuration"
          subtitle="The portal could not finish loading the shared business profile for the current tenant."
          title="Business configuration unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{pageData.message}</div>
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
      currentSection="business"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        eyebrow="Business Configuration"
        subtitle="Maintain the shared business profile and approved knowledge records that all tenant agents use for grounded answers."
        title="Business configuration"
      />

      {pageData.values ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Business profile</h2>
              <p className="panel-subtitle">
                Updates are saved with the current authenticated tenant context.
              </p>
            </div>
          </div>

          <BusinessConfigurationForm
            canEdit={pageData.canManageBusinessConfiguration}
            defaultValues={pageData.values}
          />
        </section>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">
              No business configuration row is available for this tenant yet.
            </div>
            <p className="muted-copy">
              In the current MVP, initial business configuration provisioning is
              still expected to happen server-side or through seeded demo data.
            </p>
            <BusinessConfigurationForm
              canEdit={false}
              defaultValues={buildMissingBusinessConfigurationValues()}
            />
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Knowledge records</h2>
            <p className="panel-subtitle">
              Approved records are eligible for use in the voice runtime.
              Supported types: FAQ, policy, business fact, and service
              information.
            </p>
          </div>
          {pageData.canManageKnowledge ? (
            <Link className="button" href="/dashboard/knowledge/new">
              Create knowledge
            </Link>
          ) : null}
        </div>

        {pageData.knowledgeItems.length > 0 ? (
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
                {pageData.knowledgeItems.map((item) => {
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
              No knowledge records exist for this tenant yet.
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
