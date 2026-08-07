import { cache } from 'react';

import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  businessConfigurationToValues,
  emptyBusinessConfigurationValues,
  type BusinessConfigurationRecord,
  type BusinessConfigurationValues,
} from './schema';
import {
  type BusinessKnowledgeListItem,
  type BusinessKnowledgeRecord,
} from '../knowledge/schema';

export type BusinessConfigurationPageData =
  | {
      canManageBusinessConfiguration: boolean;
      canManageKnowledge: boolean;
      email: string;
      kind: 'authenticated';
      knowledgeItems: BusinessKnowledgeListItem[];
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

    const [configResult, knowledgeResult] = await Promise.all([
      supabase
        .from('business_configurations')
        .select(
          'business_name, website, business_phone, category, contact_name, contact_email, timezone, business_hours',
        )
        .eq('tenant_id', workspace.tenantId)
        .maybeSingle(),
      supabase
        .from('business_knowledge')
        .select('id, kind, title, content, status, updated_at')
        .eq('tenant_id', workspace.tenantId)
        .order('updated_at', { ascending: false }),
    ]);

    if (configResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the business configuration for your tenant.',
      };
    }

    if (knowledgeResult.error) {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load business knowledge records for your tenant.',
      };
    }

    const knowledgeItems: BusinessKnowledgeListItem[] = (
      (knowledgeResult.data ?? []) as BusinessKnowledgeRecord[]
    ).map((record) => ({
      content: record.content,
      id: record.id,
      kind: record.kind,
      lastUpdated: record.updated_at,
      status: record.status,
      title: record.title,
    }));

    return {
      canManageBusinessConfiguration: workspace.canManageBusinessConfiguration,
      canManageKnowledge: workspace.canManageKnowledge,
      email: workspace.email,
      kind: 'authenticated',
      knowledgeItems,
      membershipRole: workspace.membershipRole,
      tenantId: workspace.tenantId,
      tenantName: workspace.tenantName,
      tenantSlug: workspace.tenantSlug,
      values: configResult.data
        ? businessConfigurationToValues(configResult.data as BusinessConfigurationRecord)
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

