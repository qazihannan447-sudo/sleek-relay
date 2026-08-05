import Link from 'next/link';
import { redirect } from 'next/navigation';

import { sanitizeReturnPath } from '../../lib/auth/paths';
import { createServerSupabaseClient } from '../../lib/supabase/server';
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
    } = await supabase.auth.getUser();

    if (user) {
      redirect('/dashboard');
    }
  } catch (error) {
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
            <Link className="button-secondary" href="/">
              Back to home
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
          Use an existing Supabase Auth user that already belongs to a tenant in
          the demo database.
        </p>
        <LoginForm nextPath={nextPath} />
        <p className="hint-text">
          This phase includes login, logout, cookie-based session refresh, and
          a protected read-only dashboard overview.
        </p>
      </section>
    </main>
  );
}
