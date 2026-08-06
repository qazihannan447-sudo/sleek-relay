import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from './load-workspace-context';

export type OverviewAgent = {
  id: string;
  language: string;
  name: string;
  role: string;
  status: string;
};

export type OverviewData =
  | {
      agents: OverviewAgent[];
      businessName: string | null;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      tenantName: string;
      tenantSlug: string;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      kind: 'unauthenticated';
    };

type BusinessConfigurationRow = {
  business_name: string;
};

type AgentRow = {
  id: string;
  language: string;
  name: string;
  role: string;
  status: string;
};

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load your workspace right now. Please try again.';
}

export async function loadOverviewData(): Promise<OverviewData> {
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
        .select('id, name, role, language, status')
        .eq('tenant_id', workspace.tenantId)
        .order('name', { ascending: true }),
    ]);

    if (businessResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message:
          'Unable to load the business configuration for your tenant.',
      };
    }

    if (agentsResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the tenant agents through RLS.',
      };
    }

    const business = businessResult.data as BusinessConfigurationRow | null;
    const agents = (agentsResult.data ?? []) as AgentRow[];

    return {
      agents,
      businessName: business?.business_name ?? null,
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
}
