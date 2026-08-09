import Link from 'next/link';
import { redirect } from 'next/navigation';

import { WORKSPACE_ONBOARDING_PATH } from '../../../lib/auth/paths';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';
import { WorkspaceForm } from './workspace-form';

export const dynamic = 'force-dynamic';

export default async function WorkspaceOnboardingPage() {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind === 'unauthenticated') {
    redirect(`/login?next=${encodeURIComponent(WORKSPACE_ONBOARDING_PATH)}`);
  }

  if (workspace.kind === 'authenticated') {
    redirect('/dashboard');
  }

  if (workspace.kind === 'error') {
    return (
      <main className="auth-shell">
        <section className="auth-card workspace-card">
          <p className="eyebrow">Workspace Setup</p>
          <h1>Workspace setup unavailable</h1>
          <p className="auth-copy">
            The portal could not prepare the workspace setup flow right now.
          </p>
          <div
            className="notice notice-danger notice-full"
            style={{ marginTop: '24px' }}
          >
            {workspace.message}
          </div>
          <div className="landing-actions">
            <Link className="button-secondary" href="/login">
              Back to login
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card workspace-card">
        <WorkspaceForm email={workspace.email} />
      </section>
    </main>
  );
}
