import { createServerSupabaseClient } from '../supabase/server';

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

type MembershipRow = {
  role: string;
  tenant_id: string;
};

type TenantRow = {
  name: string;
  slug: string;
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

    const [tenantResult, businessResult, agentsResult] = await Promise.all([
      supabase
        .from('tenants')
        .select('name, slug')
        .eq('id', membership.tenant_id)
        .single(),
      supabase
        .from('business_configurations')
        .select('business_name')
        .eq('tenant_id', membership.tenant_id)
        .maybeSingle(),
      supabase
        .from('agents')
        .select('id, name, role, language, status')
        .eq('tenant_id', membership.tenant_id)
        .order('name', { ascending: true }),
    ]);

    if (tenantResult.error) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Unable to load the tenant record linked to your membership.',
      };
    }

    if (businessResult.error) {
      return {
        email: user.email,
        kind: 'error',
        message:
          'Unable to load the business configuration for your tenant.',
      };
    }

    if (agentsResult.error) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Unable to load the tenant agents through RLS.',
      };
    }

    const tenant = tenantResult.data as TenantRow | null;
    const business = businessResult.data as BusinessConfigurationRow | null;
    const agents = (agentsResult.data ?? []) as AgentRow[];

    if (!tenant) {
      return {
        email: user.email,
        kind: 'error',
        message: 'Your membership did not resolve to an accessible tenant.',
      };
    }

    return {
      agents,
      businessName: business?.business_name ?? null,
      email: user.email,
      kind: 'authenticated',
      membershipRole: membership.role,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
    };
  } catch (error) {
    return {
      email: null,
      kind: 'error',
      message: buildFailureMessage(error),
    };
  }
}
