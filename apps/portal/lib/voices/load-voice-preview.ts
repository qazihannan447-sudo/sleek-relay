import 'server-only';

import { createServerSupabaseAdminClient } from '../supabase/admin';
import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  fetchCartesiaPreviewAudio,
  readCachedVoicePreview,
  resolveCartesiaPreviewUrl,
  writeCachedVoicePreview,
} from './cartesia-preview';
import { VOICE_PREVIEW_BUCKET } from './preview-storage';

export type LoadVoicePreviewResult =
  | { body: ArrayBuffer; contentType: string; kind: 'success' }
  | { kind: 'error'; message: string; status: number };

function readCartesiaApiKey(): string | null {
  const value = process.env.CARTESIA_API_KEY?.trim();
  return value ? value : null;
}

async function loadStoredVoicePreview(
  storagePath: string,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  try {
    const admin = await createServerSupabaseAdminClient();
    const { data, error } = await admin.storage
      .from(VOICE_PREVIEW_BUCKET)
      .download(storagePath);

    if (error || !data) {
      return null;
    }

    const body = await data.arrayBuffer();
    if (body.byteLength === 0) {
      return null;
    }

    return {
      body,
      contentType: data.type || 'audio/mpeg',
    };
  } catch {
    return null;
  }
}

/**
 * Serves a voice preview for the Configure Voice drawer.
 *
 * Preference order:
 * 1. In-process cache
 * 2. Durable copy in Supabase Storage (`voices.preview_storage_path`)
 * 3. Fresh Cartesia preview_file_url (fallback while storage is still syncing)
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
      .select('id, preview_url, preview_storage_path')
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

  const cached = readCachedVoicePreview(voiceId);
  if (cached) {
    return {
      body: cached.body,
      contentType: cached.contentType,
      kind: 'success',
    };
  }

  if (typeof data.preview_storage_path === 'string' && data.preview_storage_path) {
    const stored = await loadStoredVoicePreview(data.preview_storage_path);
    if (stored) {
      writeCachedVoicePreview(voiceId, stored);
      return {
        body: stored.body,
        contentType: stored.contentType,
        kind: 'success',
      };
    }
  }

  const apiKey = readCartesiaApiKey();
  if (!apiKey) {
    return {
      kind: 'error',
      message:
        data.preview_storage_path
          ? 'Unable to load the stored voice preview right now.'
          : 'Voice previews are not configured on this server. Set CARTESIA_API_KEY for the portal, or sync previews into Supabase Storage.',
      status: 503,
    };
  }

  const candidateUrls: string[] = [];
  try {
    const freshUrl = await resolveCartesiaPreviewUrl(voiceId, apiKey, fetchImpl);
    if (freshUrl) {
      candidateUrls.push(freshUrl);
    }
  } catch {
    // Fall through to the stored Cartesia URL when metadata is unavailable.
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
