const CARTESIA_API_BASE = 'https://api.cartesia.ai';
export const CARTESIA_VERSION = '2026-03-01';

/** Keep resolved preview audio warm so repeat plays skip Cartesia. */
export const VOICE_PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

type CartesiaVoicePreviewResponse = {
  preview_file_url?: string | null;
};

export type CachedVoicePreview = {
  body: ArrayBuffer;
  contentType: string;
  expiresAt: number;
};

const previewAudioCache = new Map<string, CachedVoicePreview>();

export function cartesiaAuthHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Cartesia-Version': CARTESIA_VERSION,
  };
}

export function readCachedVoicePreview(
  voiceId: string,
  now = Date.now(),
): { body: ArrayBuffer; contentType: string } | null {
  const cached = previewAudioCache.get(voiceId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    previewAudioCache.delete(voiceId);
    return null;
  }

  return {
    body: cached.body.slice(0),
    contentType: cached.contentType,
  };
}

export function writeCachedVoicePreview(
  voiceId: string,
  audio: { body: ArrayBuffer; contentType: string },
  now = Date.now(),
): void {
  previewAudioCache.set(voiceId, {
    body: audio.body.slice(0),
    contentType: audio.contentType,
    expiresAt: now + VOICE_PREVIEW_CACHE_TTL_MS,
  });
}

export function clearCachedVoicePreviews(): void {
  previewAudioCache.clear();
}

/**
 * Cartesia docs warn that preview_file_url values may be moved or deleted and
 * should not be stored permanently. Resolve a fresh URL at preview time.
 */
export async function resolveCartesiaPreviewUrl(
  voiceId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(`${CARTESIA_API_BASE}/voices/${encodeURIComponent(voiceId)}`);
  url.searchParams.append('expand[]', 'preview_file_url');

  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: cartesiaAuthHeaders(apiKey),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as CartesiaVoicePreviewResponse;
  return typeof payload.preview_file_url === 'string' && payload.preview_file_url
    ? payload.preview_file_url
    : null;
}

export async function fetchCartesiaPreviewAudio(
  previewUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const response = await fetchImpl(previewUrl, {
    cache: 'no-store',
    headers: cartesiaAuthHeaders(apiKey),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.arrayBuffer();
  if (body.byteLength === 0) {
    return null;
  }

  return {
    body,
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
  };
}
