// Section 4: `website` is "the input URL, normalized".
export function normalizeUrl(input: string): string {
  let candidate = input.trim();
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  const url = new URL(candidate);
  url.hash = "";
  // Normalize an empty path to "/" so origin-only URLs compare consistently.
  if (url.pathname === "") {
    url.pathname = "/";
  }
  return url.toString();
}

export function resolveUrl(base: string, maybeRelative: string): string | undefined {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return undefined;
  }
}

// "www.example.com" and "example.com" are the same site for crawl purposes
// — a bare hostname === check treats a sitemap or homepage link on the
// other label as a different domain and silently drops it, which is common
// enough (many sites canonicalize to the apex or to www inconsistently
// across their own sitemap vs. rendered links) that it needs handling, not
// just an edge case.
export function sameSite(hostnameA: string, hostnameB: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(hostnameA) === strip(hostnameB);
}
