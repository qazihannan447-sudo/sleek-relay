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

type BrowserConversationTranscriptMessage = {
  content: string;
  role: 'assistant' | 'system' | 'user';
};

type BrowserConversationRuntimeSnapshot = Partial<{
  agent_name: string;
  language: string;
  role: string;
  voice_id: string;
}>;

type BrowserConversationLifecycleRequestBody = {
  endReason?: string;
  errorMessage?: string;
  event: BrowserConversationLifecycleEvent;
  runtimeSnapshot?: BrowserConversationRuntimeSnapshot;
  transcriptMessages?: BrowserConversationTranscriptMessage[];
};

type BrowserConversationLifecycleConversationRow = {
  end_reason: string | null;
  id: string;
  outcome: string | null;
  runtime_snapshot: Record<string, unknown> | null;
  started_at: string;
  status: BrowserConversationStatus;
  summary: string | null;
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
const MAX_RUNTIME_SNAPSHOT_TEXT_LENGTH = 120;
const MAX_SUMMARY_LENGTH = 500;
const MAX_TRANSCRIPT_MESSAGE_CONTENT_LENGTH = 2_000;
const MAX_TRANSCRIPT_MESSAGES = 200;
const OUTCOME_LABELS = {
  agent_end_session: 'Agent ended session',
  completed: 'Completed',
  failed: 'Failed',
  user_disconnect: 'User disconnected',
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

function normalizeTranscriptMessageRole(
  value: unknown,
): BrowserConversationTranscriptMessage['role'] | null {
  return value === 'assistant' || value === 'system' || value === 'user'
    ? value
    : null;
}

function normalizeTranscriptMessages(
  value: unknown,
): BrowserConversationTranscriptMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedMessages: BrowserConversationTranscriptMessage[] = [];

  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      normalizedMessages.length >= MAX_TRANSCRIPT_MESSAGES
    ) {
      continue;
    }

    const role = normalizeTranscriptMessageRole(
      (entry as Record<string, unknown>).role,
    );
    const content = normalizeOptionalText(
      (entry as Record<string, unknown>).content,
      MAX_TRANSCRIPT_MESSAGE_CONTENT_LENGTH,
    );

    if (!role || !content) {
      continue;
    }

    normalizedMessages.push({ content, role });
  }

  return normalizedMessages;
}

function normalizeRuntimeSnapshot(
  value: unknown,
): BrowserConversationRuntimeSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const snapshot = value as Record<string, unknown>;
  const normalizedSnapshot: BrowserConversationRuntimeSnapshot = {};

  const agentName = normalizeOptionalText(
    snapshot.agent_name,
    MAX_RUNTIME_SNAPSHOT_TEXT_LENGTH,
  );
  const language = normalizeOptionalText(
    snapshot.language,
    MAX_RUNTIME_SNAPSHOT_TEXT_LENGTH,
  );
  const role = normalizeOptionalText(
    snapshot.role,
    MAX_RUNTIME_SNAPSHOT_TEXT_LENGTH,
  );
  const voiceId = normalizeOptionalText(
    snapshot.voice_id,
    MAX_RUNTIME_SNAPSHOT_TEXT_LENGTH,
  );

  if (agentName) {
    normalizedSnapshot.agent_name = agentName;
  }

  if (language) {
    normalizedSnapshot.language = language;
  }

  if (role) {
    normalizedSnapshot.role = role;
  }

  if (voiceId) {
    normalizedSnapshot.voice_id = voiceId;
  }

  return Object.keys(normalizedSnapshot).length > 0
    ? normalizedSnapshot
    : undefined;
}

function truncateDetailText(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function buildFallbackOutcome(args: {
  endReason?: string;
  event: BrowserConversationLifecycleEvent;
}): string {
  if (args.event === 'failed') {
    return OUTCOME_LABELS.failed;
  }

  if (args.endReason && args.endReason in OUTCOME_LABELS) {
    return OUTCOME_LABELS[args.endReason as keyof typeof OUTCOME_LABELS];
  }

  return OUTCOME_LABELS.completed;
}

function buildFallbackSummary(args: {
  endReason?: string;
  event: BrowserConversationLifecycleEvent;
  transcriptMessages?: BrowserConversationTranscriptMessage[];
}): string | undefined {
  const transcriptMessages = args.transcriptMessages ?? [];
  const userMessages = transcriptMessages.filter((message) => message.role === 'user');
  const assistantMessages = transcriptMessages.filter(
    (message) => message.role === 'assistant',
  );

  if (transcriptMessages.length === 0) {
    const baseSummary =
      args.event === 'failed'
        ? 'Browser voice test failed before transcript messages were stored.'
        : 'Browser voice test completed without stored transcript messages.';
    return truncateDetailText(baseSummary, MAX_SUMMARY_LENGTH);
  }

  const summaryParts = [
    `Browser voice test ${args.event === 'failed' ? 'failed' : 'completed'} with ${userMessages.length} user message${userMessages.length === 1 ? '' : 's'} and ${assistantMessages.length} agent message${assistantMessages.length === 1 ? '' : 's'}.`,
  ];
  const firstUserMessage = userMessages[0]?.content;
  const lastAssistantMessage =
    assistantMessages[assistantMessages.length - 1]?.content;

  if (firstUserMessage) {
    summaryParts.push(`First user message: "${firstUserMessage}".`);
  }

  if (lastAssistantMessage) {
    summaryParts.push(`Last agent reply: "${lastAssistantMessage}".`);
  }

  if (args.endReason) {
    summaryParts.push(`End reason: ${args.endReason}.`);
  }

  return truncateDetailText(summaryParts.join(' '), MAX_SUMMARY_LENGTH);
}

function hasPersistableArtifacts(
  request: BrowserConversationLifecycleRequestBody,
): boolean {
  return Boolean(
    request.runtimeSnapshot ||
      (request.transcriptMessages && request.transcriptMessages.length > 0),
  );
}

async function persistConversationArtifacts(args: {
  conversation: BrowserConversationLifecycleConversationRow;
  request: BrowserConversationLifecycleRequestBody;
  supabase: SupabaseClient;
}): Promise<void> {
  const transcriptMessages = args.request.transcriptMessages ?? [];
  if (transcriptMessages.length > 0) {
    const rows = transcriptMessages.map((message, index) => ({
      content: message.content,
      conversation_id: args.conversation.id,
      interrupted: false,
      is_final: true,
      role: message.role,
      sequence_number: index + 1,
      tenant_id: args.conversation.tenant_id,
    }));

    const { error: transcriptError } = await args.supabase
      .from('conversation_messages')
      .upsert(rows, {
        onConflict: 'conversation_id,sequence_number',
      });

    if (transcriptError) {
      throw new Error('Unable to persist transcript messages.');
    }
  }

  const summary =
    args.conversation.summary?.trim() ||
    buildFallbackSummary({
      endReason: args.request.endReason,
      event: args.request.event,
      transcriptMessages,
    });
  const outcome =
    args.conversation.outcome?.trim() ||
    buildFallbackOutcome({
      endReason: args.request.endReason,
      event: args.request.event,
    });
  const runtimeSnapshot = args.request.runtimeSnapshot
    ? {
        ...args.request.runtimeSnapshot,
        ...(args.conversation.runtime_snapshot ?? {}),
      }
    : args.conversation.runtime_snapshot;

  if (!summary && !outcome && !args.request.runtimeSnapshot) {
    return;
  }

  const artifactUpdate: {
    outcome?: string;
    runtime_snapshot?: BrowserConversationRuntimeSnapshot | Record<string, unknown> | null;
    summary?: string;
  } = {};

  if (summary && !args.conversation.summary?.trim()) {
    artifactUpdate.summary = summary;
  }

  if (outcome && !args.conversation.outcome?.trim()) {
    artifactUpdate.outcome = outcome;
  }

  if (args.request.runtimeSnapshot) {
    artifactUpdate.runtime_snapshot = runtimeSnapshot;
  }

  if (Object.keys(artifactUpdate).length === 0) {
    return;
  }

  const { error: artifactError } = await args.supabase
    .from('conversations')
    .update(artifactUpdate)
    .eq('tenant_id', args.conversation.tenant_id)
    .eq('id', args.conversation.id)
    .eq('source', browserConversationSource);

  if (artifactError) {
    throw new Error('Unable to persist conversation detail artifacts.');
  }
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

  const data: BrowserConversationLifecycleRequestBody = {
    endReason: normalizeOptionalText(body.endReason, 120),
    errorMessage: normalizeOptionalText(body.errorMessage, 500),
    event: body.event,
  };
  const runtimeSnapshot = normalizeRuntimeSnapshot(body.runtimeSnapshot);
  const transcriptMessages = normalizeTranscriptMessages(body.transcriptMessages);

  if (runtimeSnapshot) {
    data.runtimeSnapshot = runtimeSnapshot;
  }

  if (transcriptMessages) {
    data.transcriptMessages = transcriptMessages;
  }

  return {
    data,
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
    .select('id, tenant_id, status, started_at, end_reason, summary, outcome, runtime_snapshot')
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
    duration_ms: durationMs,
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
        if (
          args.request.event !== 'connected' &&
          hasPersistableArtifacts(args.request)
        ) {
          await persistConversationArtifacts({
            conversation,
            request: args.request,
            supabase,
          });
        }

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

      const updatedConversation = data as BrowserConversationLifecycleConversationRow;

      if (
        args.request.event !== 'connected' &&
        hasPersistableArtifacts(args.request)
      ) {
        await persistConversationArtifacts({
          conversation: updatedConversation,
          request: args.request,
          supabase,
        });
      }

      return {
        body: mapLifecycleSuccess(updatedConversation),
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
