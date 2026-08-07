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
  formatWebsiteScrapeFailureMessage,
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
        message: formatWebsiteScrapeFailureMessage(
          draft.failureReason,
          draft.normalizedUrl || websiteUrl,
        ),
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
      const siteLabel = draft.normalizedUrl || websiteUrl;
      return {
        kind: 'error',
        message: formatWebsiteScrapeFailureMessage(draft.failureReason, siteLabel, {
          unchangedClause: 'Contact details already applied above are kept.',
        }),
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
      .select('id, kind, title, status, content')
      .eq('tenant_id', workspace.tenantId);

    if (existingError) {
      return {
        kind: 'error',
        message: existingError.message,
      };
    }

    const existingByKey = new Map(
      (existingRows ?? []).map((row) => [
        normalizeKnowledgeDedupeKey(String(row.kind), String(row.title)),
        row,
      ]),
    );

    const insertRows: typeof rows = [];
    const upgradeIds: string[] = [];
    const upgradePayloadById = new Map<
      string,
      { content: string; status: 'approved' | 'draft' }
    >();
    let skippedDuplicateCount = 0;

    for (const row of rows) {
      const key = normalizeKnowledgeDedupeKey(row.kind, row.title);
      const existing = existingByKey.get(key);
      if (!existing) {
        insertRows.push(row);
        continue;
      }

      // Re-approving scrape results should promote offline drafts instead of
      // leaving agents without projects/partners/FAQs that already exist as draft.
      if (status === 'approved' && existing.status === 'draft') {
        upgradeIds.push(String(existing.id));
        upgradePayloadById.set(String(existing.id), {
          content: row.content,
          status: 'approved',
        });
        continue;
      }

      skippedDuplicateCount += 1;
    }

    const savedItems: BusinessKnowledgeListItem[] = [];

    if (insertRows.length > 0) {
      const { data, error } = await supabase
        .from('business_knowledge')
        .insert(insertRows)
        .select('id, kind, title, content, status, updated_at');

      if (error) {
        return {
          kind: 'error',
          message: error.message,
        };
      }

      for (const row of data ?? []) {
        savedItems.push({
          content: row.content,
          id: row.id,
          kind: row.kind as BusinessKnowledgeKind,
          lastUpdated: row.updated_at,
          status: row.status as BusinessKnowledgeListItem['status'],
          title: row.title,
        });
      }
    }

    if (upgradeIds.length > 0) {
      for (const id of upgradeIds) {
        const payload = upgradePayloadById.get(id);
        if (!payload) {
          continue;
        }
        const { data, error } = await supabase
          .from('business_knowledge')
          .update({
            content: payload.content,
            status: payload.status,
          })
          .eq('tenant_id', workspace.tenantId)
          .eq('id', id)
          .select('id, kind, title, content, status, updated_at')
          .limit(1);

        if (error) {
          return {
            kind: 'error',
            message: error.message,
          };
        }

        const row = data?.[0];
        if (row) {
          savedItems.push({
            content: row.content,
            id: row.id,
            kind: row.kind as BusinessKnowledgeKind,
            lastUpdated: row.updated_at,
            status: row.status as BusinessKnowledgeListItem['status'],
            title: row.title,
          });
        }
      }
    }

    if (savedItems.length === 0) {
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

    revalidatePath('/dashboard/business');
    revalidatePath('/dashboard/knowledge');
    revalidatePath('/dashboard');

    const statusLabel = status === 'approved' ? 'approved' : 'draft';
    const upgradedCount = upgradeIds.length;
    const insertedCount = savedItems.length - upgradedCount;
    const parts: string[] = [];
    if (insertedCount > 0) {
      parts.push(
        `Saved ${insertedCount} knowledge ${insertedCount === 1 ? 'item' : 'items'} as ${statusLabel}.`,
      );
    }
    if (upgradedCount > 0) {
      parts.push(
        `Approved ${upgradedCount} existing draft ${upgradedCount === 1 ? 'item' : 'items'} for agents.`,
      );
    }
    if (skippedDuplicateCount > 0) {
      parts.push(
        `Skipped ${skippedDuplicateCount} duplicate ${skippedDuplicateCount === 1 ? 'item' : 'items'}.`,
      );
    }
    if (status === 'draft') {
      parts.push('Approve them before agents use them.');
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

export async function setBusinessKnowledgeEnabled(args: {
  enabled: boolean;
  knowledgeId: string;
}): Promise<
  | {
      item: BusinessKnowledgeListItem;
      kind: 'success';
      message: string;
    }
  | { kind: 'error'; message: string }
> {
  const result = await saveBusinessKnowledgeToggleStates({
    updates: [{ enabled: args.enabled, knowledgeId: args.knowledgeId }],
  });

  if (result.kind === 'error') {
    return result;
  }

  const item = result.items[0];
  if (!item) {
    return {
      kind: 'error',
      message: 'The knowledge item could not be updated.',
    };
  }

  return {
    item,
    kind: 'success',
    message: args.enabled ? 'Enabled for agents.' : 'Disabled for agents.',
  };
}

export async function saveBusinessKnowledgeToggleStates(args: {
  updates: Array<{ enabled: boolean; knowledgeId: string }>;
}): Promise<
  | {
      items: BusinessKnowledgeListItem[];
      kind: 'success';
      message: string;
    }
  | { kind: 'error'; message: string }
> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
    };
  }

  if (!workspace.canManageKnowledge) {
    return {
      kind: 'error',
      message: 'Only owners and admins may change website knowledge.',
    };
  }

  const updates = args.updates
    .map((update) => ({
      enabled: Boolean(update.enabled),
      knowledgeId:
        typeof update.knowledgeId === 'string' ? update.knowledgeId.trim() : '',
    }))
    .filter((update) => update.knowledgeId.length > 0);

  if (updates.length === 0) {
    return {
      items: [],
      kind: 'success',
      message: 'No knowledge toggle changes to save.',
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const items: BusinessKnowledgeListItem[] = [];

    for (const update of updates) {
      const nextStatus = update.enabled ? 'approved' : 'disabled';
      const { data, error } = await supabase
        .from('business_knowledge')
        .update({ status: nextStatus })
        .eq('tenant_id', workspace.tenantId)
        .eq('id', update.knowledgeId)
        .select('id, kind, title, content, status, updated_at')
        .maybeSingle();

      if (error) {
        return {
          kind: 'error',
          message: error.message,
        };
      }

      if (!data) {
        return {
          kind: 'error',
          message: 'A knowledge item could not be updated.',
        };
      }

      items.push({
        content: data.content,
        id: data.id,
        kind: data.kind as BusinessKnowledgeKind,
        lastUpdated: data.updated_at,
        status: data.status as BusinessKnowledgeListItem['status'],
        title: data.title,
      });
    }

    revalidatePath('/dashboard/business');
    revalidatePath('/dashboard/knowledge');
    revalidatePath('/dashboard');

    return {
      items,
      kind: 'success',
      message:
        updates.length === 1
          ? updates[0]?.enabled
            ? 'Enabled for agents.'
            : 'Disabled for agents.'
          : `Updated ${updates.length} knowledge toggles.`,
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to update website knowledge right now.',
    };
  }
}

export async function approveDraftBusinessKnowledge(): Promise<
  | {
      kind: 'success';
      message: string;
      items: BusinessKnowledgeListItem[];
    }
  | { kind: 'error'; message: string }
> {
  const workspace = await loadWorkspaceContext();

  if (workspace.kind !== 'authenticated') {
    return {
      kind: 'error',
      message: 'Your session is no longer available. Please sign in again.',
    };
  }

  if (!workspace.canManageKnowledge) {
    return {
      kind: 'error',
      message: 'Only owners and admins may approve website knowledge.',
    };
  }

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('business_knowledge')
      .update({ status: 'approved' })
      .eq('tenant_id', workspace.tenantId)
      .eq('status', 'draft')
      .select('id, kind, title, content, status, updated_at');

    if (error) {
      return {
        kind: 'error',
        message: error.message,
      };
    }

    const items: BusinessKnowledgeListItem[] = (data ?? []).map((row) => ({
      content: row.content,
      id: row.id,
      kind: row.kind as BusinessKnowledgeKind,
      lastUpdated: row.updated_at,
      status: row.status as BusinessKnowledgeListItem['status'],
      title: row.title,
    }));

    if (items.length === 0) {
      return {
        items: [],
        kind: 'success',
        message: 'No draft knowledge items needed approval.',
      };
    }

    revalidatePath('/dashboard/business');
    revalidatePath('/dashboard/knowledge');
    revalidatePath('/dashboard');

    return {
      items,
      kind: 'success',
      message: `Approved ${items.length} knowledge ${items.length === 1 ? 'item' : 'items'} for agents.`,
    };
  } catch (error) {
    return {
      kind: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Unable to approve draft knowledge right now.',
    };
  }
}

export async function persistScrapedBusinessDataForAgents(args: {
  knowledgeItems: Array<
    Pick<WebsiteKnowledgeCandidate, 'kind' | 'title' | 'content'>
  >;
  /** When true (default), knowledge is saved approved for agents. */
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
            status: args.approveKnowledge === false ? 'draft' : 'approved',
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
