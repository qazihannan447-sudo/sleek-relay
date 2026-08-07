import type { LlmClient } from "../src/llmClient.js";

export type RouteHandler = () => Response | Promise<Response>;

// Minimal routable fetch stub keyed by exact URL, injected via
// ExtractDraftOptions.fetchImpl so no test ever touches the real network.
export function mockFetch(routes: Record<string, RouteHandler>): typeof fetch {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const handler = routes[url];
    if (!handler) {
      throw new Error(`mockFetch: no route registered for ${url}`);
    }
    return handler();
  }) as typeof fetch;
  (impl as unknown as { calls: string[] }).calls = calls;
  return impl;
}

export function calledUrls(fetchImpl: typeof fetch): string[] {
  return (fetchImpl as unknown as { calls: string[] }).calls;
}

export function textResponse(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200 });
}

export function notFoundResponse(): Response {
  return new Response("not found", { status: 404 });
}

// Injectable LlmClient stub — queues one response (string body or a thrower)
// per call to `complete`, so tests can assert exact call counts (e.g. "no
// more than one retry").
export function stubLlmClient(responses: Array<string | Error>): LlmClient & { callCount: number } {
  if (responses.length === 0) {
    throw new Error("stubLlmClient requires at least one queued response");
  }
  let i = 0;
  return {
    callCount: 0,
    async complete() {
      this.callCount++;
      const next = responses[Math.min(i, responses.length - 1)] as string | Error;
      i++;
      if (next instanceof Error) throw next;
      return next;
    }
  };
}

export const ALLOW_ALL_ROBOTS_TXT = "User-agent: *\nAllow: /\n";
export function disallowRobotsTxt(path: string): string {
  return `User-agent: *\nDisallow: ${path}\n`;
}
