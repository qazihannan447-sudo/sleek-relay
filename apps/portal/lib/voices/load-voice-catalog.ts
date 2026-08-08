import 'server-only';

import { getSupabaseEnv } from '../supabase/env';
import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import { buildVoicePreviewPublicUrl } from './preview-storage';

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
  preview_storage_path: string | null;
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

function toVoice(row: VoiceRow, supabaseUrl: string): CartesiaVoice | null {
  const storagePath = row.preview_storage_path?.trim();
  if (!storagePath) {
    return null;
  }

  return {
    gender: normalizeGender(row.gender),
    id: row.id,
    language: row.language,
    name: row.name,
    // Only list voices with a durable Supabase Storage preview. Cartesia
    // preview_file_url links are not used in the Configure Voice drawer.
    previewUrl: buildVoicePreviewPublicUrl(supabaseUrl, storagePath),
    tagline: row.tagline,
  };
}

/**
 * Authenticated-only: the voice catalog is not tenant-scoped data (it's the
 * same shared list for every tenant), but this still requires a signed-in
 * session so an anonymous caller cannot enumerate it for free.
 *
 * Reads from public.voices and only returns enabled rows that have a synced
 * preview in the voice-previews storage bucket.
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
    const { supabaseUrl } = getSupabaseEnv();
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('voices')
      .select(
        'id, name, gender, tagline, language, preview_url, preview_storage_path',
      )
      .eq('enabled', true)
      .not('preview_storage_path', 'is', null)
      .neq('preview_storage_path', '')
      .order('name', { ascending: true });

    if (error) {
      return { kind: 'error', message: error.message, status: 502 };
    }

    const voices = ((data ?? []) as VoiceRow[])
      .map((row) => toVoice(row, supabaseUrl))
      .filter((voice): voice is CartesiaVoice => voice !== null);

    return {
      kind: 'success',
      voices,
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

/**
 * Resolves a Cartesia voice display name from the shared voices catalog.
 * Returns null when the id is missing or no longer present/enabled.
 */
export async function loadVoiceNameById(
  voiceId: string | null | undefined,
): Promise<string | null> {
  const normalized = voiceId?.trim();
  if (!normalized) {
    return null;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('voices')
      .select('name')
      .eq('id', normalized)
      .eq('enabled', true)
      .maybeSingle();

    if (error || !data?.name) {
      return null;
    }

    return data.name;
  } catch {
    return null;
  }
}
