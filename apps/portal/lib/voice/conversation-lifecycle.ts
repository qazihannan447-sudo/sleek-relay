import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

import {
  generateAndPersistConversationSummary,
  loadConversationSummaryTranscript,
  normalizeSummaryTranscriptMessages,
  preferSummaryTranscript,
} from '../conversations/conversation-summary-persistence';
import {
  generateConversationSummaryFromTranscript,
  shouldReplaceConversationSummary,
} from '../conversations/generate-conversation-summary';
import { isConversationUuid } from '../conversations/helpers';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import { deliverCloseOffNotification } from '../notifications/deliver-close-off';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import { browserConversationSource } from './start-conversation';

export const CONVERSATIONS_DASHBOARD_PATH = '/dashboard/conversations';

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
  agent_id: string;
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

type ScheduleBackgroundWork = (_task: () => Promise<void>) => void;

type BrowserConversationLifecycleDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  generateConversationSummary?: typeof generateConversationSummaryFromTranscript;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now: () => Date;
  revalidateConversationsPath?: () => void;
  scheduleBackgroundWork?: ScheduleBackgroundWork;
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
const MAX_SUMMARY_LENGTH = 1_000;
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

export function buildFallbackSummary(args: {
  endReason?: string;
  event: BrowserConversationLifecycleEvent;
  transcriptMessages?: BrowserConversationTranscriptMessage[];
}): string {
  const transcriptMessages = args.transcriptMessages ?? [];
  const userMessages = transcriptMessages.filter((message) => message.role === 'user');
  const assistantMessages = transcriptMessages.filter(
    (message) => message.role === 'assistant',
  );

  const header = `Browser voice test ${
    args.event === 'failed' ? 'failed' : 'completed'
  } with ${userMessages.length} user message${
    userMessages.length === 1 ? '' : 's'
  } and ${assistantMessages.length} agent message${
    assistantMessages.length === 1 ? '' : 's'
  }.`;

  if (transcriptMessages.length === 0) {
    const baseSummary =
      args.event === 'failed'
        ? `${header} Session failed before transcript messages were stored.`
        : `${header} Session completed without recorded transcript messages.`;
    return truncateDetailText(baseSummary, MAX_SUMMARY_LENGTH);
  }

  if (userMessages.length === 0) {
    const initialGreeting = assistantMessages[0]?.content?.trim();
    if (initialGreeting) {
      return truncateDetailText(
        `${header} The agent greeted the caller ("${initialGreeting}"), but the caller disconnected before speaking or providing input.`,
        MAX_SUMMARY_LENGTH,
      );
    }
    return truncateDetailText(
      `${header} The session ended without any user input.`,
      MAX_SUMMARY_LENGTH,
    );
  }

  const summaryParts: string[] = [header];
  const userTexts = userMessages
    .map((m) => m.content.trim())
    .filter((txt) => txt.length > 0);
  const assistantTexts = assistantMessages
    .map((m) => m.content.trim())
    .filter((txt) => txt.length > 0);

  if (userTexts.length === 1) {
    summaryParts.push(`The caller inquired: "${userTexts[0]}".`);
    if (assistantTexts.length > 1) {
      summaryParts.push(
        `The agent provided the details and concluded: "${assistantTexts[assistantTexts.length - 1]}".`,
      );
    } else if (assistantTexts.length === 1) {
      summaryParts.push(`The agent replied: "${assistantTexts[0]}".`);
    }
  } else {
    const userTopics = userTexts.join('; ');
    const finalReply = assistantTexts[assistantTexts.length - 1];

    summaryParts.push(
      `The conversation covered the following caller inquiries: "${userTopics}".`,
    );
    if (finalReply) {
      summaryParts.push(
        `The agent addressed the inquiries and concluded: "${finalReply}".`,
      );
    }
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
  generateConversationSummary: typeof generateConversationSummaryFromTranscript;
  request: BrowserConversationLifecycleRequestBody;
  scheduleBackgroundWork: ScheduleBackgroundWork;
  supabase: SupabaseClient;
}): Promise<void> {
  const requestTranscriptMessages = args.request.transcriptMessages ?? [];
  if (requestTranscriptMessages.length > 0) {
    const rows = requestTranscriptMessages.map((message, index) => ({
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

  const databaseMessages = await loadConversationSummaryTranscript({
    conversationId: args.conversation.id,
    supabase: args.supabase,
    tenantId: args.conversation.tenant_id,
  });
  const transcriptMessages = preferSummaryTranscript({
    databaseMessages,
    requestMessages: normalizeSummaryTranscriptMessages(requestTranscriptMessages),
  });

  const shouldWriteSummary = shouldReplaceConversationSummary(
    args.conversation.summary,
  );
  const fallbackSummary = shouldWriteSummary
    ? buildFallbackSummary({
        endReason: args.request.endReason,
        event: args.request.event,
        transcriptMessages,
      })
    : undefined;

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

  if (!fallbackSummary && !outcome && !args.request.runtimeSnapshot) {
    return;
  }

  const artifactUpdate: {
    outcome?: string;
    runtime_snapshot?: BrowserConversationRuntimeSnapshot | Record<string, unknown> | null;
    summary?: string;
  } = {};

  if (fallbackSummary && shouldWriteSummary) {
    artifactUpdate.summary = fallbackSummary;
  }

  if (outcome && !args.conversation.outcome?.trim()) {
    artifactUpdate.outcome = outcome;
  }

  if (args.request.runtimeSnapshot) {
    artifactUpdate.runtime_snapshot = runtimeSnapshot;
  }

  if (Object.keys(artifactUpdate).length > 0) {
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

  if (args.request.event === 'connected') {
    return;
  }

  const conversationId = args.conversation.id;
  const tenantId = args.conversation.tenant_id;
  const agentId = args.conversation.agent_id;
  const endReason = args.request.endReason;
  const event = args.request.event;
  const existingSummary = fallbackSummary ?? args.conversation.summary;
  const existingOutcome = artifactUpdate.outcome ?? args.conversation.outcome;
  const shouldGenerateSummary =
    shouldWriteSummary && transcriptMessages.length > 0;

  args.scheduleBackgroundWork(async () => {
    let summary = existingSummary ?? null;

    if (shouldGenerateSummary) {
      const generatedSummary = await generateAndPersistConversationSummary({
        conversationId,
        endReason,
        event,
        existingSummary,
        generateConversationSummary: args.generateConversationSummary,
        supabase: args.supabase,
        tenantId,
        transcriptMessages,
      });

      if (generatedSummary) {
        summary = generatedSummary;
      }
    }

    await deliverCloseOffNotification({
      agentId,
      conversationId,
      outcome: existingOutcome,
      summary,
      supabase: args.supabase,
      tenantId,
    });
  });
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
    .select(
      'id, tenant_id, agent_id, status, started_at, end_reason, summary, outcome, runtime_snapshot',
    )
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
  const generateConversationSummary =
    deps.generateConversationSummary ??
    generateConversationSummaryFromTranscript;
  const scheduleBackgroundWork: ScheduleBackgroundWork =
    deps.scheduleBackgroundWork ??
    ((task) => {
      void task().catch(() => {
        // Best-effort Gemini summary; lifecycle finalize already returned.
      });
    });
  const revalidateConversationsPath =
    deps.revalidateConversationsPath ?? (() => {});

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
            generateConversationSummary,
            request: args.request,
            scheduleBackgroundWork,
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
        .select(
          'id, tenant_id, agent_id, status, started_at, end_reason, summary, outcome, runtime_snapshot',
        )
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
          conversation: {
            ...conversation,
            ...updatedConversation,
          },
          generateConversationSummary,
          request: args.request,
          scheduleBackgroundWork,
          supabase,
        });
      } else if (
        updatedConversation.status === 'completed' ||
        updatedConversation.status === 'failed'
      ) {
        const conversationId = updatedConversation.id;
        const tenantId = updatedConversation.tenant_id;
        const agentId = conversation.agent_id;

        scheduleBackgroundWork(async () => {
          await deliverCloseOffNotification({
            agentId,
            conversationId,
            outcome: updatedConversation.outcome,
            summary: updatedConversation.summary,
            supabase,
            tenantId,
          });
        });
      }

      if (
        updatedConversation.status === 'completed' ||
        updatedConversation.status === 'failed'
      ) {
        revalidateConversationsPath();
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
    generateConversationSummary: generateConversationSummaryFromTranscript,
    getSupabaseAdminEnv,
    loadWorkspaceContext,
    now: () => new Date(),
    revalidateConversationsPath: () => {
      revalidatePath(CONVERSATIONS_DASHBOARD_PATH);
    },
  });
