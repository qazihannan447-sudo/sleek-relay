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

function formatKindBadge(kind: string): string {
  switch (kind) {
    case 'faq':
      return 'FAQ';
    case 'service_information':
      return 'Service';
    case 'policy':
      return 'Policy';
    case 'business_fact':
      return 'Business Fact';
    default:
      return kind.replaceAll('_', ' ');
  }
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
        subtitle="Add the business details and knowledge your AI agents should use when speaking with customers."
        title="Business configuration"
      />

      {pageData.values ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Business Profile</h2>
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
            <h2 className="panel-title">Business Knowledge</h2>
            <p className="panel-subtitle">
              Information your agents can use when answering customers.
            </p>
          </div>
          {pageData.canManageKnowledge ? (
            <Link className="button" href="/dashboard/knowledge/new">
              + Add knowledge
            </Link>
          ) : null}
        </div>

        {pageData.knowledgeItems.length > 0 ? (
          <div className="knowledge-cards-grid">
            {pageData.knowledgeItems.map((item) => {
              const action = statusAction(item.status);

              return (
                <div className="knowledge-card" key={item.id}>
                  <div>
                    <div className="knowledge-card-header">
                      <span className="knowledge-card-kind">
                        {formatKindBadge(item.kind)}
                      </span>
                      <span className={`status-pill status-pill-${item.status}`}>
                        <span className="status-dot" />
                        {item.status}
                      </span>
                    </div>

                    <div className="knowledge-card-body">
                      <h3 className="knowledge-card-title">
                        <Link href={`/dashboard/knowledge/${item.id}`} prefetch={true}>
                          {item.title}
                        </Link>
                      </h3>
                      {item.content ? (
                        <p className="knowledge-card-text">{item.content}</p>
                      ) : null}
                    </div>
                  </div>

                  <div className="knowledge-card-footer">
                    <span className="knowledge-card-meta">
                      {formatTimestamp(item.lastUpdated)}
                    </span>
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
                          <button className="button-secondary table-button" type="submit">
                            {action.label}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              No business knowledge records exist for this tenant yet.
            </div>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
