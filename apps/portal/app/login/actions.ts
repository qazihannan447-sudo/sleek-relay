'use server';

import { redirect, unstable_rethrow } from 'next/navigation';

import { sanitizeReturnPath } from '../../lib/auth/paths';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { hasTenantMembership } from '../../lib/workspace/membership';
import { getAuthenticatedAppPath } from '../../lib/workspace/routing';
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

    const hasWorkspace = await hasTenantMembership(supabase);

    redirect(
      getAuthenticatedAppPath({
        hasWorkspace,
        nextPath,
      }),
    );
  } catch (error) {
    unstable_rethrow(error);

    return {
      error:
        error instanceof Error
          ? error.message
          : 'Unable to sign in right now. Please try again.',
    };
  }
}
