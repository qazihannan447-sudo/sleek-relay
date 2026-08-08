'use client';

const PREFETCH_CONCURRENCY = 2;
const DEFAULT_PREFETCH_LIMIT = 8;

type PreviewCacheEntry = {
  objectUrl: string;
};

const previewCache = new Map<string, PreviewCacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

export function getCachedVoicePreviewUrl(voiceId: string): string | null {
  return previewCache.get(voiceId)?.objectUrl ?? null;
}

export function hasCachedVoicePreview(voiceId: string): boolean {
  return previewCache.has(voiceId);
}

/**
 * Prefer a fully downloaded blob when available; otherwise return the remote
 * URL so the browser can start streaming without waiting on prefetch.
 */
export function resolveVoicePreviewPlayUrl(
  voiceId: string,
  previewUrl: string | null | undefined,
): string | null {
  if (!previewUrl) {
    return null;
  }

  return getCachedVoicePreviewUrl(voiceId) ?? previewUrl;
}

async function fetchAndCachePreview(
  voiceId: string,
  previewUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const cached = previewCache.get(voiceId);
  if (cached) {
    return cached.objectUrl;
  }

  const existing = inflight.get(voiceId);
  if (existing) {
    return existing;
  }

  const request = (async () => {
    try {
      const response = await fetch(previewUrl, { signal });
      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      if (!blob.size) {
        return null;
      }

      const objectUrl = URL.createObjectURL(blob);
      previewCache.set(voiceId, { objectUrl });
      return objectUrl;
    } catch (error) {
      if (signal?.aborted) {
        return null;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        return null;
      }
      return null;
    } finally {
      inflight.delete(voiceId);
    }
  })();

  inflight.set(voiceId, request);
  return request;
}

export async function ensureVoicePreviewCached(
  voiceId: string,
  previewUrl: string | null | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!previewUrl) {
    return null;
  }

  return fetchAndCachePreview(voiceId, previewUrl, signal);
}

export async function prefetchVoicePreviews(
  voices: Array<{ id: string; previewUrl: string | null }>,
  options?: {
    concurrency?: number;
    limit?: number;
    prioritizeIds?: readonly string[];
    signal?: AbortSignal;
  },
): Promise<void> {
  const concurrency = options?.concurrency ?? PREFETCH_CONCURRENCY;
  const limit = options?.limit ?? DEFAULT_PREFETCH_LIMIT;
  const prioritize = new Set(options?.prioritizeIds ?? []);
  const signal = options?.signal;

  const ranked = [...voices]
    .filter((voice) => voice.previewUrl)
    .sort((left, right) => {
      const leftPriority = prioritize.has(left.id) ? 0 : 1;
      const rightPriority = prioritize.has(right.id) ? 0 : 1;
      return leftPriority - rightPriority;
    })
    .slice(0, limit);

  let index = 0;

  async function worker() {
    while (index < ranked.length) {
      if (signal?.aborted) {
        return;
      }

      const current = ranked[index];
      index += 1;
      if (!current?.previewUrl) {
        continue;
      }
      if (previewCache.has(current.id) || inflight.has(current.id)) {
        continue;
      }
      await fetchAndCachePreview(current.id, current.previewUrl, signal);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, ranked.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
