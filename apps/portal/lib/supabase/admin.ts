import './server-only';

import { cache } from 'react';
import { createClient } from '@supabase/supabase-js';

import { getSupabaseEnv } from './env';

type SupabaseAdminEnv = {
  supabaseServiceRoleKey: string;
  supabaseUrl: string;
};

function readServiceRoleEnv(name: 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseAdminEnv(): SupabaseAdminEnv {
  const { supabaseUrl } = getSupabaseEnv();

  return {
    supabaseServiceRoleKey: readServiceRoleEnv('SUPABASE_SERVICE_ROLE_KEY'),
    supabaseUrl,
  };
}

export const createServerSupabaseAdminClient = cache(
  async function createServerSupabaseAdminClient() {
    const { supabaseServiceRoleKey, supabaseUrl } = getSupabaseAdminEnv();

    return createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  },
);
