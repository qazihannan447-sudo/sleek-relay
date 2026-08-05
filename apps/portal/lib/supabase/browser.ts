'use client';

import { createBrowserClient } from '@supabase/ssr';

import { getSupabaseEnv } from './env';

export function createBrowserSupabaseClient() {
  const { supabasePublishableKey, supabaseUrl } = getSupabaseEnv();

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
