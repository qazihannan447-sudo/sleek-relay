import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  businessKnowledgeRecordToValues,
  emptyBusinessKnowledgeValues,
  type BusinessKnowledgeListItem,
  type BusinessKnowledgeRecord,
  type BusinessKnowledgeValues,
} from './schema';

export type BusinessKnowledgePageData =
  | {
      businessName: string | null;
      canManageKnowledge: boolean;
      email: string;
      items: BusinessKnowledgeListItem[];
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

export type BusinessKnowledgeDetailPageData =
  | {
      businessName: string | null;
      canManageKnowledge: boolean;
      email: string;
      itemId: string | null;
      kind: 'authenticated';
      lastUpdated: string | null;
      membershipRole: string;
      tenantName: string;
      tenantSlug: string;
      values: BusinessKnowledgeValues;
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

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load the business knowledge workspace right now.';
}

function toListItem(record: BusinessKnowledgeRecord): BusinessKnowledgeListItem {
  return {
    id: record.id,
    kind: record.kind,
    lastUpdated: record.updated_at,
    status: record.status,
    title: record.title,
  };
}

export const loadBusinessKnowledgePageData = cache(async function loadBusinessKnowledgePageData(): Promise<BusinessKnowledgePageData> {
  try {
    const workspace = await loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    const supabase = await createServerSupabaseClient();
    const [businessResult, itemsResult] = await Promise.all([
      supabase
        .from('business_configurations')
        .select('business_name')
        .eq('tenant_id', workspace.tenantId)
        .maybeSingle(),
      supabase
        .from('business_knowledge')
        .select('id, kind, title, status, updated_at')
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

    if (itemsResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load business knowledge through row-level security.',
      };
    }

    const business = businessResult.data as BusinessRow | null;
    const items = (itemsResult.data ?? []) as BusinessKnowledgeRecord[];

    return {
      businessName: business?.business_name ?? null,
      canManageKnowledge: workspace.canManageKnowledge,
      email: workspace.email,
      items: items.map(toListItem),
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

export const loadBusinessKnowledgeDetailPageData = cache(async function loadBusinessKnowledgeDetailPageData(
  itemId: string | null,
): Promise<BusinessKnowledgeDetailPageData> {
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

    if (!itemId) {
      return {
        businessName: (business as BusinessRow | null)?.business_name ?? null,
        canManageKnowledge: workspace.canManageKnowledge,
        email: workspace.email,
        itemId: null,
        kind: 'authenticated',
        lastUpdated: null,
        membershipRole: workspace.membershipRole,
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        values: emptyBusinessKnowledgeValues(),
      };
    }

    const { data: item, error: itemError } = await supabase
      .from('business_knowledge')
      .select('id, kind, title, content, status, updated_at')
      .eq('tenant_id', workspace.tenantId)
      .eq('id', itemId)
      .maybeSingle();

    if (itemError) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the selected knowledge record through RLS.',
      };
    }

    const record = item as BusinessKnowledgeRecord | null;

    if (!record) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'The selected knowledge record was not found in your tenant scope.',
      };
    }

    return {
      businessName: (business as BusinessRow | null)?.business_name ?? null,
      canManageKnowledge: workspace.canManageKnowledge,
      email: workspace.email,
      itemId: record.id,
      kind: 'authenticated',
      lastUpdated: record.updated_at,
      membershipRole: workspace.membershipRole,
      tenantName: workspace.tenantName,
      tenantSlug: workspace.tenantSlug,
      values: businessKnowledgeRecordToValues(record),
    };
  } catch (error) {
    return {
      email: null,
      kind: 'error',
      message: buildFailureMessage(error),
    };
  }
});
