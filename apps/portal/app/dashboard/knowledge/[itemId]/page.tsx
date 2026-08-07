import Link from 'next/link';
import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../../components/dashboard-page-header';
import { DashboardShell } from '../../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../../lib/auth/paths';
import { formatTimestamp } from '../../../../lib/format-timestamp';
import { loadBusinessKnowledgeDetailPageData } from '../../../../lib/knowledge/load-knowledge';
import {
  deleteBusinessKnowledge,
  setBusinessKnowledgeStatus,
} from '../actions';
import { KnowledgeForm } from '../knowledge-form';

export const dynamic = 'force-dynamic';

type KnowledgeDetailPageProps = {
  params: Promise<{
    itemId: string;
  }>;
};



export default async function KnowledgeDetailPage({
  params,
}: KnowledgeDetailPageProps) {
  const { itemId } = await params;
  const pageData = await loadBusinessKnowledgeDetailPageData(itemId);

  if (pageData.kind === 'unauthenticated') {
    redirect(`/login?next=%2Fdashboard%2Fknowledge%2F${itemId}`);
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
          subtitle="The selected business knowledge record could not be loaded inside the current tenant scope."
          title="Knowledge record unavailable"
        />

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
      <DashboardPageHeader
        eyebrow="Business Knowledge"
        subtitle="Review and edit tenant-approved knowledge that can later be included in the future runtime agent package."
        title={pageData.values.title || 'Knowledge detail'}
      />

      <div className="overview-top-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Knowledge context</h2>
              <p className="panel-subtitle">
                Tenant-scoped business knowledge loaded server-side through RLS.
              </p>
            </div>
            <Link className="button-secondary" href="/dashboard/knowledge">
              Back to knowledge
            </Link>
          </div>

          <div className="kv-list">
            <div className="kv-row">
              <span className="kv-label">Shared business configuration</span>
              <span className="kv-value">
                {pageData.businessName ?? 'Missing business configuration'}
              </span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Status</span>
              <span className="kv-value">{pageData.values.status}</span>
            </div>
            <div className="kv-row">
              <span className="kv-label">Last updated</span>
              <span className="kv-value">
                {formatTimestamp(pageData.lastUpdated)}
              </span>
            </div>
          </div>
        </section>

        <section className="shell-card">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Quick controls</h2>
              <p className="panel-subtitle">
                Owners and admins may approve, disable, or delete this record.
              </p>
            </div>
          </div>

          {pageData.canManageKnowledge && pageData.itemId ? (
            <div className="stack-actions">
              <form action={setBusinessKnowledgeStatus} className="inline-form">
                <input name="itemId" type="hidden" value={pageData.itemId} />
                <input
                  name="status"
                  type="hidden"
                  value={
                    pageData.values.status === 'approved' ? 'disabled' : 'approved'
                  }
                />
                <button className="button" type="submit">
                  {pageData.values.status === 'approved'
                    ? 'Disable record'
                    : 'Approve record'}
                </button>
              </form>
              <form action={deleteBusinessKnowledge} className="inline-form">
                <input name="itemId" type="hidden" value={pageData.itemId} />
                <button className="button-danger" type="submit">
                  Delete record
                </button>
              </form>
            </div>
          ) : (
            <div className="notice">
              Your role may review this knowledge record but cannot change its
              approval state.
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Knowledge settings</h2>
            <p className="panel-subtitle">
              Draft and disabled records remain out of the runtime package until
              they are approved.
            </p>
          </div>
        </div>

        <KnowledgeForm
          canEdit={pageData.canManageKnowledge}
          defaultValues={pageData.values}
          itemId={pageData.itemId}
        />
      </section>
    </DashboardShell>
  );
}
