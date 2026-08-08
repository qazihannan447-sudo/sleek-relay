import { after } from 'next/server';

import { createServerSupabaseClient } from '../supabase/server';
import {
  createServerSupabaseAdminClient,
  getSupabaseAdminEnv,
} from '../supabase/admin';
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from '../dashboard/load-workspace-context';
import {
  generateAndPersistConversationSummary,
  normalizeSummaryTranscriptMessages,
} from './conversation-summary-persistence';
import {
  generateConversationSummaryFromTranscript,
} from './generate-conversation-summary';
import {
  conversationSummaryNeedsGeneration,
  resolveConversationSummaryUiState,
  type ConversationSummaryUiState,
} from './conversation-summary-state';
import {
  formatConversationMessageRoleLabel,
  formatConversationMessageState,
  formatConversationSourceLabel,
  formatConversationStatusLabel,
  formatOptionalConversationText,
  getAllowedConversationMetadataFields,
  getAllowedLatencyMetrics,
  getAllowedRuntimeSnapshotFields,
  isConversationUuid,
  resolveConversationMessageTimestamp,
  sanitizeConversationReturnTo,
  selectTranscriptState,
  sortConversationMessagesBySequence,
  type ConversationStatus,
  type SafeDetailField,
} from './helpers';

type ConversationDetailRow = {
  agent_id: string;
  duration_ms: number | null;
  ended_at: string | null;
  end_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  id: string;
  latency_metrics: unknown;
  metadata: unknown;
  outcome: string | null;
  runtime_snapshot: unknown;
  source: string;
  started_at: string;
  status: ConversationStatus;
  summary: string | null;
};

type ConversationMessageRow = {
  content: string;
  created_at: string;
  ended_at: string | null;
  id: string;
  interrupted: boolean;
  is_final: boolean;
  role: string;
  sequence_number: number;
  started_at: string | null;
};

type AgentRow = {
  id: string;
  name: string;
};

export type ConversationDetailMessage = {
  content: string;
  id: string;
  interrupted: boolean;
  interruptedLabel: string | null;
  isFinal: boolean;
  role: string;
  roleLabel: string;
  sequenceNumber: number;
  stateLabel: string;
  timestamp: string;
};

export type ConversationDetailLoaderInput = {
  returnTo?: string | string[] | undefined;
};

export type ConversationDetailPageData =
  | {
      backToHref: string;
      conversation: {
        agentId: string;
        agentName: string;
        durationMs: number | null;
        endedAt: string | null;
        endReason: string;
        errorCode: string | null;
        errorMessage: string | null;
        id: string;
        outcome: string;
        source: string;
        sourceLabel: string;
        startedAt: string;
        status: ConversationStatus;
        statusLabel: string;
        summary: string;
        summaryState: ConversationSummaryUiState;
      };
      email: string;
      kind: 'authenticated';
      latencyMetrics: ReturnType<typeof getAllowedLatencyMetrics>;
      membershipRole: string;
      metadataFields: SafeDetailField[];
      messages: ConversationDetailMessage[];
      runtimeSnapshotFields: SafeDetailField[];
      tenantName: string;
      tenantSlug: string;
      transcriptState: ReturnType<typeof selectTranscriptState>;
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
      email: string;
      kind: 'not-found';
      membershipRole: string;
      tenantName: string;
    }
  | {
      kind: 'unauthenticated';
    };

type ScheduleBackgroundWork = (_task: () => Promise<void>) => void;

type ConversationDetailLoaderDeps = {
  createServerSupabaseAdminClient: typeof createServerSupabaseAdminClient;
  createServerSupabaseClient: typeof createServerSupabaseClient;
  generateConversationSummary: typeof generateConversationSummaryFromTranscript;
  getSupabaseAdminEnv: typeof getSupabaseAdminEnv;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  scheduleBackgroundWork: ScheduleBackgroundWork;
};

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load the selected conversation right now. Please try again.';
}

function toNotFoundResult(workspace: Extract<WorkspaceContext, { kind: 'authenticated' }>) {
  return {
    email: workspace.email,
    kind: 'not-found' as const,
    membershipRole: workspace.membershipRole,
    tenantName: workspace.tenantName,
  };
}

function formatAgentName(agent: AgentRow | null): string {
  return agent?.name ?? 'Unavailable agent';
}

export function createConversationDetailPageLoader(
  deps: ConversationDetailLoaderDeps,
) {
  return async function loadConversationDetailPageData(
    conversationId: string,
    input: ConversationDetailLoaderInput = {},
  ): Promise<ConversationDetailPageData> {
    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind !== 'authenticated') {
        return workspace;
      }

      const backToHref =
        sanitizeConversationReturnTo(input.returnTo) ??
        '/dashboard/conversations';

      if (!isConversationUuid(conversationId)) {
        return toNotFoundResult(workspace);
      }

      const supabase = await deps.createServerSupabaseClient();
      const { data: conversationData, error: conversationError } = await supabase
        .from('conversations')
        .select(
          'id, agent_id, source, status, started_at, ended_at, duration_ms, summary, outcome, end_reason, runtime_snapshot, latency_metrics, metadata, error_code, error_message',
        )
        .eq('tenant_id', workspace.tenantId)
        .eq('id', conversationId)
        .maybeSingle();

      if (conversationError) {
        return {
          email: workspace.email,
          kind: 'error',
          message:
            'Unable to load the selected conversation through row-level security.',
        };
      }

      const conversation = conversationData as ConversationDetailRow | null;

      if (!conversation) {
        return toNotFoundResult(workspace);
      }

      const [agentResult, messagesResult] = await Promise.all([
        supabase
          .from('agents')
          .select('id, name')
          .eq('tenant_id', workspace.tenantId)
          .eq('id', conversation.agent_id)
          .maybeSingle(),
        supabase
          .from('conversation_messages')
          .select(
            'id, sequence_number, role, content, is_final, interrupted, started_at, ended_at, created_at',
          )
          .eq('tenant_id', workspace.tenantId)
          .eq('conversation_id', conversation.id)
          .order('sequence_number', { ascending: true }),
      ]);

      if (agentResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message:
            'Unable to load the agent linked to the selected conversation.',
        };
      }

      if (messagesResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message:
            'Unable to load the transcript linked to the selected conversation.',
        };
      }

      const messages = sortConversationMessagesBySequence(
        ((messagesResult.data ?? []) as ConversationMessageRow[]).map((message) => {
          const presentation = formatConversationMessageState({
            interrupted: message.interrupted,
            isFinal: message.is_final,
          });

          return {
            content: message.content,
            id: message.id,
            interrupted: message.interrupted,
            interruptedLabel: presentation.interruptedLabel,
            isFinal: message.is_final,
            role: message.role,
            roleLabel: formatConversationMessageRoleLabel(message.role),
            sequenceNumber: message.sequence_number,
            stateLabel: presentation.stateLabel,
            timestamp: resolveConversationMessageTimestamp({
              createdAt: message.created_at,
              endedAt: message.ended_at,
              startedAt: message.started_at,
            }),
          };
        }),
      );

      let summaryText = conversation.summary;
      const summaryState = resolveConversationSummaryUiState({
        hasTranscript: messages.length > 0,
        status: conversation.status,
        summary: conversation.summary,
      });

      if (
        conversationSummaryNeedsGeneration({
          hasTranscript: messages.length > 0,
          status: conversation.status,
          summary: conversation.summary,
        })
      ) {
        const conversationIdForSummary = conversation.id;
        const endReason = conversation.end_reason;
        const existingSummary = conversation.summary;
        const source = conversation.source;
        const event = conversation.status === 'failed' ? 'failed' : 'completed';
        const transcriptMessages = normalizeSummaryTranscriptMessages(messages);
        const tenantId = workspace.tenantId;
        const generateConversationSummary = deps.generateConversationSummary;

        deps.scheduleBackgroundWork(async () => {
          try {
            deps.getSupabaseAdminEnv();
            const admin = await deps.createServerSupabaseAdminClient();
            await generateAndPersistConversationSummary({
              conversationId: conversationIdForSummary,
              endReason,
              event,
              existingSummary,
              generateConversationSummary,
              source,
              supabase: admin,
              tenantId,
              transcriptMessages,
            });
          } catch {
            // Best-effort backfill; detail rendering already returned.
          }
        });
      }

      return {
        backToHref,
        conversation: {
          agentId: conversation.agent_id,
          agentName: formatAgentName((agentResult.data as AgentRow | null) ?? null),
          durationMs: conversation.duration_ms,
          endedAt: conversation.ended_at,
          endReason: formatOptionalConversationText(conversation.end_reason),
          errorCode: conversation.error_code,
          errorMessage: conversation.error_message,
          id: conversation.id,
          outcome: formatOptionalConversationText(conversation.outcome),
          source: conversation.source,
          sourceLabel: formatConversationSourceLabel(conversation.source),
          startedAt: conversation.started_at,
          status: conversation.status,
          statusLabel: formatConversationStatusLabel(conversation.status),
          summary: formatOptionalConversationText(summaryText),
          summaryState,
        },
        email: workspace.email,
        kind: 'authenticated',
        latencyMetrics: getAllowedLatencyMetrics(conversation.latency_metrics),
        membershipRole: workspace.membershipRole,
        metadataFields: getAllowedConversationMetadataFields(conversation.metadata),
        messages,
        runtimeSnapshotFields: getAllowedRuntimeSnapshotFields(
          conversation.runtime_snapshot,
        ),
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        transcriptState: selectTranscriptState(messages.length),
      };
    } catch (error) {
      return {
        email: null,
        kind: 'error',
        message: buildFailureMessage(error),
      };
    }
  };
}

export const loadConversationDetailPageData = createConversationDetailPageLoader({
  createServerSupabaseAdminClient,
  createServerSupabaseClient,
  generateConversationSummary: generateConversationSummaryFromTranscript,
  getSupabaseAdminEnv,
  loadWorkspaceContext,
  scheduleBackgroundWork: after,
});
