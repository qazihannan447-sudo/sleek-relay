import type { SupabaseClient } from '@supabase/supabase-js';

type MembershipRow = {
  tenant_id: string;
};

export async function hasTenantMembership(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tenant_memberships')
    .select('tenant_id')
    .limit(1);

  if (error) {
    throw new Error('Unable to resolve tenant membership for this session.');
  }

  return ((data as MembershipRow[] | null) ?? []).length > 0;
}
