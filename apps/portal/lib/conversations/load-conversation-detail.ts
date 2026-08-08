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
import { resolveDisplayTimezone } from '../format-timestamp';
import {
  generateAndPersistConversationSummary,
  normalizeSummaryTranscriptMessages,
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
import {
  formatConversationMessageRoleLabel,
  formatConversationMessageState,
  formatConversationOutcomeLabel,
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
import {
  enrichConversationLatencyDiagnostics,
  parseConversationLatencyDiagnostics,
  type ConversationLatencyDiagnostics,
} from './conversation-timeline';
import {
  buildConversationUsageCostEstimate,
  type ConversationUsageCostEstimate,
} from './usage-cost';

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

type ConversationCaptureRow = {
  capture_type: string;
  created_at: string;
  id: string;
  payload: unknown;
  status: string;
};

type AgentRow = {
  id: string;
  name: string;
};

function formatCaptureTypeLabel(captureType: string): string {
  switch (captureType) {
    case 'lead':
      return 'Lead';
    case 'message':
      return 'Message';
    case 'appointment_request':
      return 'Appointment request';
    case 'handoff_request':
      return 'Handoff request';
    default:
      return captureType;
  }
}

function formatCaptureStatusLabel(status: string): string {
  switch (status) {
    case 'captured':
      return 'Captured';
    case 'requested':
      return 'Requested';
    default:
      return status;
  }
}

function formatCapturePayloadFields(
  payload: unknown,
): Array<{ label: string; value: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  const labels: Record<string, string> = {
    callbackEmail: 'Callback email',
    callbackPhone: 'Callback phone',
    callerName: 'Caller name',
    destinationType: 'Destination type',
    destinationValue: 'Destination value',
    email: 'Email',
    message: 'Message',
    name: 'Name',
    notes: 'Notes',
    party: 'Party',
    phone: 'Phone',
    preferred_time: 'Preferred time',
    preferredTime: 'Preferred time',
    reason: 'Reason',
  };

  const fields: Array<{ label: string; value: string }> = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    fields.push({
      label: labels[key] ?? key,
      value: value.trim(),
    });
  }
  return fields;
}

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

export type ConversationDetailCapture = {
  captureType: string;
  captureTypeLabel: string;
  createdAt: string;
  id: string;
  payloadFields: Array<{ label: string; value: string }>;
  status: string;
  statusLabel: string;
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
        failure: ConversationLatencyDiagnostics['failure'];
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
      diagnostics: ConversationLatencyDiagnostics;
      email: string;
      kind: 'authenticated';
      latencyMetrics: ReturnType<typeof getAllowedLatencyMetrics>;
      membershipRole: string;
      metadataFields: SafeDetailField[];
      captures: ConversationDetailCapture[];
      messages: ConversationDetailMessage[];
      runtimeSnapshotFields: SafeDetailField[];
      tenantName: string;
      tenantSlug: string;
      timezone: string;
      transcriptState: ReturnType<typeof selectTranscriptState>;
      usageCost: ConversationUsageCostEstimate;
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

      const [agentResult, messagesResult, capturesResult, businessResult] =
        await Promise.all([
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
          supabase
            .from('conversation_captures')
            .select('id, capture_type, status, payload, created_at')
            .eq('tenant_id', workspace.tenantId)
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: true }),
          supabase
            .from('business_configurations')
            .select('timezone')
            .eq('tenant_id', workspace.tenantId),
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

      if (capturesResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message:
            'Unable to load captures linked to the selected conversation.',
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

      const captures: ConversationDetailCapture[] = (
        (capturesResult.data ?? []) as ConversationCaptureRow[]
      ).map((capture) => ({
        captureType: capture.capture_type,
        captureTypeLabel: formatCaptureTypeLabel(capture.capture_type),
        createdAt: capture.created_at,
        id: capture.id,
        payloadFields: formatCapturePayloadFields(capture.payload),
        status: capture.status,
        statusLabel: formatCaptureStatusLabel(capture.status),
      }));

      let summaryText = conversation.summary;
      const needsGeneration = conversationSummaryNeedsGeneration({
        hasTranscript: messages.length > 0,
        status: conversation.status,
        summary: conversation.summary,
      });
      const hasSummaryLlm = Boolean(loadConversationSummaryLlmConfig());
      const summaryState =
        needsGeneration && !hasSummaryLlm
          ? 'ready'
          : resolveConversationSummaryUiState({
              hasTranscript: messages.length > 0,
              status: conversation.status,
              summary: conversation.summary,
            });

      // Let the summary status API perform generation while the panel polls.
      // Avoid relying on after() alone — it is unreliable on some hosts.
      if (needsGeneration && hasSummaryLlm) {
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
            // Best-effort backfill; polling API is the reliable path.
          }
        });
      }

      const diagnostics = enrichConversationLatencyDiagnostics(
        parseConversationLatencyDiagnostics(conversation.latency_metrics),
        {
          startedAt: conversation.started_at,
          endedAt: conversation.ended_at,
          status: conversation.status,
          errorCode: conversation.error_code,
          errorMessage: conversation.error_message,
          endReason: conversation.end_reason,
          outcome: conversation.outcome,
        },
      );

      const usageCost = buildConversationUsageCostEstimate({
        durationMs: conversation.duration_ms,
        endedAt: conversation.ended_at,
        startedAt: conversation.started_at,
      });
      const businessRows = (businessResult.data ?? []) as Array<{
        timezone: string | null;
      }>;
      const timezone = resolveDisplayTimezone(businessRows[0]?.timezone);

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
          failure:
            conversation.status === 'failed' ? diagnostics.failure : null,
          id: conversation.id,
          outcome: formatConversationOutcomeLabel(conversation.outcome),
          source: conversation.source,
          sourceLabel: formatConversationSourceLabel(conversation.source),
          startedAt: conversation.started_at,
          status: conversation.status,
          statusLabel: formatConversationStatusLabel(conversation.status),
          summary: formatOptionalConversationText(summaryText),
          summaryState,
        },
        diagnostics,
        email: workspace.email,
        kind: 'authenticated',
        latencyMetrics: getAllowedLatencyMetrics(conversation.latency_metrics),
        membershipRole: workspace.membershipRole,
        metadataFields: getAllowedConversationMetadataFields(conversation.metadata),
        captures,
        messages,
        runtimeSnapshotFields: getAllowedRuntimeSnapshotFields(
          conversation.runtime_snapshot,
        ),
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        timezone,
        transcriptState: selectTranscriptState(messages.length),
        usageCost,
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
