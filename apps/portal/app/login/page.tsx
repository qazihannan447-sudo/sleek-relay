import Link from 'next/link';
import { redirect, unstable_rethrow } from 'next/navigation';

import { sanitizeReturnPath } from '../../lib/auth/paths';
import { isMissingAuthSessionError } from '../../lib/supabase/auth-errors';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { hasTenantMembership } from '../../lib/workspace/membership';
import { getAuthenticatedAppPath } from '../../lib/workspace/routing';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const requestedPath = Array.isArray(params?.next)
    ? params?.next[0]
    : params?.next;
  const nextPath = sanitizeReturnPath(requestedPath);
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError && !isMissingAuthSessionError(userError)) {
      throw userError;
    }

    if (user?.email) {
      const hasWorkspace = await hasTenantMembership(supabase);
      redirect(
        getAuthenticatedAppPath({
          hasWorkspace,
          nextPath,
        }),
      );
    }
  } catch (error) {
    unstable_rethrow(error);

    return (
      <main className="auth-shell">
        <section className="auth-card">
          <p className="eyebrow">Authentication</p>
          <h1>Portal sign-in unavailable</h1>
          <p className="auth-copy">
            The portal could not initialize its Supabase SSR configuration.
          </p>
          <div className="notice notice-danger" style={{ marginTop: '24px' }}>
            {error instanceof Error
              ? error.message
              : 'Unknown Supabase initialization failure.'}
          </div>
          <div className="landing-actions">
            <Link className="button-secondary" href="/login">
              Try login again
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Authentication</p>
        <h1>Sign in to Sleek Relay</h1>
        <p className="auth-copy">
          Sign in to create a new workspace or continue configuring your
          existing Sleek Relay business workspace.
        </p>
        <LoginForm nextPath={nextPath} />
        <p className="hint-text">
          New accounts without a workspace will be guided through secure
          workspace setup before the dashboard appears.
        </p>
      </section>
    </main>
  );
}
