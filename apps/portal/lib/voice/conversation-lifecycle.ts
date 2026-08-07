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

export const browserConversationLifecycleEvents = [
  'connected',
  'completed',
  'failed',
] as const;

export type BrowserConversationLifecycleEvent =
  (typeof browserConversationLifecycleEvents)[number];

type BrowserConversationStatus =
  | 'starting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

type BrowserConversationLifecycleRequestBody = {
  endReason?: string;
  errorMessage?: string;
  event: BrowserConversationLifecycleEvent;
};

type BrowserConversationLifecycleConversationRow = {
  end_reason: string | null;
  id: string;
  started_at: string;
  status: BrowserConversationStatus;
  tenant_id: string;
};

type BrowserConversationLifecycleErrorBody = {
  error: string;
};

type BrowserConversationLifecycleSuccessBody = {
  conversationId: string;
  endReason: string | null;
  finalized: boolean;
  status: BrowserConversationStatus;
};

export type BrowserConversationLifecycleResult = {
  body:
    | BrowserConversationLifecycleErrorBody
    | BrowserConversationLifecycleSuccessBody;
  headers: Record<string, string>;
  status: number;
};

type BrowserConversationLifecycleDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now: () => Date;
};

type ParsedBrowserConversationLifecycleRequest =
  | {
      data: BrowserConversationLifecycleRequestBody;
      ok: true;
    }
  | {
      body: BrowserConversationLifecycleErrorBody;
      ok: false;
      status: number;
    };

const lifecycleHeaders = {
  'Cache-Control': 'no-store',
} as const;

function buildErrorResult(
  status: number,
  error: string,
): BrowserConversationLifecycleResult {
  return {
    body: { error },
    headers: { ...lifecycleHeaders },
    status,
  };
}

function getWorkspaceErrorResult(
  workspace: Extract<WorkspaceContext, { kind: 'error' }>,
): BrowserConversationLifecycleResult {
  return buildErrorResult(500, workspace.message);
}

function isBrowserConversationLifecycleEvent(
  value: unknown,
): value is BrowserConversationLifecycleEvent {
  return (
    typeof value === 'string' &&
    browserConversationLifecycleEvents.includes(
      value as BrowserConversationLifecycleEvent,
    )
  );
}

function normalizeOptionalText(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to update the conversation lifecycle right now.';
}

function mapLifecycleSuccess(
  conversation: BrowserConversationLifecycleConversationRow,
): BrowserConversationLifecycleSuccessBody {
  return {
    conversationId: conversation.id,
    endReason: conversation.end_reason,
    finalized:
      conversation.status === 'completed' || conversation.status === 'failed',
    status: conversation.status,
  };
}

export async function parseBrowserConversationLifecycleJsonRequest(
  request: Request,
): Promise<ParsedBrowserConversationLifecycleRequest> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      body: {
        error: 'Invalid JSON request body.',
      },
      ok: false,
      status: 400,
    };
  }

  return parseBrowserConversationLifecycleRequestBody(body);
}

export function parseBrowserConversationLifecycleRequestBody(
  value: unknown,
): ParsedBrowserConversationLifecycleRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      body: {
        error: 'Request body must be a JSON object.',
      },
      ok: false,
      status: 400,
    };
  }

  const body = value as Record<string, unknown>;

  if (!isBrowserConversationLifecycleEvent(body.event)) {
    return {
      body: {
        error: 'Event must be one of connected, completed, or failed.',
      },
      ok: false,
      status: 400,
    };
  }

  return {
    data: {
      endReason: normalizeOptionalText(body.endReason, 120),
      errorMessage: normalizeOptionalText(body.errorMessage, 500),
      event: body.event,
    },
    ok: true,
  };
}

async function resolveAuthorizedConversation(args: {
  conversationId: string;
  supabase: SupabaseClient;
  workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>;
}): Promise<BrowserConversationLifecycleConversationRow | null> {
  const { data, error } = await args.supabase
    .from('conversations')
    .select('id, tenant_id, status, started_at, end_reason')
    .eq('tenant_id', args.workspace.tenantId)
    .eq('id', args.conversationId)
    .eq('source', browserConversationSource)
    .maybeSingle();

  if (error) {
    throw new Error('Unable to verify the requested conversation.');
  }

  return (data as BrowserConversationLifecycleConversationRow | null) ?? null;
}

function buildLifecycleUpdate(args: {
  conversation: BrowserConversationLifecycleConversationRow;
  now: Date;
  request: BrowserConversationLifecycleRequestBody;
}):
  | {
      duration_ms?: number;
      end_reason?: string;
      ended_at?: string;
      error_code?: string | null;
      error_message?: string | null;
      status: BrowserConversationStatus;
    }
  | null {
  if (args.request.event === 'connected') {
    if (args.conversation.status !== 'starting') {
      return null;
    }

    return {
      status: 'active',
    };
  }

  const endedAt = args.now.toISOString();
  const durationMs = Math.max(
    0,
    args.now.getTime() - new Date(args.conversation.started_at).getTime(),
  );

  if (args.request.event === 'completed') {
    return {
      duration_ms: durationMs,
      end_reason: args.request.endReason ?? 'completed',
      ended_at: endedAt,
      error_code: null,
      error_message: null,
      status: 'completed',
    };
  }

  return {
    end_reason: args.request.endReason ?? 'failed',
    ended_at: endedAt,
    error_code: 'browser_test_failed',
    error_message: args.request.errorMessage ?? null,
    status: 'failed',
  };
}

export function createBrowserConversationLifecycleService(
  deps: BrowserConversationLifecycleDeps,
) {
  return async function updateBrowserConversationLifecycle(args: {
    conversationId: string;
    request: BrowserConversationLifecycleRequestBody;
  }): Promise<BrowserConversationLifecycleResult> {
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
          'A tenant workspace is required before updating a conversation.',
        );
      }

      if (workspace.kind === 'error') {
        return getWorkspaceErrorResult(workspace);
      }

      deps.getSupabaseAdminEnv();
      const supabase = await deps.createServerSupabaseAdminClient();
      const conversation = await resolveAuthorizedConversation({
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

      if (
        conversation.status === 'completed' ||
        conversation.status === 'failed'
      ) {
        return {
          body: mapLifecycleSuccess(conversation),
          headers: { ...lifecycleHeaders },
          status: 200,
        };
      }

      const update = buildLifecycleUpdate({
        conversation,
        now: deps.now(),
        request: args.request,
      });

      if (!update) {
        return {
          body: mapLifecycleSuccess(conversation),
          headers: { ...lifecycleHeaders },
          status: 200,
        };
      }

      const { data, error } = await supabase
        .from('conversations')
        .update(update)
        .eq('tenant_id', workspace.tenantId)
        .eq('id', conversation.id)
        .eq('source', browserConversationSource)
        .eq('status', conversation.status)
        .select('id, tenant_id, status, started_at, end_reason')
        .maybeSingle();

      if (error) {
        return buildErrorResult(
          500,
          'Unable to update the conversation lifecycle right now.',
        );
      }

      if (!data) {
        const currentConversation = await resolveAuthorizedConversation({
          conversationId: args.conversationId,
          supabase,
          workspace,
        });

        if (!currentConversation) {
          return buildErrorResult(
            404,
            'The requested conversation is unavailable.',
          );
        }

        return {
          body: mapLifecycleSuccess(currentConversation),
          headers: { ...lifecycleHeaders },
          status: 200,
        };
      }

      return {
        body: mapLifecycleSuccess(
          data as BrowserConversationLifecycleConversationRow,
        ),
        headers: { ...lifecycleHeaders },
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
        'Unable to update the conversation lifecycle right now.',
      );
    }
  };
}

export const updateBrowserConversationLifecycle =
  createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient,
    getSupabaseAdminEnv,
    loadWorkspaceContext,
    now: () => new Date(),
  });
