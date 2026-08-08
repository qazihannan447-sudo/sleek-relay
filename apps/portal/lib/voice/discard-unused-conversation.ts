import type { SupabaseClient } from '@supabase/supabase-js';

import { isConversationUuid } from '../conversations/helpers';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import { browserConversationSource } from './start-conversation';

type DiscardUnusedConversationRow = {
  id: string;
  status: string;
  tenant_id: string;
};

type DiscardUnusedConversationErrorBody = {
  error: string;
};

type DiscardUnusedConversationSuccessBody = {
  conversationId: string;
  discarded: true;
};

export type DiscardUnusedConversationResult = {
  body:
    | DiscardUnusedConversationErrorBody
    | DiscardUnusedConversationSuccessBody;
  headers: Record<string, string>;
  status: number;
};

type DiscardUnusedConversationDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
};

const discardHeaders = {
  'Cache-Control': 'no-store',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): DiscardUnusedConversationResult {
  return {
    body: { error },
    headers: { ...discardHeaders },
    status,
  };
}

function getWorkspaceErrorResult(
  workspace: Extract<WorkspaceContext, { kind: 'error' }>,
): DiscardUnusedConversationResult {
  return buildErrorResult(500, workspace.message);
}

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to discard the unused conversation right now.';
}

async function resolveAuthorizedStartingConversation(args: {
  conversationId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<DiscardUnusedConversationRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, status')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.conversationId)
    .eq('source', browserConversationSource)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the requested conversation.');
  }

  return (data as DiscardUnusedConversationRow | null) ?? null;
}

export function createDiscardUnusedConversationService(
  deps: DiscardUnusedConversationDeps,
) {
  return async function discardUnusedConversation(args: {
    conversationId: string;
  }): Promise<DiscardUnusedConversationResult> {
    if (!isConversationUuid(args.conversationId)) {
      return buildErrorResult(404, 'The requested conversation is unavailable.');
    }

    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind === 'unauthenticated') {
        return buildErrorResult(401, 'Your session is not authenticated.');
      }

      if (workspace.kind === 'missing-membership') {
        return buildErrorResult(
          403,
          'A tenant workspace is required before discarding a conversation.',
        );
      }

      if (workspace.kind === 'error') {
        return getWorkspaceErrorResult(workspace);
      }

      deps.getSupabaseAdminEnv();
      const supabase = await deps.createServerSupabaseAdminClient();
      const conversation = await resolveAuthorizedStartingConversation({
        conversationId: args.conversationId,
        supabase,
        workspace,
      });

      if (!conversation) {
        return buildErrorResult(
          404,
          'The requested conversation is unavailable.',
        );
      }

      // Unused warmups are never claimed by Connect. Delete regardless of status
      // so a worker no-show finalize (completed) or a raced failed mark cannot
      // leave a ghost row in the Conversations tab.
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('tenant_id', workspace.tenantId)
        .eq('id', conversation.id)
        .eq('source', browserConversationSource)
        .select('id')
        .maybeSingle();

      if (error) {
        return buildErrorResult(
          500,
          'Unable to discard the unused conversation right now.',
        );
      }

      return {
        body: {
          conversationId: conversation.id,
          discarded: true,
        },
        headers: { ...discardHeaders },
        status: 200,
      };
    } catch (error) {
      const message = buildFailureMessage(error);

      if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        return buildErrorResult(
          500,
          'Server configuration for conversation writes is unavailable.',
        );
      }

      if (message === 'Unable to verify the requested conversation.') {
        return buildErrorResult(500, message);
      }

      return buildErrorResult(
        500,
        'Unable to discard the unused conversation right now.',
      );
    }
  };
}

export const discardUnusedConversation = createDiscardUnusedConversationService(
  {
    createServerSupabaseAdminClient,
    getSupabaseAdminEnv,
    loadWorkspaceContext,
  },
);
