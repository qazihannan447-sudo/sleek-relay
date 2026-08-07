import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import {
  buildMissingBusinessConfigurationValues,
  loadBusinessConfigurationPageData,
} from '../../../lib/business-configuration/load-business-configuration';
import { BusinessConfigurationForm } from './business-form';

export const dynamic = 'force-dynamic';

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
        subtitle="Maintain the shared business profile that all tenant agents use for grounded answers."
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
    </DashboardShell>
  );
}
