import robotsParserImport from "robots-parser";
import type { Logger } from "./logger.js";

// robots-parser's shipped .d.ts declares both an ambient `declare module` and
// a default export in the same file, which resolves to a non-callable type
// under NodeNext/esModuleInterop even though the runtime export is the plain
// function `module.exports = function(...)`. Re-type it against its actual
// documented shape rather than fighting the package's declaration file.
interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
type RobotsParserFn = (url: string, robotsTxt: string) => Robots;
const robotsParser = robotsParserImport as unknown as RobotsParserFn;

export interface RobotsCheckOptions {
  userAgent: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  logger?: Logger;
}

export interface LoadedRobots {
  isAllowed(url: string): boolean;
}

// Fetches and parses robots.txt once for an origin. The single-page flow
// (isAllowedByRobots) only ever checks one URL so re-fetching per call was
// fine; a multi-page crawl needs to check many candidate URLs against the
// same robots.txt without re-fetching it for each one.
export async function loadRobots(origin: string, opts: RobotsCheckOptions): Promise<LoadedRobots> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const target = new URL(origin);
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;

  try {
    const res = await fetchImpl(robotsUrl, {
      headers: { "User-Agent": opts.userAgent },
      signal: opts.signal
    });
    if (!res.ok) {
      return { isAllowed: () => true };
    }
    const body = await res.text();
    const robots = robotsParser(robotsUrl, body);
    return {
      // isAllowed() returns undefined when it can't determine a rule; default to allow.
      isAllowed: (url: string) => robots.isAllowed(url, opts.userAgent) ?? true
    };
  } catch (err) {
    opts.logger?.warn({ event: "robots_fetch_failed", robotsUrl, detail: String(err) });
    return { isAllowed: () => true };
  }
}

// Section 6/9: check robots.txt before fetching. If robots.txt itself is
// unreachable (network error, non-2xx), that's treated as "no restrictions
// published" and we proceed — the standard convention, and distinct from an
// explicit Disallow rule, which always blocks.
export async function isAllowedByRobots(targetUrl: string, opts: RobotsCheckOptions): Promise<boolean> {
  const robots = await loadRobots(targetUrl, opts);
  return robots.isAllowed(targetUrl);
}
