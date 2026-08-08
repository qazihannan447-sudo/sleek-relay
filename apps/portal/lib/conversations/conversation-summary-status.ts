import type { SupabaseClient } from '@supabase/supabase-js';

import {
  generateAndPersistConversationSummary,
  loadConversationSummaryTranscript,
} from './conversation-summary-persistence';
import {
  generateConversationSummaryFromTranscript,
  loadConversationSummaryLlmConfig,
} from './generate-conversation-summary';
import {
  conversationSummaryNeedsGeneration,
  resolveConversationSummaryUiState,
  type ConversationSummaryUiState,
} from './conversation-summary-state';
import { isConversationUuid, type ConversationStatus } from './helpers';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';

type ConversationSummaryStatusRow = {
  end_reason: string | null;
  id: string;
  source: string;
  status: ConversationStatus;
  summary: string | null;
  tenant_id: string;
};

export type ConversationSummaryStatusResult = {
  body:
    | {
        conversationId: string;
        message?: string;
        state: ConversationSummaryUiState;
        summary: string | null;
      }
    | { error: string };
  headers: Record<string, string>;
  status: number;
};

type ConversationSummaryStatusDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  generateConversationSummary: typeof generateConversationSummaryFromTranscript;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadConfig?: typeof loadConversationSummaryLlmConfig;
  loadWorkspaceContext: typeof loadWorkspaceContext;
};

const summaryHeaders = {
  'Cache-Control': 'no-store',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): ConversationSummaryStatusResult {
  return {
    body: { error },
    headers: { ...summaryHeaders },
    status,
  };
}

async function resolveAuthorizedSummaryConversation(args: {
  conversationId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<ConversationSummaryStatusRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, status, summary, end_reason, source')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.conversationId)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the requested conversation.');
  }

  return (data as ConversationSummaryStatusRow | null) ?? null;
}

export function createConversationSummaryStatusService(
  deps: ConversationSummaryStatusDeps,
) {
  const loadConfig = deps.loadConfig ?? loadConversationSummaryLlmConfig;

  return async function getConversationSummaryStatus(args: {
    conversationId: string;
  }): Promise<ConversationSummaryStatusResult> {
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
          'A tenant workspace is required before reading a conversation summary.',
        );
      }

      if (workspace.kind === 'error') {
        return buildErrorResult(500, workspace.message);
      }

      deps.getSupabaseAdminEnv();
      const supabase = await deps.createServerSupabaseAdminClient();
      const conversation = await resolveAuthorizedSummaryConversation({
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

      const transcriptMessages = await loadConversationSummaryTranscript({
        conversationId: conversation.id,
        supabase,
        tenantId: conversation.tenant_id,
      });
      const needsGeneration = conversationSummaryNeedsGeneration({
        hasTranscript: transcriptMessages.length > 0,
        status: conversation.status,
        summary: conversation.summary,
      });

      if (needsGeneration) {
        if (!loadConfig()) {
          return {
            body: {
              conversationId: conversation.id,
              message:
                'GOOGLE_API_KEY is not configured on the server, so the draft summary is shown.',
              state: 'ready',
              summary: conversation.summary?.trim() || null,
            },
            headers: { ...summaryHeaders },
            status: 200,
          };
        }

        const generatedSummary = await generateAndPersistConversationSummary({
          conversationId: conversation.id,
          endReason: conversation.end_reason,
          event: conversation.status === 'failed' ? 'failed' : 'completed',
          existingSummary: conversation.summary,
          generateConversationSummary: deps.generateConversationSummary,
          source: conversation.source,
          supabase,
          tenantId: conversation.tenant_id,
          transcriptMessages,
        });

        if (generatedSummary) {
          return {
            body: {
              conversationId: conversation.id,
              state: 'ready',
              summary: generatedSummary,
            },
            headers: { ...summaryHeaders },
            status: 200,
          };
        }

        return {
          body: {
            conversationId: conversation.id,
            message:
              'Gemini summary generation failed, so the draft summary is shown.',
            state: 'ready',
            summary: conversation.summary?.trim() || null,
          },
          headers: { ...summaryHeaders },
          status: 200,
        };
      }

      const state = resolveConversationSummaryUiState({
        hasTranscript: transcriptMessages.length > 0,
        status: conversation.status,
        summary: conversation.summary,
      });

      return {
        body: {
          conversationId: conversation.id,
          state,
          summary: conversation.summary?.trim() || null,
        },
        headers: { ...summaryHeaders },
        status: 200,
      };
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to load the conversation summary right now.';

      if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
        return buildErrorResult(
          500,
          'Server configuration for conversation reads is unavailable.',
        );
      }

      return buildErrorResult(
        500,
        'Unable to load the conversation summary right now.',
      );
    }
  };
}
