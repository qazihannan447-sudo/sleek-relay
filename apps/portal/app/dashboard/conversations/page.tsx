import { redirect } from 'next/navigation';

import { DashboardShell } from '../../../components/dashboard-shell';
import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { logout } from '../actions';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';

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

export default async function ConversationsPage() {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind === 'unauthenticated') {
    redirect('/login?next=%2Fdashboard%2Fconversations');
  }

  if (workspace.kind === 'error') {
    return (
      <DashboardShell
        currentSection="conversations"
        email={workspace.email}
        membershipRole={null}
        tenantName={null}
      >
        <div className="page-header">
          <p className="eyebrow">Conversations</p>
          <h1 className="page-title">Conversations unavailable</h1>
          <p className="page-subtitle">
            The portal could not finish loading the current tenant conversation
            workspace.
          </p>
        </div>

        <section className="panel">
          <div className="empty-state">
            <div className="notice notice-danger">{workspace.message}</div>
            <LogoutButton />
          </div>
        </section>
      </DashboardShell>
    );
  }

  if (workspace.kind === 'missing-membership') {
    redirect(WORKSPACE_ONBOARDING_PATH);
  }

  return (
    <DashboardShell
      currentSection="conversations"
      email={workspace.email}
      membershipRole={workspace.membershipRole}
      tenantName={workspace.tenantName}
    >
      <div className="page-header">
        <p className="eyebrow">Conversations</p>
        <h1 className="page-title">Conversations</h1>
        <p className="page-subtitle">
          This section is connected in the dashboard shell now and is reserved
          for tenant-scoped transcript, outcome, and review work in the next
          implementation phase.
        </p>
      </div>

      <section className="panel">
        <div className="empty-state">
          <div className="notice">
            Conversation history and review tools are not implemented yet, but
            the route and navigation are now in place.
          </div>
        </div>
      </section>
    </DashboardShell>
  );
}
