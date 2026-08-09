import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRateLimitError, parseRetryDelayMs, withRateLimitBackoff } from "../src/llmRetry.js";

describe("isRateLimitError", () => {
  it("recognizes a 429 status in the error message", () => {
    expect(isRateLimitError(new Error("429 status code (no body)"))).toBe(true);
  });

  it("recognizes explicit rate-limit wording", () => {
    expect(isRateLimitError(new Error("Rate limit exceeded, please slow down"))).toBe(true);
    expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
  });

  it("does not misclassify unrelated errors", () => {
    expect(isRateLimitError(new Error("401 Unauthorized"))).toBe(false);
    expect(isRateLimitError(new Error("network error"))).toBe(false);
  });
});

describe("parseRetryDelayMs", () => {
  // Regression: the real Gemini embedding 429 body says "Please retry in
  // 27.209515396s." — the original regex only matched a `retryDelay":"Ns"`
  // JSON-field shape and silently failed on this natural-language form,
  // so the hint was never actually used.
  it("parses the natural-language 'Please retry in Ns' form", () => {
    expect(parseRetryDelayMs(new Error("Please retry in 27.209515396s."))).toBe(27210);
  });

  it("parses the JSON RetryInfo.retryDelay field form", () => {
    expect(parseRetryDelayMs(new Error('"@type":"...RetryInfo","retryDelay":"27s"'))).toBe(27000);
  });

  it("returns undefined when no retry hint is present", () => {
    expect(parseRetryDelayMs(new Error("429 status code (no body)"))).toBeUndefined();
  });
});

describe("withRateLimitBackoff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on 429 and eventually succeeds", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("429 status code (no body)");
      return "ok";
    });

    const promise = withRateLimitBackoff(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 40 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-rate-limit error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("401 Unauthorized");
    });

    await expect(withRateLimitBackoff(fn, { baseDelayMs: 10 })).rejects.toThrow("401");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries and propagates the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("429 status code (no body)");
    });

    const promise = withRateLimitBackoff(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 20 });
    const assertion = expect(promise).rejects.toThrow("429");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });

  it("waits for the server's suggested retry delay instead of the exponential default when present", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error("429 RESOURCE_EXHAUSTED: Please retry in 5s.");
      return "ok";
    });

    // Jitter is randomized (up to +25%) — pin it to 0 so the 5s hint maps
    // to an exact, deterministic delay instead of a flaky range.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    // baseDelayMs/maxDelayMs are tiny — if the server hint weren't being
    // used, this would resolve almost instantly instead of waiting 5s.
    const promise = withRateLimitBackoff(fn, {
      maxRetries: 1,
      baseDelayMs: 1,
      maxDelayMs: 1,
      absoluteMaxDelayMs: 10_000,
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(calls).toBe(1); // hasn't retried yet — still waiting out the 5s hint

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toBe("ok");
    expect(calls).toBe(2);

    randomSpy.mockRestore();
  });

  it("does not sleep out a long quota reset that exceeds absoluteMaxDelayMs", async () => {
    const fn = vi.fn(async () => {
      throw new Error("429 RESOURCE_EXHAUSTED: Please retry in 58.5s.");
    });

    await expect(
      withRateLimitBackoff(fn, { maxRetries: 1, absoluteMaxDelayMs: 2_000 }),
    ).rejects.toThrow("429");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
