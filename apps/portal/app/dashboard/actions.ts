'use server';

import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '../../lib/supabase/server';

export async function logout() {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore logout cleanup failures and still return the user to login.
  }

  redirect('/login');
}
