import Link from 'next/link';

const sections = [
  'Cookie-based authentication with Supabase SSR',
  'Proxy session refresh for protected dashboard routes',
  'Server-side tenant loading through row-level security',
];

export default function HomePage() {
  return (
    <main className="landing-shell">
      <section className="landing-card">
        <p className="eyebrow">Browser validation demo</p>
        <h1>Sleek Relay portal foundation</h1>
        <p className="landing-copy">
          This phase adds the authentication and tenant-aware dashboard
          foundation for the browser-based validation demo. The current portal
          focuses on secure sign-in, protected access, and read-only
          verification of tenant-scoped data loaded through Supabase row-level
          security.
        </p>

        <ul className="landing-list">
          {sections.map((section) => (
            <li key={section}>{section}</li>
          ))}
        </ul>

        <div className="landing-actions">
          <Link className="button" href="/login">
            Sign in
          </Link>
          <Link className="button-secondary" href="/api/health">
            View health endpoint
          </Link>
        </div>
      </section>
    </main>
  );
}
