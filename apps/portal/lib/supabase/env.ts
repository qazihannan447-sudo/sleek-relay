type SupabaseEnv = {
  supabasePublishableKey: string;
  supabaseUrl: string;
};

function readEnv(
  name:
    | 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    | 'NEXT_PUBLIC_SUPABASE_URL',
): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSupabaseEnv(): SupabaseEnv {
  return {
    supabasePublishableKey: readEnv(
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    ),
    supabaseUrl: readEnv('NEXT_PUBLIC_SUPABASE_URL'),
  };
}
