'use server';

import { revalidatePath } from 'next/cache';

import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { loadWorkspaceContext } from '../../../lib/dashboard/load-workspace-context';
import { runWebsiteExtraction } from '../../../lib/business-configuration/run-website-extraction';
import {
  draftHasReviewContent,
  type WebsiteExtractionDraftView,
} from '../../../lib/business-configuration/website-extraction';
import {
  parseBusinessConfigurationForm,
  type BusinessConfigurationActionState,
} from '../../../lib/business-configuration/validation';

export type ScrapeBusinessWebsiteResult =
  | { draft: WebsiteExtractionDraftView; kind: 'success' }
  | { kind: 'error'; message: string };

export async function scrapeBusinessWebsite(
  websiteUrl: string,
): Promise<ScrapeBusinessWebsiteResult> {
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

  try {
    const draft = await runWebsiteExtraction(
      websiteUrl,
      `business-config:${workspace.tenantId}`,
    );

    if (!draftHasReviewContent(draft)) {
      return {
        kind: 'error',
        message:
          draft.failureReason
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
