import * as cheerio from "cheerio";
import { resolveUrl, normalizeUrl, sameSite } from "./urlUtils.js";

export interface FetchSitemapOptions {
  userAgent: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

// Tries /sitemap.xml, returns its listed page URLs if present. Only handles
// a plain page-listing sitemap (<url><loc>...); a sitemap *index* file
// (<sitemap><loc> pointing at other sitemaps) is out of scope for a small-
// business site — falls back to undefined so the caller uses link-following
// instead, same as if there were no sitemap at all.
export async function fetchSitemapUrls(origin: string, opts: FetchSitemapOptions): Promise<string[] | undefined> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const target = new URL(origin);
  const sitemapUrl = `${target.protocol}//${target.host}/sitemap.xml`;

  try {
    const res = await fetchImpl(sitemapUrl, { headers: { "User-Agent": opts.userAgent }, signal: opts.signal });
    if (!res.ok) return undefined;
    const body = await res.text();
    const $ = cheerio.load(body, { xmlMode: true });
    const urls: string[] = [];
    $("url > loc").each((_, el) => {
      const text = $(el).text().trim();
      if (text) urls.push(text);
    });
    return urls.length > 0 ? urls : undefined;
  } catch {
    return undefined;
  }
}

export interface DiscoveredLink {
  url: string;
  linkText: string;
}

// Same-domain links found on a page, deduped and normalized. Cross-domain
// links (social, partners' own sites, etc.) are never crawl candidates —
// filtered out here rather than left for the caller to catch.
export function extractPageLinks(html: string, pageUrl: string): DiscoveredLink[] {
  const $ = cheerio.load(html);
  const origin = new URL(pageUrl);
  const seen = new Set<string>();
  const links: DiscoveredLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const resolved = resolveUrl(pageUrl, href);
    if (!resolved) return;

    let parsed: URL;
    try {
      parsed = new URL(resolved);
    } catch {
      return;
    }
    if (!sameSite(parsed.hostname, origin.hostname)) return;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;

    let normalized: string;
    try {
      normalized = normalizeUrl(parsed.toString());
    } catch {
      return;
    }
    if (seen.has(normalized)) return;
    seen.add(normalized);
    links.push({ url: normalized, linkText: $(el).text().trim() });
  });

  return links;
}
