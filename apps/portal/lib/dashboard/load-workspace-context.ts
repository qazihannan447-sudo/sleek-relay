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
  tenants: TenantRow | TenantRow[] | null;
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
    const [
      {
        data: { user },
        error: userError,
      },
      { data: memberships, error: membershipError },
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase
        .from('tenant_memberships')
        .select('tenant_id, role, tenants!inner(name, slug)')
        .order('created_at', { ascending: true })
        .limit(1),
    ]);

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

    const tenantRecord = Array.isArray(membership.tenants)
      ? membership.tenants[0] ?? null
      : membership.tenants;

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
