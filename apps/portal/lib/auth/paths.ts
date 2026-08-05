const DASHBOARD_PREFIX = '/dashboard';

export function isProtectedRoute(pathname: string): boolean {
  return (
    pathname === DASHBOARD_PREFIX ||
    pathname.startsWith(`${DASHBOARD_PREFIX}/`)
  );
}

export function sanitizeReturnPath(
  candidate: string | null | undefined,
): string {
  if (!candidate || !candidate.startsWith('/')) {
    return DASHBOARD_PREFIX;
  }

  if (candidate.startsWith('//')) {
    return DASHBOARD_PREFIX;
  }

  return candidate;
}

export function buildLoginHref(nextPath?: string): string {
  const params = new URLSearchParams({
    next: sanitizeReturnPath(nextPath),
  });

  return `/login?${params.toString()}`;
}
