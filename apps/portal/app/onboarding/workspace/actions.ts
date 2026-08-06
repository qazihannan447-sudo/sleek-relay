'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import {
  parseWorkspaceOnboardingForm,
  type WorkspaceOnboardingState,
} from '../../../lib/onboarding/validation';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { DEFAULT_AUTHENTICATED_PATH } from '../../../lib/workspace/routing';

function mapWorkspaceBootstrapError(message: string): string {
  if (message.includes('workspace already exists')) {
    return 'A workspace is already assigned to this account.';
  }

  if (message.includes('authenticated user required')) {
    return 'Your session is no longer available. Please sign in again.';
  }

  return message;
}

export async function createWorkspace(
  _previousState: WorkspaceOnboardingState,
  formData: FormData,
): Promise<WorkspaceOnboardingState> {
  const parsed = parseWorkspaceOnboardingForm(formData);

  if ('errors' in parsed) {
    return {
      message: parsed.errors.join(' '),
      status: 'error',
      values: parsed.values,
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        message: 'Your session is no longer available. Please sign in again.',
        status: 'error',
        values: parsed.values,
      };
    }

    const { error } = await supabase.rpc('create_initial_workspace', {
      business_name: parsed.values.businessName,
      category_name: parsed.values.category || null,
      timezone_name: parsed.values.timezone,
      workspace_name: parsed.values.workspaceName,
    });

    if (error) {
      return {
        message: mapWorkspaceBootstrapError(error.message),
        status: 'error',
        values: parsed.values,
      };
    }

    revalidatePath(DEFAULT_AUTHENTICATED_PATH);
    revalidatePath('/dashboard/business');
    revalidatePath('/onboarding/workspace');

    redirect('/dashboard/business');
  } catch (error) {
    unstable_rethrow(error);

    return {
      message:
        error instanceof Error
          ? mapWorkspaceBootstrapError(error.message)
          : 'Unable to create your workspace right now.',
      status: 'error',
      values: parsed.values,
    };
  }
}

export async function signOutToLogin(): Promise<void> {
  try {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  } catch {
    // Ignore logout cleanup failures and still return the user to login.
  }

  redirect('/login');
}
