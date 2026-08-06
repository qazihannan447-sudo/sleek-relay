'use server';

import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';
import {
  parseBusinessKnowledgeForm,
  type BusinessKnowledgeActionState,
} from '../../../lib/knowledge/validation';

function buildUnauthorizedState(
  values: BusinessKnowledgeActionState['values'],
): BusinessKnowledgeActionState {
  return {
    message: 'Only owners and admins may manage tenant business knowledge.',
    status: 'error',
    values,
  };
}

export async function saveBusinessKnowledge(
  previousState: BusinessKnowledgeActionState,
  formData: FormData,
): Promise<BusinessKnowledgeActionState> {
  const parsed = parseBusinessKnowledgeForm(formData);

  if ('errors' in parsed) {
    return {
      message: parsed.errors.join(' '),
      status: 'error',
      values: parsed.values,
    };
  }

  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      message: 'Your session is no longer available. Please sign in again.',
      status: 'error',
      values: parsed.values,
    };
  }

  if (!workspace.canManageKnowledge) {
    return buildUnauthorizedState(previousState.values);
  }

  const itemIdEntry = formData.get('itemId');
  const itemId = typeof itemIdEntry === 'string' && itemIdEntry ? itemIdEntry : null;

  try {
    const supabase = await createServerSupabaseClient();

    if (!itemId) {
      const { data, error } = await supabase
        .from('business_knowledge')
        .insert({
          ...parsed.data,
          tenant_id: workspace.tenantId,
        })
        .select('id')
        .single();

      if (error || !data?.id) {
        return {
          message: error?.message ?? 'Unable to create the knowledge record right now.',
          status: 'error',
          values: parsed.values,
        };
      }

      revalidatePath('/dashboard/knowledge');
      revalidatePath('/dashboard');
      redirect(`/dashboard/knowledge/${data.id}`);
    }

    const { data, error } = await supabase
      .from('business_knowledge')
      .update(parsed.data)
      .eq('tenant_id', workspace.tenantId)
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) {
      return {
        message: error.message,
        status: 'error',
        values: parsed.values,
      };
    }

    if (!data?.id) {
      return {
        message:
          'The selected knowledge record could not be updated. It may be outside your tenant scope or your role may be read-only.',
        status: 'error',
        values: parsed.values,
      };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/knowledge');
    revalidatePath(`/dashboard/knowledge/${itemId}`);

    return {
      message: 'Business knowledge saved successfully.',
      status: 'success',
      values: parsed.values,
    };
  } catch (error) {
    unstable_rethrow(error);

    return {
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save the business knowledge right now.',
      status: 'error',
      values: parsed.values,
    };
  }
}

export async function setBusinessKnowledgeStatus(formData: FormData): Promise<void> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated' || !workspace.canManageKnowledge) {
    return;
  }

  const itemId = formData.get('itemId');
  const status = formData.get('status');

  if (
    typeof itemId !== 'string' ||
    !itemId ||
    (status !== 'approved' && status !== 'disabled' && status !== 'draft')
  ) {
    return;
  }

  try {
    const supabase = await createServerSupabaseClient();
    await supabase
      .from('business_knowledge')
      .update({ status })
      .eq('tenant_id', workspace.tenantId)
      .eq('id', itemId);
  } finally {
    revalidatePath('/dashboard/knowledge');
    revalidatePath(`/dashboard/knowledge/${itemId}`);
  }
}

export async function deleteBusinessKnowledge(formData: FormData): Promise<void> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated' || !workspace.canManageKnowledge) {
    return;
  }

  const itemId = formData.get('itemId');
  if (typeof itemId !== 'string' || !itemId) {
    return;
  }

  const supabase = await createServerSupabaseClient();
  await supabase
    .from('business_knowledge')
    .delete()
    .eq('tenant_id', workspace.tenantId)
    .eq('id', itemId);

  revalidatePath('/dashboard/knowledge');
  redirect('/dashboard/knowledge');
}
