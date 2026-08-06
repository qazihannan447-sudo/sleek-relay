import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  businessConfigurationToValues,
  emptyBusinessConfigurationValues,
  type BusinessConfigurationRecord,
  type BusinessConfigurationValues,
} from './schema';

export type BusinessConfigurationPageData =
  | {
      canManageBusinessConfiguration: boolean;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      tenantId: string;
      tenantName: string;
      tenantSlug: string;
      values: BusinessConfigurationValues | null;
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

export const loadBusinessConfigurationPageData = cache(async function loadBusinessConfigurationPageData(): Promise<BusinessConfigurationPageData> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return workspace;
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('business_configurations')
      .select(
        'business_name, website, business_phone, category, contact_name, contact_email, timezone, business_hours',
      )
      .eq('tenant_id', workspace.tenantId)
      .maybeSingle();

    if (error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the business configuration for your tenant.',
      };
    }

    return {
      canManageBusinessConfiguration: workspace.canManageBusinessConfiguration,
      email: workspace.email,
      kind: 'authenticated',
      membershipRole: workspace.membershipRole,
      tenantId: workspace.tenantId,
      tenantName: workspace.tenantName,
      tenantSlug: workspace.tenantSlug,
      values: data
        ? businessConfigurationToValues(data as BusinessConfigurationRecord)
        : null,
    };
  } catch (error) {
    return {
      email: workspace.email,
      kind: 'error',
      message:
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load the business configuration right now.',
    };
  }
});

export function buildMissingBusinessConfigurationValues() {
  return emptyBusinessConfigurationValues();
}
