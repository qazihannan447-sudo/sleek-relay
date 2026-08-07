import { UnreachableError } from "./errors.js";
import type { Logger } from "./logger.js";

export interface FetchPageOptions {
  userAgent: string;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  launchHeadless?: HeadlessFetcher;
  logger?: Logger;
}

export interface FetchPageResult {
  html: string;
  fetchMethod: "http" | "headless";
}

export type HeadlessFetcher = (url: string, opts: { userAgent: string; signal: AbortSignal }) => Promise<string>;

// A page that "looks empty" is a common signature of a client-rendered SPA
// shell: little or no text content once tags are stripped.
function looksEmpty(html: string): boolean {
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return textOnly.length < 200;
}

// Section 3: HTTP fetch first; headless browser fallback only when plain
// fetch returns an empty shell. Section 6: single request per page, no
// aggressive retries — one attempt via each method, no retry loop.
export async function fetchPage(url: string, opts: FetchPageOptions): Promise<FetchPageResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": opts.userAgent, Accept: "text/html,application/xhtml+xml" },
      signal: opts.signal
    });
  } catch (err) {
    if (opts.signal.aborted) {
      throw new UnreachableError(`fetch aborted (time budget exceeded) for ${url}`, { cause: err });
    }
    throw new UnreachableError(`failed to reach ${url}`, { cause: err });
  }

  if (!res.ok) {
    throw new UnreachableError(`${url} returned HTTP ${res.status}`);
  }

  const html = await res.text();

  if (looksEmpty(html) && opts.launchHeadless) {
    opts.logger?.info({ event: "falling_back_to_headless", url });
    try {
      const rendered = await opts.launchHeadless(url, { userAgent: opts.userAgent, signal: opts.signal });
      return { html: rendered, fetchMethod: "headless" };
    } catch (err) {
      opts.logger?.warn({ event: "headless_fallback_failed", url, detail: String(err) });
      // Fall through and return whatever the plain fetch got — partial
      // content is fine per Section 7; we don't error the whole flow.
      return { html, fetchMethod: "http" };
    }
  }

  return { html, fetchMethod: "http" };
}
