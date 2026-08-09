import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../../components/dashboard-page-header';
import { DashboardShell } from '../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { loadBusinessKnowledgeDetailPageData } from '../../../../lib/knowledge/load-knowledge';
import { KnowledgeForm } from '../knowledge-form';

export const dynamic = 'force-dynamic';

export default async function NewKnowledgePage() {
  const pageData = await loadBusinessKnowledgeDetailPageData(null);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fknowledge%2Fnew');
  }

  if (pageData.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  if (pageData.kind !== 'authenticated') {
    return (
      <DashboardShell
        currentSection="knowledge"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          eyebrow="Business Knowledge"
          subtitle="The portal could not prepare the new business knowledge workspace."
          title="New knowledge unavailable"
        />

        <section className="panel">
          <div className="notice notice-danger notice-full">
            {pageData.message}
          </div>
        </section>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell
      currentSection="knowledge"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        eyebrow="Business Knowledge"
        subtitle="Add a tenant-approved fact source that can later be included in the typed runtime package for a future worker session."
        title="Create knowledge record"
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">New knowledge record</h2>
            <p className="panel-subtitle">
              Shared business configuration: {pageData.businessName ?? 'Missing'}
            </p>
          </div>
          <Link className="button-secondary" href="/dashboard/knowledge">
            Back to knowledge
          </Link>
        </div>

        <KnowledgeForm
          canEdit={pageData.canManageKnowledge}
          defaultValues={pageData.values}
          itemId={null}
        />
      </section>
    </DashboardShell>
  );
}
