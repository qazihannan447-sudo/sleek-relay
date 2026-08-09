import { redirect } from 'next/navigation';

import { DashboardPageHeader } from '../../../components/dashboard-page-header';
import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { normalizeUsagePeriod } from '../../../lib/usage/period';
import { loadUsagePageData } from '../../../lib/usage/load-usage-page';
import { UsageDashboard } from './usage-dashboard';

export const dynamic = 'force-dynamic';

type UsagePageProps = {
  searchParams: Promise<{ period?: string | string[] }>;
};

export default async function UsagePage({ searchParams }: UsagePageProps) {
  const resolvedParams = await searchParams;
  const periodId = normalizeUsagePeriod(resolvedParams.period);
  const pageData = await loadUsagePageData(periodId);

  if (pageData.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fusage');
  }

  if (pageData.kind === 'error') {
    return (
      <DashboardShell
        currentSection="usage"
        email={pageData.email}
        membershipRole={null}
        tenantName={null}
      >
        <DashboardPageHeader
          subtitle="The portal could not finish loading the usage workspace."
          title="Usage unavailable"
        />

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger notice-full">
              {pageData.message}
            </div>
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
      currentSection="usage"
      email={pageData.email}
      membershipRole={pageData.membershipRole}
      tenantName={pageData.tenantName}
    >
      <DashboardPageHeader
        subtitle="Totals are summed from your tenant's conversations table for the selected period — not sample charts."
        title="Usage & Analytics"
      />

      <UsageDashboard analytics={pageData.analytics} />
    </DashboardShell>
  );
}
