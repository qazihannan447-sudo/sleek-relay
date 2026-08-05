'use server';

import { redirect } from 'next/navigation';

import { sanitizeReturnPath } from '../../lib/auth/paths';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import type { LoginFormState } from './form-state';

export async function login(
  _previousState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const nextPath = sanitizeReturnPath(
    String(formData.get('next') ?? '/dashboard'),
  );

  if (!email || !password) {
    return {
      error: 'Enter both your email address and password.',
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        error: error.message,
      };
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to sign in right now. Please try again.',
    };
  }

  redirect(nextPath);
}
