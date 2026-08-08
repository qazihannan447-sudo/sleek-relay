'use client';

const PREFETCH_CONCURRENCY = 3;
const DEFAULT_PREFETCH_LIMIT = 24;

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

async function fetchAndCachePreview(
  voiceId: string,
  previewUrl: string,
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
      const response = await fetch(previewUrl);
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
    } catch {
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
): Promise<string | null> {
  if (!previewUrl) {
    return null;
  }

  return fetchAndCachePreview(voiceId, previewUrl);
}

export async function prefetchVoicePreviews(
  voices: Array<{ id: string; previewUrl: string | null }>,
  options?: {
    concurrency?: number;
    limit?: number;
    prioritizeIds?: readonly string[];
  },
): Promise<void> {
  const concurrency = options?.concurrency ?? PREFETCH_CONCURRENCY;
  const limit = options?.limit ?? DEFAULT_PREFETCH_LIMIT;
  const prioritize = new Set(options?.prioritizeIds ?? []);

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
      const current = ranked[index];
      index += 1;
      if (!current?.previewUrl) {
        continue;
      }
      if (previewCache.has(current.id) || inflight.has(current.id)) {
        continue;
      }
      await fetchAndCachePreview(current.id, current.previewUrl);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, ranked.length) },
    () => worker(),
  );
  await Promise.all(workers);
}
