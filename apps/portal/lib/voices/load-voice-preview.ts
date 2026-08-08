import 'server-only';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  fetchCartesiaPreviewAudio,
  readCachedVoicePreview,
  resolveCartesiaPreviewUrl,
  writeCachedVoicePreview,
} from './cartesia-preview';

export type LoadVoicePreviewResult =
  | { body: ArrayBuffer; contentType: string; kind: 'success' }
  | { kind: 'error'; message: string; status: number };

function readCartesiaApiKey(): string | null {
  const value = process.env.CARTESIA_API_KEY?.trim();
  return value ? value : null;
}

/**
 * Proxies a voice's Cartesia preview audio. Cartesia's preview_file_url
 * requires the same Authorization header as their main API, which a browser
 * <audio> element cannot supply -- so this fetches it server-side (with our
 * server-only CARTESIA_API_KEY) and returns the bytes same-origin.
 *
 * Fresh preview URLs are resolved from Cartesia on each request; the stored
 * voices.preview_url value is only a fallback because Cartesia may rotate
 * those file links.
 */
export async function loadVoicePreviewForRequest(
  voiceId: string,
  deps: {
    fetchImpl?: typeof fetch;
  } = {},
): Promise<LoadVoicePreviewResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const supabase = await createServerSupabaseClient();
  const [workspace, { data, error }] = await Promise.all([
    loadWorkspaceContext(),
    supabase
      .from('voices')
      .select('id, preview_url')
      .eq('id', voiceId)
      .eq('enabled', true)
      .maybeSingle(),
  ]);

  if (workspace.kind === 'unauthenticated' || workspace.kind === 'error') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
      status: 401,
    };
  }

  if (error) {
    return { kind: 'error', message: error.message, status: 502 };
  }

  if (!data?.id) {
    return {
      kind: 'error',
      message: 'No preview available for this voice.',
      status: 404,
    };
  }

  const apiKey = readCartesiaApiKey();
  if (!apiKey) {
    return {
      kind: 'error',
      message:
        'Voice previews are not configured on this server. Set CARTESIA_API_KEY for the portal.',
      status: 503,
    };
  }

  const cached = readCachedVoicePreview(voiceId);
  if (cached) {
    return {
      body: cached.body,
      contentType: cached.contentType,
      kind: 'success',
    };
  }

  const candidateUrls: string[] = [];
  try {
    const freshUrl = await resolveCartesiaPreviewUrl(voiceId, apiKey, fetchImpl);
    if (freshUrl) {
      candidateUrls.push(freshUrl);
    }
  } catch {
    // Fall through to the stored URL when Cartesia metadata is temporarily unavailable.
  }

  if (typeof data.preview_url === 'string' && data.preview_url) {
    if (!candidateUrls.includes(data.preview_url)) {
      candidateUrls.push(data.preview_url);
    }
  }

  if (candidateUrls.length === 0) {
    return {
      kind: 'error',
      message: 'No preview available for this voice.',
      status: 404,
    };
  }

  for (const previewUrl of candidateUrls) {
    try {
      const audio = await fetchCartesiaPreviewAudio(previewUrl, apiKey, fetchImpl);
      if (audio) {
        writeCachedVoicePreview(voiceId, audio);
        return {
          body: audio.body,
          contentType: audio.contentType,
          kind: 'success',
        };
      }
    } catch {
      // Try the next candidate URL.
    }
  }

  return {
    kind: 'error',
    message: 'Unable to load the preview right now.',
    status: 502,
  };
}
