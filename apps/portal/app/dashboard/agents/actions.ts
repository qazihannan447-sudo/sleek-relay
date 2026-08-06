'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';
import {
  parseAgentForm,
  type AgentActionState,
} from '../../../lib/agents/validation';

function buildUnauthorizedState(
  values: AgentActionState['values'],
): AgentActionState {
  return {
    message: 'Only owners and admins may manage tenant agents.',
    status: 'error',
    values,
  };
}

export async function saveAgent(
  previousState: AgentActionState,
  formData: FormData,
): Promise<AgentActionState> {
  const parsed = parseAgentForm(formData);

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

  if (!workspace.canManageAgents) {
    return buildUnauthorizedState(previousState.values);
  }

  const agentIdEntry = formData.get('agentId');
  const agentId = typeof agentIdEntry === 'string' && agentIdEntry ? agentIdEntry : null;

  try {
    const supabase = await createServerSupabaseClient();

    if (!agentId) {
      const { data, error } = await supabase
        .from('agents')
        .insert({
          ...parsed.data,
          tenant_id: workspace.tenantId,
        })
        .select('id')
        .single();

      if (error || !data?.id) {
        return {
          message: error?.message ?? 'Unable to create the agent right now.',
          status: 'error',
          values: parsed.values,
        };
      }

      revalidatePath('/dashboard');
      revalidatePath('/dashboard/agents');
      redirect(`/dashboard/agents/${data.id}`);
    }

    const { data, error } = await supabase
      .from('agents')
      .update(parsed.data)
      .eq('tenant_id', workspace.tenantId)
      .eq('id', agentId)
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
          'The selected agent could not be updated. It may be outside your tenant scope or your role may be read-only.',
        status: 'error',
        values: parsed.values,
      };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/agents');
    revalidatePath(`/dashboard/agents/${agentId}`);

    return {
      message: 'Agent settings saved successfully.',
      status: 'success',
      values: parsed.values,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save the agent right now.',
      status: 'error',
      values: parsed.values,
    };
  }
}

export async function setAgentStatus(formData: FormData): Promise<void> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated' || !workspace.canManageAgents) {
    return;
  }

  const agentId = formData.get('agentId');
  const status = formData.get('status');

  if (
    typeof agentId !== 'string' ||
    !agentId ||
    (status !== 'active' && status !== 'paused')
  ) {
    return;
  }

  try {
    const supabase = await createServerSupabaseClient();
    await supabase
      .from('agents')
      .update({ status })
      .eq('tenant_id', workspace.tenantId)
      .eq('id', agentId);
  } finally {
    revalidatePath('/dashboard');
    revalidatePath('/dashboard/agents');
    revalidatePath(`/dashboard/agents/${agentId}`);
  }
}
