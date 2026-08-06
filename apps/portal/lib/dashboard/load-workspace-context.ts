import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';
import { canManageTenantResources } from './roles';

export type WorkspaceContext =
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
      canManageAgents: boolean;
      canManageBusinessConfiguration: boolean;
      canManageKnowledge: boolean;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      tenantId: string;
      tenantName: string;
      tenantSlug: string;
    }
  | {
      kind: 'unauthenticated';
    };

type MembershipRow = {
  role: string;
  tenant_id: string;
};

type TenantRow = {
  name: string;
  slug: string;
};

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load your workspace right now. Please try again.';
}

export const loadWorkspaceContext = cache(async function loadWorkspaceContext(): Promise<WorkspaceContext> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return {
        email: null,
        kind: 'error',
        message: 'Unable to confirm the current session with Supabase.',
      };
    }

    if (!user?.email) {
      return {
        kind: 'unauthenticated',
      };
    }

    const { data: memberships, error: membershipError } = await supabase
      .from('tenant_memberships')
      .select('tenant_id, role')
      .order('created_at', { ascending: true })
      .limit(1);

    if (membershipError) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Unable to load your tenant membership through RLS.',
      };
    }

    const membership = (memberships as MembershipRow[] | null)?.[0];

    if (!membership) {
      return {
        email: user.email,
        kind: 'missing-membership',
      };
    }

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('name, slug')
      .eq('id', membership.tenant_id)
      .single();

    if (tenantError) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Unable to load the tenant record linked to your membership.',
      };
    }

    const tenantRecord = tenant as TenantRow | null;

    if (!tenantRecord) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Your membership did not resolve to an accessible tenant.',
      };
    }

    return {
      canManageAgents: canManageTenantResources(membership.role),
      canManageBusinessConfiguration: canManageTenantResources(membership.role),
      canManageKnowledge: canManageTenantResources(membership.role),
      email: user.email,
      kind: 'authenticated',
      membershipRole: membership.role,
      tenantId: membership.tenant_id,
      tenantName: tenantRecord.name,
      tenantSlug: tenantRecord.slug,
    };
  } catch (error) {
    return {
      email: null,
      kind: 'error',
      message: buildFailureMessage(error),
    };
  }
});
