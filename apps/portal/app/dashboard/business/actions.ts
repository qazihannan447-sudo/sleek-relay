'use server';

import { revalidatePath } from 'next/cache';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';
import {
  runWebsiteExtractionEnrich,
  runWebsiteExtractionQuick,
} from '../../../lib/business-configuration/run-website-extraction';
import {
  draftHasReviewContent,
  type WebsiteExtractionDraftView,
} from '../../../lib/business-configuration/website-extraction';
import {
  draftHasKnowledgeContent,
  type WebsiteKnowledgeCandidate,
} from '../../../lib/business-configuration/website-knowledge';
import {
  businessKnowledgeKinds,
  type BusinessKnowledgeKind,
  type BusinessKnowledgeListItem,
} from '../../../lib/knowledge/schema';
import {
  parseBusinessConfigurationForm,
  parseBusinessConfigurationValues,
  type BusinessConfigurationActionState,
} from '../../../lib/business-configuration/validation';
import type { BusinessConfigurationValues } from '../../../lib/business-configuration/schema';

export type ScrapeBusinessWebsiteResult =
  | { draft: WebsiteExtractionDraftView; kind: 'success' }
  | { kind: 'error'; message: string };

export type SaveScrapedWebsiteKnowledgeResult =
  | {
      items: BusinessKnowledgeListItem[];
      kind: 'success';
      message: string;
      savedCount: number;
      skippedDuplicateCount: number;
    }
  | { kind: 'error'; message: string };

export type PersistScrapedBusinessDataResult =
  | {
      kind: 'success';
      knowledgeItems: BusinessKnowledgeListItem[];
      knowledgeSavedCount: number;
      message: string;
      profileSaved: boolean;
      skippedDuplicateCount: number;
      values: BusinessConfigurationValues;
    }
  | { kind: 'error'; message: string; values?: BusinessConfigurationValues };

function isKnowledgeKind(value: string): value is BusinessKnowledgeKind {
  return businessKnowledgeKinds.includes(value as BusinessKnowledgeKind);
}

function normalizeKnowledgeDedupeKey(kind: string, title: string): string {
  return `${kind}::${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

async function authorizeScrape(): Promise<
  | { kind: 'ok'; tenantId: string }
  | { kind: 'error'; message: string }
> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
    };
  }

  if (!workspace.canManageBusinessConfiguration) {
    return {
      kind: 'error',
      message: 'Only owners and admins may scrape website information.',
    };
  }

  return { kind: 'ok', tenantId: workspace.tenantId };
}

export async function scrapeBusinessWebsiteQuick(
  websiteUrl: string,
): Promise<ScrapeBusinessWebsiteResult> {
  const auth = await authorizeScrape();
  if (auth.kind === 'error') {
    return auth;
  }

  try {
    const draft = await runWebsiteExtractionQuick(
      websiteUrl,
      `business-config-quick:${auth.tenantId}`,
    );

    if (!draftHasReviewContent(draft)) {
      return {
        kind: 'error',
        message: draft.failureReason
          ? `Could not extract business details (${draft.failureReason.replaceAll('_', ' ')}). You can fill the form manually.`
          : 'No usable business details were found on that page. You can fill the form manually.',
      };
    }

    return { draft, kind: 'success' };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to scrape that website right now.',
    };
  }
}

export async function scrapeBusinessWebsiteEnrich(
  websiteUrl: string,
): Promise<ScrapeBusinessWebsiteResult> {
  const auth = await authorizeScrape();
  if (auth.kind === 'error') {
    return auth;
  }

  try {
    const draft = await runWebsiteExtractionEnrich(
      websiteUrl,
      `business-config-enrich:${auth.tenantId}`,
    );

    if (!draftHasReviewContent(draft) && !draftHasKnowledgeContent(draft)) {
      return {
        kind: 'error',
        message: draft.failureReason
          ? `Could not finish reading the site (${draft.failureReason.replaceAll('_', ' ')}). Contact details already applied above are kept.`
          : 'No additional website knowledge was found. Contact details already applied above are kept.',
      };
    }

    return { draft, kind: 'success' };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to finish reading that website right now.',
    };
  }
}

export async function saveScrapedWebsiteKnowledge(
  items: Array<Pick<WebsiteKnowledgeCandidate, 'kind' | 'title' | 'content'>>,
  options?: {
    /** After human review: drafts stay offline until approved; approved is agent-visible. */
    status?: 'approved' | 'draft';
  },
): Promise<SaveScrapedWebsiteKnowledgeResult> {
  const workspace = await loadWorkspaceContext();
  const status = options?.status ?? 'draft';

  if (workspace.kind !== 'authenticated') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
    };
  }

  if (!workspace.canManageKnowledge) {
    return {
      kind: 'error',
      message: 'Only owners and admins may save website knowledge.',
    };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return {
      kind: 'error',
      message: 'Select at least one knowledge item to save.',
    };
  }

  const rows: Array<{
    content: string;
    kind: BusinessKnowledgeKind;
    status: 'approved' | 'draft';
    tenant_id: string;
    title: string;
  }> = [];

  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    const kind = typeof item.kind === 'string' ? item.kind.trim() : '';

    if (!title || !content) {
      return {
        kind: 'error',
        message: 'Each knowledge item needs a title and content.',
      };
    }

    if (title.length > 160) {
      return {
        kind: 'error',
        message: 'Knowledge titles must be 160 characters or fewer.',
      };
    }

    if (!isKnowledgeKind(kind)) {
      return {
        kind: 'error',
        message:
          'Knowledge type must be FAQ, policy, business fact, or service information.',
      };
    }

    rows.push({
      content,
      kind,
      status,
      tenant_id: workspace.tenantId,
      title,
    });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data: existingRows, error: existingError } = await supabase
      .from('business_knowledge')
      .select('kind, title')
      .eq('tenant_id', workspace.tenantId);

    if (existingError) {
      return {
        kind: 'error',
        message: existingError.message,
      };
    }

    const existingKeys = new Set(
      (existingRows ?? []).map((row) =>
        normalizeKnowledgeDedupeKey(String(row.kind), String(row.title)),
      ),
    );
    const uniqueRows = rows.filter(
      (row) => !existingKeys.has(normalizeKnowledgeDedupeKey(row.kind, row.title)),
    );
    const skippedDuplicateCount = rows.length - uniqueRows.length;

    if (uniqueRows.length === 0) {
      return {
        items: [],
        kind: 'success',
        message:
          skippedDuplicateCount > 0
            ? `Skipped ${skippedDuplicateCount} duplicate ${skippedDuplicateCount === 1 ? 'item' : 'items'} already in knowledge.`
            : 'No new knowledge items to save.',
        savedCount: 0,
        skippedDuplicateCount,
      };
    }

    const { data, error } = await supabase
      .from('business_knowledge')
      .insert(uniqueRows)
      .select('id, kind, title, content, status, updated_at');

    if (error) {
      return {
        kind: 'error',
        message: error.message,
      };
    }

    const savedRows = data ?? [];
    if (savedRows.length === 0) {
      return {
        kind: 'error',
        message: 'Unable to save website knowledge right now.',
      };
    }

    revalidatePath('/dashboard/business');
    revalidatePath('/dashboard/knowledge');
    revalidatePath('/dashboard');

    const savedItems: BusinessKnowledgeListItem[] = savedRows.map((row) => ({
      content: row.content,
      id: row.id,
      kind: row.kind as BusinessKnowledgeKind,
      lastUpdated: row.updated_at,
      status: row.status as BusinessKnowledgeListItem['status'],
      title: row.title,
    }));

    const statusLabel = status === 'approved' ? 'approved' : 'draft';
    const parts = [
      `Saved ${savedItems.length} knowledge ${savedItems.length === 1 ? 'item' : 'items'} as ${statusLabel}.`,
    ];
    if (skippedDuplicateCount > 0) {
      parts.push(
        `Skipped ${skippedDuplicateCount} duplicate ${skippedDuplicateCount === 1 ? 'item' : 'items'}.`,
      );
    }
    if (status === 'draft') {
      parts.push('Approve them in Knowledge before agents use them.');
    }

    return {
      items: savedItems,
      kind: 'success',
      message: parts.join(' '),
      savedCount: savedItems.length,
      skippedDuplicateCount,
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save website knowledge right now.',
    };
  }
}

export async function persistScrapedBusinessDataForAgents(args: {
  knowledgeItems: Array<
    Pick<WebsiteKnowledgeCandidate, 'kind' | 'title' | 'content'>
  >;
  /** When true, reviewed knowledge is saved approved for agents. Default: draft. */
  approveKnowledge?: boolean;
  values: BusinessConfigurationValues;
}): Promise<PersistScrapedBusinessDataResult> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
      values: args.values,
    };
  }

  if (!workspace.canManageBusinessConfiguration) {
    return {
      kind: 'error',
      message: 'Only owners and admins may save scraped business data.',
      values: args.values,
    };
  }

  const parsed = parseBusinessConfigurationValues(args.values);
  let profileSaved = false;
  let savedValues = args.values;
  const messages: string[] = [];
  let skippedDuplicateCount = 0;

  try {
    const supabase = await createServerSupabaseClient();

    if ('errors' in parsed) {
      messages.push(parsed.errors.join(' '));
      savedValues = parsed.values;
    } else {
      const { data, error } = await supabase
        .from('business_configurations')
        .update(parsed.data)
        .eq('tenant_id', workspace.tenantId)
        .select('tenant_id')
        .limit(1);

      if (error) {
        return {
          kind: 'error',
          message: error.message,
          values: parsed.values,
        };
      }

      if (!data || data.length !== 1) {
        return {
          kind: 'error',
          message:
            'Business configuration could not be updated. If the tenant record is missing or your role is read-only, it must be provisioned or updated server-side first.',
          values: parsed.values,
        };
      }

      profileSaved = true;
      savedValues = parsed.values;
      messages.push('Business profile saved.');
    }

    let knowledgeItems: BusinessKnowledgeListItem[] = [];
    let knowledgeSavedCount = 0;

    if (args.knowledgeItems.length > 0) {
      if (!workspace.canManageKnowledge) {
        messages.push(
          'Website knowledge was not saved because your role cannot manage knowledge.',
        );
      } else {
        const knowledgeResult = await saveScrapedWebsiteKnowledge(
          args.knowledgeItems,
          {
            status: args.approveKnowledge ? 'approved' : 'draft',
          },
        );
        if (knowledgeResult.kind === 'error') {
          if (!profileSaved) {
            return {
              kind: 'error',
              message: knowledgeResult.message,
              values: savedValues,
            };
          }
          messages.push(knowledgeResult.message);
        } else {
          knowledgeItems = knowledgeResult.items;
          knowledgeSavedCount = knowledgeResult.savedCount;
          skippedDuplicateCount = knowledgeResult.skippedDuplicateCount;
          messages.push(knowledgeResult.message);
        }
      }
    }

    if (!profileSaved && knowledgeSavedCount === 0) {
      return {
        kind: 'error',
        message:
          messages.join(' ') ||
          'Nothing was saved. Add a business name and review knowledge items, then try again.',
        values: savedValues,
      };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/business');
    revalidatePath('/dashboard/knowledge');

    return {
      kind: 'success',
      knowledgeItems,
      knowledgeSavedCount,
      message: messages.join(' '),
      profileSaved,
      skippedDuplicateCount,
      values: savedValues,
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save scraped business data right now.',
      values: savedValues,
    };
  }
}

export async function saveBusinessConfiguration(
  previousState: BusinessConfigurationActionState,
  formData: FormData,
): Promise<BusinessConfigurationActionState> {
  const parsed = parseBusinessConfigurationForm(formData);

  if ('errors' in parsed) {
    return {
      message: parsed.errors.join(' '),
      status: 'error',
      values: parsed.values,
    };
  }

  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      message: 'Your session is no longer available. Please sign in again.',
      status: 'error',
      values: parsed.values,
    };
  }

  if (!workspace.canManageBusinessConfiguration) {
    return {
      message: 'Only owners and admins may update the business configuration.',
      status: 'error',
      values: previousState.values,
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('business_configurations')
      .update(parsed.data)
      .eq('tenant_id', workspace.tenantId)
      .select('tenant_id')
      .limit(1);

    if (error) {
      return {
        message: error.message,
        status: 'error',
        values: parsed.values,
      };
    }

    if (data && data.length === 1) {
      revalidatePath('/dashboard');
      revalidatePath('/dashboard/business');

      return {
        message: 'Business configuration saved successfully.',
        status: 'success',
        values: parsed.values,
      };
    }

    return {
      message:
        'Business configuration could not be updated. If the tenant record is missing or your role is read-only, it must be provisioned or updated server-side first.',
      status: 'error',
      values: parsed.values,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : 'Unable to save the business configuration right now.',
      status: 'error',
      values: parsed.values,
    };
  }
}
