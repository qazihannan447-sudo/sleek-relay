import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../components/dashboard-shell';
import {
  buildMissingBusinessConfigurationValues,
  loadBusinessConfigurationPageData,
} from '../../../lib/business-configuration/load-business-configuration';
import { BusinessConfigurationForm } from './business-form';
import { logout } from '../actions';

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
        <div className="page-header">
          <p className="eyebrow">Business Configuration</p>
          <h1 className="page-title">Business configuration unavailable</h1>
          <p className="page-subtitle">
            The portal could not finish loading the shared business profile for
            the current tenant.
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
    return (
      <DashboardShell
        currentSection="business"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Business Configuration</p>
          <h1 className="page-title">No tenant membership found</h1>
          <p className="page-subtitle">
            Your sign-in is valid, but no accessible tenant membership was
            returned through RLS.
          </p>
        </div>

        <section className="panel">
          <div className="empty-state">
            <div className="notice">
              Ask an administrator to provision a tenant membership for{' '}
              <strong>{pageData.email}</strong>.
            </div>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      currentSection="business"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <div className="page-header">
        <p className="eyebrow">Business Configuration</p>
        <h1 className="page-title">Shared tenant business configuration</h1>
        <p className="page-subtitle">
          View and update the shared business details that all tenant agents rely
          on for grounded answers.
        </p>
      </div>

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Tenant context</h2>
              <p className="panel-subtitle">
                Loaded server-side through the authenticated Supabase session and
                row-level security.
              </p>
            </div>
            <LogoutButton />
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Tenant name</span>
              <span className="kv-value">{pageData.tenantName}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Tenant slug</span>
              <span className="kv-value">{pageData.tenantSlug}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Signed-in email</span>
              <span className="kv-value">{pageData.email}</span>
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
              <h2 className="panel-title">Access rules</h2>
              <p className="panel-subtitle">
                One business configuration exists per tenant in the current demo
                data model.
              </p>
            </div>
          </div>
          <div className="notice notice-success">
            {pageData.canManageBusinessConfiguration
              ? 'Your role may edit this shared configuration.'
              : 'Your role may review this shared configuration, but edits are disabled.'}
          </div>
        </section>
      </div>

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
