import type { PageType } from "./siteSchema.js";

// URL-path and link-text heuristics, checked in priority order. Cheap and
// covers the overwhelming majority of small-business site structures;
// anything that falls through returns "ambiguous" for an LLM-classification
// fallback (siteExtract.ts) rather than guessing.
const URL_PATTERNS: Array<[PageType, RegExp]> = [
  ["contact", /contact|get-in-touch|reach-us/i],
  ["faq", /faq|frequently[-_ ]?asked/i],
  ["about", /about|who-we-are|our-story|company/i],
  ["partners", /partner|clients?|brands?-we-work/i],
  ["projects", /project|portfolio|case-stud|our-work|gallery/i],
  ["services", /service|solution|what-we-do|products?/i]
];

// Paths that should never be crawled/classified as content, regardless of
// what they link to — logins, transactional flows, admin panels.
const IGNORE_PATTERNS =
  /login|log-in|signin|sign-in|register|signup|sign-up|logout|cart|checkout|account|admin|wp-admin|password|privacy-policy|terms-of-service|terms-and-conditions|cookie-policy/i;

const NON_HTML_EXTENSION = /\.(jpg|jpeg|png|gif|svg|webp|ico|pdf|zip|rar|mp4|mp3|css|js|xml|json)(\?|#|$)/i;

const SOCIAL_DOMAIN = /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|youtube\.com/i;

export function classifyPage(url: string, linkText?: string): PageType | "ambiguous" {
  let pathname: string;
  let hostname: string;
  try {
    const parsed = new URL(url);
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    return "ignore";
  }

  if (SOCIAL_DOMAIN.test(hostname) || NON_HTML_EXTENSION.test(pathname) || IGNORE_PATTERNS.test(pathname)) {
    return "ignore";
  }
  if (pathname === "/" || pathname === "") {
    return "home";
  }

  for (const [type, pattern] of URL_PATTERNS) {
    if (pattern.test(pathname)) return type;
  }

  if (linkText) {
    if (IGNORE_PATTERNS.test(linkText)) return "ignore";
    for (const [type, pattern] of URL_PATTERNS) {
      if (pattern.test(linkText)) return type;
    }
  }

  return "ambiguous";
}
