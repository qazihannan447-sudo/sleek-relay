import 'server-only';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';

const CARTESIA_VERSION = '2026-03-01';

export type LoadVoicePreviewResult =
  | { body: ReadableStream<Uint8Array>; contentType: string; kind: 'success' }
  | { kind: 'error'; message: string; status: number };

/**
 * Proxies a voice's Cartesia preview audio. Cartesia's preview_file_url
 * requires the same Authorization header as their main API, which a browser
 * <audio> element cannot supply -- so this fetches it server-side (with our
 * server-only CARTESIA_API_KEY) and streams the bytes back same-origin.
 *
 * Only ever fetches a URL already stored in our own voices table (never a
 * client-supplied URL), so this cannot be used as an open proxy.
 */
export async function loadVoicePreviewForRequest(
  voiceId: string,
): Promise<LoadVoicePreviewResult> {
  const supabase = await createServerSupabaseClient();
  const [workspace, { data, error }] = await Promise.all([
    loadWorkspaceContext(),
    supabase
      .from('voices')
      .select('preview_url')
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

  const previewUrl = data?.preview_url;
  if (!previewUrl) {
    return {
      kind: 'error',
      message: 'No preview available for this voice.',
      status: 404,
    };
  }

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) {
    return {
      kind: 'error',
      message: 'Voice previews are not configured on this server.',
      status: 503,
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(previewUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Cartesia-Version': CARTESIA_VERSION,
      },
      // A given voice's preview audio never changes, so this is cached in
      // Next's fetch cache server-wide -- most plays never touch Cartesia at
      // all after the first person previews a given voice.
      next: { revalidate: 3600 },
    });
  } catch (fetchError) {
    return {
      kind: 'error',
      message:
        fetchError instanceof Error
          ? fetchError.message
          : 'Unable to load the preview right now.',
      status: 502,
    };
  }

  if (!upstream.ok || !upstream.body) {
    return {
      kind: 'error',
      message: 'Unable to load the preview right now.',
      status: 502,
    };
  }

  return {
    body: upstream.body,
    contentType: upstream.headers.get('content-type') ?? 'audio/mpeg',
    kind: 'success',
  };
}
