import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';

export type TenantBusinessNameRow = {
  business_name: string;
};

export const loadTenantBusinessName = cache(
  async function loadTenantBusinessName(tenantId: string) {
    const supabase = await createServerSupabaseClient();

    return supabase
      .from('business_configurations')
      .select('business_name')
      .eq('tenant_id', tenantId)
      .maybeSingle();
  },
);
