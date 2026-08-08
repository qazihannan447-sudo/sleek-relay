import 'server-only';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';

export type CartesiaVoiceGender = 'masculine' | 'feminine' | 'gender_neutral';

export type CartesiaVoice = {
  gender: CartesiaVoiceGender | null;
  id: string;
  language: string | null;
  name: string;
  previewUrl: string | null;
  tagline: string | null;
};

type VoiceRow = {
  gender: string | null;
  id: string;
  language: string | null;
  name: string;
  preview_url: string | null;
  tagline: string | null;
};

export type LoadVoiceCatalogResult =
  | { status: number; kind: 'error'; message: string }
  | { kind: 'success'; voices: CartesiaVoice[] };

function normalizeGender(value: string | null): CartesiaVoiceGender | null {
  return value === 'masculine' || value === 'feminine' || value === 'gender_neutral'
    ? value
    : null;
}

function toVoice(row: VoiceRow): CartesiaVoice {
  return {
    gender: normalizeGender(row.gender),
    id: row.id,
    language: row.language,
    name: row.name,
    // Cartesia's raw preview_url requires an Authorization header a browser
    // <audio> element can't send, so the client is pointed at our own
    // same-origin proxy (see app/api/voices/[voiceId]/preview) instead.
    previewUrl: row.preview_url ? `/api/voices/${row.id}/preview` : null,
    tagline: row.tagline,
  };
}

/**
 * Authenticated-only: the voice catalog is not tenant-scoped data (it's the
 * same shared list for every tenant), but this still requires a signed-in
 * session so an anonymous caller cannot enumerate it for free.
 *
 * Reads from public.voices, refreshed by supabase/scripts/fetch-cartesia-voices.mjs
 * rather than calling Cartesia's API on every request.
 */
export async function loadVoiceCatalogForRequest(): Promise<LoadVoiceCatalogResult> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind === 'unauthenticated' || workspace.kind === 'error') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
      status: 401,
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('voices')
      .select('id, name, gender, tagline, language, preview_url')
      .eq('enabled', true)
      .order('name', { ascending: true });

    if (error) {
      return { kind: 'error', message: error.message, status: 502 };
    }

    return {
      kind: 'success',
      voices: ((data ?? []) as VoiceRow[]).map(toVoice),
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to load the voice catalog right now.',
      status: 502,
    };
  }
}
