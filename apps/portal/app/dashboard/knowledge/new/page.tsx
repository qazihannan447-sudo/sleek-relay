import Link from 'next/link';
import { redirect } from 'next/navigation';

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
        <div className="page-header">
          <p className="eyebrow">Business Knowledge</p>
          <h1 className="page-title">New knowledge unavailable</h1>
          <p className="page-subtitle">
            The portal could not prepare the new business knowledge workspace.
          </p>
        </div>

        <section className="panel">
          <div className="notice notice-danger">
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
      <div className="page-header">
        <p className="eyebrow">Business Knowledge</p>
        <h1 className="page-title">Create knowledge record</h1>
        <p className="page-subtitle">
          Add a tenant-approved fact source that can later be included in the
          typed runtime package for a future worker session.
        </p>
      </div>

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
