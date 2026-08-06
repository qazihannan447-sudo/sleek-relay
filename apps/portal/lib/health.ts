import { getSupabaseEnv } from './supabase/env';

type SupabaseHealth = {
  configured: boolean;
  error: string | null;
  projectRef: string | null;
  reachable: boolean;
  status: number | null;
};

export type HealthPayload = {
  ok: boolean;
  service: 'portal';
  supabase: SupabaseHealth;
  timestamp: string;
};

type GetHealthPayloadOptions = {
  fetchImpl?: typeof fetch;
};

function extractProjectRef(supabaseUrl: string): string | null {
  try {
    return new URL(supabaseUrl).host.split('.')[0] ?? null;
  } catch {
    return null;
  }
}

export async function getHealthPayload(
  options: GetHealthPayloadOptions = {},
): Promise<HealthPayload> {
  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const { supabasePublishableKey, supabaseUrl } = getSupabaseEnv();
    const response = await fetchImpl(new URL('/auth/v1/settings', supabaseUrl), {
      cache: 'no-store',
      headers: {
        apikey: supabasePublishableKey,
      },
    });

    return {
      ok: response.ok,
      service: 'portal',
      supabase: {
        configured: true,
        error: response.ok ? null : `Supabase auth settings returned HTTP ${response.status}.`,
        projectRef: extractProjectRef(supabaseUrl),
        reachable: response.ok,
        status: response.status,
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      service: 'portal',
      supabase: {
        configured: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown Supabase health-check failure.',
        projectRef: null,
        reachable: false,
        status: null,
      },
      timestamp: new Date().toISOString(),
    };
  }
}
