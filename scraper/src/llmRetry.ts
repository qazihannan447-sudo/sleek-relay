// Generic rate-limit backoff for an LLM provider call. Distinct from
// llmExtract.ts's "retry once on malformed JSON" rule (Section 7) — that's
// about the model returning bad *content*; this is about the transport
// being temporarily unavailable (429s), which is common on free/low-tier
// API keys under a multi-page crawl's call volume. Composes with the
// per-call AbortSignal timeout in siteExtract.ts: if backoff sleeping would
// run past the deadline, the signal cuts it off rather than sleeping uselessly.

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Absolute ceiling even when the server's own retry hint suggests waiting longer. */
  absoluteMaxDelayMs?: number;
}

// Deliberately light: a real multi-page run showed that aggressive backoff
// (3 retries, up to 8s each) actively hurts when a free-tier key's quota is
// fully exhausted for the whole run rather than just blipping — each call
// then burns most of its per-call timeout budget on doomed retries instead
// of failing fast and letting the crawl move on to the next page. This
// still smooths a brief transient 429 without sacrificing page coverage
// when the problem is sustained quota exhaustion instead.
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 500;
/** Portal enrich only has ~15s total — never sleep for a minute-long quota reset. */
const DEFAULT_ABSOLUTE_MAX_DELAY_MS = 2_000;

export function isRateLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b429\b/.test(message) || /rate.?limit/i.test(message) || /too many requests/i.test(message);
}

// Google's API error bodies include an authoritative wait time (e.g.
// "Please retry in 27.2s" / RetryInfo.retryDelay: "27s") — prefer that over
// a guessed exponential backoff when present, since it reflects the actual
// per-minute quota reset rather than an arbitrary schedule.
export function parseRetryDelayMs(err: unknown): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  // Matches both the natural-language form ("Please retry in 27.2s") and
  // the JSON RetryInfo field ("retryDelay": "27s").
  const match = message.match(/retry(?:\s+in\s+|Delay"?:\s*"?)(\d+(?:\.\d+)?)\s*s/i);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted during backoff"));
      },
      { once: true }
    );
  });
}

// Retries `fn` with exponential backoff + jitter, but only for errors that
// look like rate limiting — anything else propagates immediately, since
// retrying a non-transient failure (bad auth, malformed request) would just
// waste the caller's time budget for no benefit.
export async function withRateLimitBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}, signal?: AbortSignal): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const absoluteMaxDelayMs = opts.absoluteMaxDelayMs ?? DEFAULT_ABSOLUTE_MAX_DELAY_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const serverHint = parseRetryDelayMs(err);
      // Free-tier quota resets are often 30–60s. Sleeping that long inside a
      // 15s portal enrich budget only produces "aborted during backoff" and
      // hides the real 429 — fail fast when the server asks us to wait too long.
      if (serverHint !== undefined && serverHint > absoluteMaxDelayMs) {
        throw err;
      }
      const backoff =
        serverHint !== undefined
          ? Math.min(serverHint, absoluteMaxDelayMs)
          : Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * backoff * 0.25;
      await sleep(backoff + jitter, signal);
    }
  }
}
