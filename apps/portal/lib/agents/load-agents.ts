import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  agentRecordToValues,
  emptyAgentValues,
  type AgentListItem,
  type AgentRecord,
  type AgentValues,
} from './schema';

export type AgentsPageData =
  | {
      agents: AgentListItem[];
      businessName: string | null;
      canManageAgents: boolean;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      tenantName: string;
      tenantSlug: string;
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      kind: 'unauthenticated';
    };

export type AgentDetailPageData =
  | {
      agentId: string | null;
      businessName: string | null;
      canManageAgents: boolean;
      email: string;
      kind: 'authenticated';
      lastUpdated: string | null;
      membershipRole: string;
      tenantName: string;
      tenantSlug: string;
      values: AgentValues;
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      kind: 'unauthenticated';
    };

type BusinessRow = {
  business_name: string;
};

type AgentListRow = {
  id: string;
  language: string;
  name: string;
  role: string;
  status: 'active' | 'draft' | 'paused';
  updated_at: string;
};

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load the agent data right now. Please try again.';
}

function toAgentListItem(record: AgentListRow): AgentListItem {
  return {
    id: record.id,
    language: record.language,
    lastUpdated: record.updated_at,
    name: record.name,
    role: record.role,
    status: record.status,
  };
}

export const loadAgentsPageData = cache(async function loadAgentsPageData(): Promise<AgentsPageData> {
  try {
    const workspace = await loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    const supabase = await createServerSupabaseClient();
    const [businessResult, agentsResult] = await Promise.all([
      supabase
        .from('business_configurations')
        .select('business_name')
        .eq('tenant_id', workspace.tenantId)
        .maybeSingle(),
      supabase
        .from('agents')
        .select('id, name, role, language, status, updated_at')
        .eq('tenant_id', workspace.tenantId)
        .order('updated_at', { ascending: false }),
    ]);

    if (businessResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message:
          'Unable to load the shared business configuration for this tenant.',
      };
    }

    if (agentsResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load tenant agents through row-level security.',
      };
    }

    const business = businessResult.data as BusinessRow | null;
    const agents = (agentsResult.data ?? []) as AgentListRow[];

    return {
      agents: agents.map(toAgentListItem),
      businessName: business?.business_name ?? null,
      canManageAgents: workspace.canManageAgents,
      email: workspace.email,
      kind: 'authenticated',
      membershipRole: workspace.membershipRole,
      tenantName: workspace.tenantName,
      tenantSlug: workspace.tenantSlug,
    };
  } catch (error) {
    return {
      email: null,
      kind: 'error',
      message: buildFailureMessage(error),
    };
  }
});

export const loadAgentDetailPageData = cache(async function loadAgentDetailPageData(
  agentId: string | null,
): Promise<AgentDetailPageData> {
  try {
    const workspace = await loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    const supabase = await createServerSupabaseClient();
    const { data: business, error: businessError } = await supabase
      .from('business_configurations')
      .select('business_name')
      .eq('tenant_id', workspace.tenantId)
      .maybeSingle();

    if (businessError) {
      return {
        email: workspace.email,
        kind: 'error',
        message:
          'Unable to load the shared business configuration for this tenant.',
      };
    }

    if (!agentId) {
      return {
        agentId: null,
        businessName: (business as BusinessRow | null)?.business_name ?? null,
        canManageAgents: workspace.canManageAgents,
        email: workspace.email,
        kind: 'authenticated',
        lastUpdated: null,
        membershipRole: workspace.membershipRole,
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        values: emptyAgentValues(),
      };
    }

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select(
        'id, name, role, language, greeting, status, voice_id, tone, special_instructions, fallback_message, interruption_enabled, silence_timeout_seconds, maximum_session_duration_seconds, updated_at',
      )
      .eq('tenant_id', workspace.tenantId)
      .eq('id', agentId)
      .maybeSingle();

    if (agentError) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the selected agent through row-level security.',
      };
    }

    const record = agent as AgentRecord | null;

    if (!record) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'The selected agent was not found in your tenant scope.',
      };
    }

    return {
      agentId: record.id,
      businessName: (business as BusinessRow | null)?.business_name ?? null,
      canManageAgents: workspace.canManageAgents,
      email: workspace.email,
      kind: 'authenticated',
      lastUpdated: record.updated_at,
      membershipRole: workspace.membershipRole,
      tenantName: workspace.tenantName,
      tenantSlug: workspace.tenantSlug,
      values: agentRecordToValues(record),
    };
  } catch (error) {
    return {
      email: null,
      kind: 'error',
      message: buildFailureMessage(error),
    };
  }
});
