import { formatTimeWithSeconds } from '../format-timestamp';
import {
  normalizeSafeJsonObject,
  type SafeJsonObject,
} from './helpers';

export const failureStages = [
  'connect',
  'stt',
  'llm',
  'tts',
  'tool',
  'persist',
  'unknown',
] as const;

export type FailureStage = (typeof failureStages)[number];

export type SessionEventStatus = 'ok' | 'retry' | 'error' | 'info';

export type SessionEventType =
  | 'session_started'
  | 'greeting_played'
  | 'provider_retry'
  | 'session_failed'
  | 'session_ended';

export type TurnDiagnosticsStatus =
  | 'ok'
  | 'interrupted'
  | 'error'
  | 'end_session'
  | 'incomplete';

export type ConversationMessageChipSide = 'stt' | 'assistant';

export type ConversationSessionEvent = {
  at: string | null;
  detail: {
    callerHeard: string | null;
    endReason: string | null;
    errorCode: string | null;
    provider: string | null;
    retryCount: number | null;
  };
  durationMs: number | null;
  id: string;
  label: string;
  stage: FailureStage | null;
  status: SessionEventStatus;
  turnId: string | null;
  type: SessionEventType;
};

export type ConversationTurnStage = {
  durationMs: number | null;
  errorCode: string | null;
  label: string | null;
  provider: string | null;
  retryCount: number | null;
  side: ConversationMessageChipSide | null;
  stage: 'stt' | 'llm' | 'tts' | 'tool';
  status: 'ok' | 'retry' | 'error' | 'skipped';
  toolName: string | null;
};

export type ConversationTurnMetrics = {
  bargeInToBotSilenceMs: number | null;
  botSpeakingDurationMs: number | null;
  llmFirstTokenToTtsFirstAudioMs: number | null;
  speechStopToBotSpeakingMs: number | null;
  speechStopToSttFinalMs: number | null;
  sttFinalToLlmFirstTokenMs: number | null;
  toolCallCount: number | null;
  toolExecutionMs: number | null;
  toolName: string | null;
  totalTurnDurationMs: number | null;
  ttsFirstAudioToBotSpeakingMs: number | null;
};

export type ConversationTurnDiagnostics = {
  assistantMessageSeq: number | null;
  failureStage: FailureStage | null;
  index: number;
  metrics: ConversationTurnMetrics;
  stages: ConversationTurnStage[];
  status: TurnDiagnosticsStatus;
  turnId: string;
  userMessageSeq: number | null;
  userTranscript: string | null;
};

export type ConversationFailureSummary = {
  at: string | null;
  callerHeard: string | null;
  errorCode: string | null;
  stage: FailureStage;
  turnId: string | null;
};

export type ConversationLatencyAggregates = {
  averageResponseLatencyMs: number | null;
  averageSttLatencyMs: number | null;
  averageToolExecutionMs: number | null;
  fastestResponseLatencyMs: number | null;
  medianResponseLatencyMs: number | null;
  p95ResponseLatencyMs: number | null;
  responseSampleCount: number | null;
  slowResponseCount: number | null;
  slowestResponseLatencyMs: number | null;
  totalToolCalls: number | null;
};

export type ConversationLatencyDiagnostics = {
  aggregates: ConversationLatencyAggregates | null;
  failure: ConversationFailureSummary | null;
  isLegacyFallback: boolean;
  sessionEvents: ConversationSessionEvent[];
  turns: ConversationTurnDiagnostics[];
  version: number | null;
};

export type ConversationTurnDetailRow = {
  durationMs: number | null;
  kind?: 'total' | 'segment' | 'nested' | 'duration';
  label: string;
  provider: string | null;
  status: string | null;
};

export type ConversationLatencySummary = {
  averageResponseLatencyMs: number | null;
  averageSttLatencyMs: number | null;
  averageToolExecutionMs: number | null;
  fastestResponseLatencyMs: number | null;
  medianResponseLatencyMs: number | null;
  p95ResponseLatencyMs: number | null;
  responseSampleCount: number;
  slowResponseCount: number;
  slowestResponseLatencyMs: number | null;
  totalToolCalls: number;
};

export type ConversationTimelineMessage = {
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

export type ConversationTimelineItem =
  | {
      event: ConversationSessionEvent;
      kind: 'session';
    }
  | {
      chipSide: ConversationMessageChipSide | null;
      kind: 'message';
      message: ConversationTimelineMessage;
      turn: ConversationTurnDiagnostics | null;
    }
  | {
      kind: 'orphan_turn';
      turn: ConversationTurnDiagnostics;
    };

export type ConversationDiagnosticsEnrichmentInput = {
  endedAt?: string | null;
  endReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  outcome?: string | null;
  startedAt?: string | null;
  status?: string | null;
};

const SESSION_EVENT_TYPES = new Set<SessionEventType>([
  'session_started',
  'greeting_played',
  'provider_retry',
  'session_failed',
  'session_ended',
]);

const SESSION_EVENT_STATUSES = new Set<SessionEventStatus>([
  'ok',
  'retry',
  'error',
  'info',
]);

const TURN_STATUSES = new Set<TurnDiagnosticsStatus>([
  'ok',
  'interrupted',
  'error',
  'end_session',
  'incomplete',
]);

const STAGE_STATUSES = new Set(['ok', 'retry', 'error', 'skipped']);
const TURN_STAGES = new Set(['stt', 'llm', 'tts', 'tool']);

function isFailureStage(value: unknown): value is FailureStage {
  return (
    typeof value === 'string' &&
    (failureStages as readonly string[]).includes(value)
  );
}

function readNonNegativeInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseSessionEvent(value: unknown, index: number): ConversationSessionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as SafeJsonObject;
  const type = raw.type;
  if (typeof type !== 'string' || !SESSION_EVENT_TYPES.has(type as SessionEventType)) {
    return null;
  }

  const statusRaw = raw.status;
  const status =
    typeof statusRaw === 'string' &&
    SESSION_EVENT_STATUSES.has(statusRaw as SessionEventStatus)
      ? (statusRaw as SessionEventStatus)
      : 'info';

  const detailRaw =
    raw.detail && typeof raw.detail === 'object' && !Array.isArray(raw.detail)
      ? (raw.detail as SafeJsonObject)
      : {};

  return {
    id: readOptionalString(raw.id) ?? `sev_${index + 1}`,
    at: readOptionalString(raw.at),
    type: type as SessionEventType,
    status,
    label: readOptionalString(raw.label) ?? type.replaceAll('_', ' '),
    stage: isFailureStage(raw.stage) ? raw.stage : null,
    turnId: readOptionalString(raw.turnId) ?? readOptionalString(raw.turn_id),
    durationMs: readNonNegativeInt(raw.durationMs ?? raw.duration_ms),
    detail: {
      provider: readOptionalString(detailRaw.provider),
      retryCount: readNonNegativeInt(detailRaw.retryCount ?? detailRaw.retry_count),
      errorCode: readOptionalString(detailRaw.errorCode ?? detailRaw.error_code),
      endReason: readOptionalString(detailRaw.endReason ?? detailRaw.end_reason),
      callerHeard: readOptionalString(detailRaw.callerHeard ?? detailRaw.caller_heard),
    },
  };
}

function parseTurnStage(value: unknown): ConversationTurnStage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as SafeJsonObject;
  const stage = raw.stage;
  if (typeof stage !== 'string' || !TURN_STAGES.has(stage)) {
    return null;
  }

  const statusRaw = raw.status;
  const status =
    typeof statusRaw === 'string' && STAGE_STATUSES.has(statusRaw)
      ? (statusRaw as ConversationTurnStage['status'])
      : 'ok';

  return {
    stage: stage as ConversationTurnStage['stage'],
    status,
    durationMs: readNonNegativeInt(raw.durationMs ?? raw.duration_ms),
    provider: readOptionalString(raw.provider),
    retryCount: readNonNegativeInt(raw.retryCount ?? raw.retry_count),
    errorCode: readOptionalString(raw.errorCode ?? raw.error_code),
    toolName: readOptionalString(raw.toolName ?? raw.tool_name),
    label: readOptionalString(raw.label),
    side:
      raw.side === 'stt' || raw.side === 'assistant'
        ? raw.side
        : stage === 'stt'
          ? 'stt'
          : 'assistant',
  };
}

function parseTurnMetrics(value: unknown): ConversationTurnMetrics {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SafeJsonObject)
      : {};

  return {
    speechStopToSttFinalMs: readPositiveLatencyMs(
      raw.speechStopToSttFinalMs ?? raw.speech_stop_to_stt_final_ms,
    ),
    sttFinalToLlmFirstTokenMs: readNonNegativeInt(
      raw.sttFinalToLlmFirstTokenMs ?? raw.stt_final_to_llm_first_token_ms,
    ),
    llmFirstTokenToTtsFirstAudioMs: readNonNegativeInt(
      raw.llmFirstTokenToTtsFirstAudioMs ??
        raw.llm_first_token_to_tts_first_audio_ms,
    ),
    ttsFirstAudioToBotSpeakingMs: readNonNegativeInt(
      raw.ttsFirstAudioToBotSpeakingMs ??
        raw.tts_first_audio_to_bot_speaking_ms,
    ),
    speechStopToBotSpeakingMs: readNonNegativeInt(
      raw.speechStopToBotSpeakingMs ?? raw.speech_stop_to_bot_speaking_ms,
    ),
    toolExecutionMs: readPositiveLatencyMs(
      raw.toolExecutionMs ?? raw.tool_execution_ms,
    ),
    toolName: readOptionalString(raw.toolName ?? raw.tool_name),
    toolCallCount: readNonNegativeInt(raw.toolCallCount ?? raw.tool_call_count),
    botSpeakingDurationMs: readNonNegativeInt(
      raw.botSpeakingDurationMs ?? raw.bot_speaking_duration_ms,
    ),
    bargeInToBotSilenceMs: readNonNegativeInt(
      raw.bargeInToBotSilenceMs ?? raw.barge_in_to_bot_silence_ms,
    ),
    totalTurnDurationMs: readNonNegativeInt(
      raw.totalTurnDurationMs ?? raw.total_turn_duration_ms,
    ),
  };
}

function readPositiveLatencyMs(value: unknown): number | null {
  const parsed = readNonNegativeInt(value);
  if (parsed == null || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTurn(value: unknown, index: number): ConversationTurnDiagnostics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as SafeJsonObject;
  const turnId = readOptionalString(raw.turnId ?? raw.turn_id);
  if (!turnId) {
    return null;
  }

  const statusRaw = raw.status;
  const status =
    typeof statusRaw === 'string' && TURN_STATUSES.has(statusRaw as TurnDiagnosticsStatus)
      ? (statusRaw as TurnDiagnosticsStatus)
      : 'ok';

  const stagesRaw = Array.isArray(raw.stages) ? raw.stages : [];
  const stages = stagesRaw
    .map((stage) => parseTurnStage(stage))
    .filter((stage): stage is ConversationTurnStage => stage !== null);

  return {
    turnId,
    index: readNonNegativeInt(raw.index) ?? index + 1,
    status,
    userMessageSeq: readNonNegativeInt(
      raw.userMessageSeq ?? raw.user_message_seq,
    ),
    assistantMessageSeq: readNonNegativeInt(
      raw.assistantMessageSeq ?? raw.assistant_message_seq,
    ),
    userTranscript: readOptionalString(
      raw.userTranscript ?? raw.user_transcript,
    ),
    metrics: parseTurnMetrics(raw.metrics),
    stages,
    failureStage: isFailureStage(raw.failureStage ?? raw.failure_stage)
      ? ((raw.failureStage ?? raw.failure_stage) as FailureStage)
      : null,
  };
}

function parseFailure(value: unknown): ConversationFailureSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as SafeJsonObject;
  const stage = raw.stage;
  if (!isFailureStage(stage)) {
    return null;
  }

  return {
    stage,
    turnId: readOptionalString(raw.turnId ?? raw.turn_id),
    at: readOptionalString(raw.at),
    callerHeard: readOptionalString(raw.callerHeard ?? raw.caller_heard),
    errorCode: readOptionalString(raw.errorCode ?? raw.error_code),
  };
}

function parseAggregates(value: unknown): ConversationLatencyAggregates | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as SafeJsonObject;
  const aggregates: ConversationLatencyAggregates = {
    averageResponseLatencyMs: readNonNegativeInt(
      raw.averageResponseLatencyMs ?? raw.average_response_latency_ms,
    ),
    averageSttLatencyMs: readNonNegativeInt(
      raw.averageSttLatencyMs ?? raw.speech_stop_to_stt_final_ms,
    ),
    averageToolExecutionMs: readNonNegativeInt(
      raw.averageToolExecutionMs ?? raw.average_tool_execution_ms,
    ),
    fastestResponseLatencyMs: readNonNegativeInt(
      raw.fastestResponseLatencyMs ?? raw.fastest_response_latency_ms,
    ),
    medianResponseLatencyMs: readNonNegativeInt(
      raw.medianResponseLatencyMs ?? raw.median_response_latency_ms,
    ),
    p95ResponseLatencyMs: readNonNegativeInt(
      raw.p95ResponseLatencyMs ?? raw.p95_response_latency_ms,
    ),
    responseSampleCount: readNonNegativeInt(
      raw.responseSampleCount ?? raw.response_sample_count,
    ),
    slowResponseCount: readNonNegativeInt(
      raw.slowResponseCount ?? raw.slow_response_count,
    ),
    slowestResponseLatencyMs: readNonNegativeInt(
      raw.slowestResponseLatencyMs ?? raw.slowest_response_latency_ms,
    ),
    totalToolCalls: readNonNegativeInt(
      raw.totalToolCalls ?? raw.total_tool_calls,
    ),
  };

  const hasValue = Object.values(aggregates).some((entry) => entry !== null);
  return hasValue ? aggregates : null;
}

export function parseConversationLatencyDiagnostics(
  value: unknown,
): ConversationLatencyDiagnostics {
  const metrics = normalizeSafeJsonObject(value);
  const sessionEventsRaw = Array.isArray(metrics.session_events)
    ? metrics.session_events
    : Array.isArray(metrics.sessionEvents)
      ? metrics.sessionEvents
      : [];
  const turnsRaw = Array.isArray(metrics.turns) ? metrics.turns : [];

  return {
    aggregates: parseAggregates(metrics.aggregates),
    version: readNonNegativeInt(metrics.version),
    sessionEvents: sessionEventsRaw
      .map((event, index) => parseSessionEvent(event, index))
      .filter((event): event is ConversationSessionEvent => event !== null),
    turns: turnsRaw
      .map((turn, index) => parseTurn(turn, index))
      .filter((turn): turn is ConversationTurnDiagnostics => turn !== null),
    failure: parseFailure(metrics.failure),
    isLegacyFallback: false,
  };
}

export function inferFailureStageFromStoredError(args: {
  endReason?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  outcome?: string | null;
}): FailureStage | null {
  const haystack = [
    args.errorCode,
    args.errorMessage,
    args.endReason,
    args.outcome,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  if (!haystack) {
    return null;
  }

  if (/(^|\b)(stt|deepgram|speech.?recog|transcription)/.test(haystack)) {
    return 'stt';
  }
  if (/(^|\b)(tts|cartesia|speech.?synth|voice.?synth)/.test(haystack)) {
    return 'tts';
  }
  if (/(^|\b)(llm|gemini|foundry|model|openai)/.test(haystack)) {
    return 'llm';
  }
  if (/(^|\b)(connect|transport|daily|webrtc|network)/.test(haystack)) {
    return 'connect';
  }
  if (/(^|\b)(tool|appointment|lead|message.?capture)/.test(haystack)) {
    return 'tool';
  }
  if (/(^|\b)(persist|finalize|summary|database|supabase)/.test(haystack)) {
    return 'persist';
  }

  const outcomeMatch = haystack.match(/failed\s*·\s*(connect|stt|llm|tts|tool|persist|unknown)/);
  if (outcomeMatch && isFailureStage(outcomeMatch[1])) {
    return outcomeMatch[1];
  }

  return 'unknown';
}

export function enrichConversationLatencyDiagnostics(
  diagnostics: ConversationLatencyDiagnostics,
  conversation: ConversationDiagnosticsEnrichmentInput,
): ConversationLatencyDiagnostics {
  const hasStoredTimeline =
    diagnostics.turns.length > 0 ||
    diagnostics.sessionEvents.length > 0 ||
    diagnostics.failure != null;

  if (hasStoredTimeline) {
    return {
      ...diagnostics,
      isLegacyFallback: false,
    };
  }

  const sessionEvents: ConversationSessionEvent[] = [];
  const startedAt = readOptionalString(conversation.startedAt);
  const endedAt = readOptionalString(conversation.endedAt);
  const status = readOptionalString(conversation.status);

  if (startedAt) {
    sessionEvents.push({
      id: 'legacy_sev_started',
      at: startedAt,
      type: 'session_started',
      status: 'info',
      label: 'Session started',
      stage: null,
      turnId: null,
      durationMs: null,
      detail: {
        provider: null,
        retryCount: null,
        errorCode: null,
        endReason: null,
        callerHeard: null,
      },
    });
  }

  let failure = diagnostics.failure;
  if (!failure && status === 'failed') {
    const stage =
      inferFailureStageFromStoredError({
        errorCode: conversation.errorCode,
        errorMessage: conversation.errorMessage,
        endReason: conversation.endReason,
        outcome: conversation.outcome,
      }) ?? 'unknown';

    failure = {
      stage,
      turnId: null,
      at: endedAt,
      callerHeard: readOptionalString(conversation.errorMessage),
      errorCode: readOptionalString(conversation.errorCode),
    };

    sessionEvents.push({
      id: 'legacy_sev_failed',
      at: endedAt,
      type: 'session_failed',
      status: 'error',
      label: `Failed at ${stage.toUpperCase()}`,
      stage,
      turnId: null,
      durationMs: null,
      detail: {
        provider: null,
        retryCount: null,
        errorCode: failure.errorCode,
        endReason: readOptionalString(conversation.endReason),
        callerHeard: failure.callerHeard,
      },
    });
  }

  if (endedAt) {
    sessionEvents.push({
      id: 'legacy_sev_ended',
      at: endedAt,
      type: 'session_ended',
      status: status === 'failed' ? 'error' : 'ok',
      label: 'Session ended',
      stage: null,
      turnId: null,
      durationMs: null,
      detail: {
        provider: null,
        retryCount: null,
        errorCode: null,
        endReason: readOptionalString(conversation.endReason),
        callerHeard: null,
      },
    });
  }

  return {
    ...diagnostics,
    aggregates: diagnostics.aggregates,
    sessionEvents,
    failure,
    isLegacyFallback: true,
  };
}

export function formatFailureStageLabel(stage: FailureStage | null | undefined): string {
  if (!stage) {
    return 'Unknown';
  }

  return stage.toUpperCase();
}

export function formatConversationFailureBadge(
  status: string,
  failure: ConversationFailureSummary | null | undefined,
  outcome?: string | null,
  errorHints?: {
    endReason?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): string | null {
  if (status !== 'failed') {
    return null;
  }

  // Status pill already shows "Failed"; only surface a known stage here.
  if (failure?.stage && failure.stage !== 'unknown') {
    return formatFailureStageLabel(failure.stage);
  }

  const trimmedOutcome = outcome?.trim();
  if (trimmedOutcome && /^failed\s*·/i.test(trimmedOutcome)) {
    const stagePart = trimmedOutcome.replace(/^failed\s*·\s*/i, '').trim();
    if (stagePart && !/^unknown$/i.test(stagePart)) {
      return stagePart.toUpperCase();
    }
    return null;
  }

  const inferred = inferFailureStageFromStoredError({
    errorCode: errorHints?.errorCode,
    errorMessage: errorHints?.errorMessage,
    endReason: errorHints?.endReason,
    outcome,
  });

  if (inferred && inferred !== 'unknown') {
    return formatFailureStageLabel(inferred);
  }

  return null;
}

export function buildConversationTimelineItems(args: {
  diagnostics: ConversationLatencyDiagnostics;
  messages: ConversationTimelineMessage[];
}): ConversationTimelineItem[] {
  const { diagnostics, messages } = args;
  const items: ConversationTimelineItem[] = [];
  const turnsWithUserChip = new Set<string>();
  const turnsWithAssistantChip = new Set<string>();
  const turnsByUserSeq = new Map<number, ConversationTurnDiagnostics>();
  const turnsByAssistantSeq = new Map<number, ConversationTurnDiagnostics>();
  const turnsByUserContent = new Map<string, ConversationTurnDiagnostics>();

  for (const turn of diagnostics.turns) {
    if (turn.userMessageSeq != null && !turnsByUserSeq.has(turn.userMessageSeq)) {
      turnsByUserSeq.set(turn.userMessageSeq, turn);
    }
    if (
      turn.assistantMessageSeq != null &&
      !turnsByAssistantSeq.has(turn.assistantMessageSeq)
    ) {
      turnsByAssistantSeq.set(turn.assistantMessageSeq, turn);
    }
    if (turn.userTranscript) {
      const key = normalizeTranscriptText(turn.userTranscript);
      if (key && !turnsByUserContent.has(key)) {
        turnsByUserContent.set(key, turn);
      }
    }
  }

  const leadingEvents = diagnostics.sessionEvents.filter(
    (event) =>
      event.type === 'session_started' ||
      event.type === 'greeting_played' ||
      event.type === 'provider_retry',
  );
  const trailingEvents = diagnostics.sessionEvents.filter(
    (event) =>
      event.type === 'session_failed' || event.type === 'session_ended',
  );

  for (const event of leadingEvents) {
    items.push({ kind: 'session', event });
  }

  const userSeqToTurn = new Map<number, ConversationTurnDiagnostics>();

  for (const message of messages) {
    let turn: ConversationTurnDiagnostics | null = null;
    let chipSide: ConversationMessageChipSide | null = null;

    if (message.role === 'user') {
      turn =
        turnsByUserSeq.get(message.sequenceNumber) ??
        turnsByUserContent.get(normalizeTranscriptText(message.content)) ??
        null;
      if (turn) {
        userSeqToTurn.set(message.sequenceNumber, turn);
        turnsWithUserChip.add(turn.turnId);
        chipSide = 'stt';
      }
    } else if (message.role === 'assistant') {
      turn = turnsByAssistantSeq.get(message.sequenceNumber) ?? null;
      if (!turn) {
        turn = findAssistantTurnForMessage({
          messageSequence: message.sequenceNumber,
          messages,
          userSeqToTurn,
          turnsWithAssistantChip,
        });
      }
      if (turn && turnHasAssistantMetrics(turn) && !turnsWithAssistantChip.has(turn.turnId)) {
        turnsWithAssistantChip.add(turn.turnId);
        chipSide = 'assistant';
      } else {
        turn = null;
        chipSide = null;
      }
    }

    items.push({
      kind: 'message',
      message,
      turn,
      chipSide,
    });
  }

  for (const turn of diagnostics.turns) {
    if (turnsWithUserChip.has(turn.turnId) || turnsWithAssistantChip.has(turn.turnId)) {
      continue;
    }
    if (turn.status === 'error' || turn.failureStage) {
      items.push({ kind: 'orphan_turn', turn });
    }
  }

  for (const event of trailingEvents) {
    items.push({ kind: 'session', event });
  }

  return items;
}

function normalizeTranscriptText(value: string): string {
  return value.trim().split(/\s+/).join(' ').toLowerCase();
}

function turnHasAssistantMetrics(turn: ConversationTurnDiagnostics): boolean {
  return (
    turn.metrics.sttFinalToLlmFirstTokenMs != null ||
    turn.metrics.llmFirstTokenToTtsFirstAudioMs != null ||
    turn.metrics.speechStopToBotSpeakingMs != null ||
    turn.metrics.botSpeakingDurationMs != null ||
    turn.metrics.toolExecutionMs != null
  );
}

function findAssistantTurnForMessage(args: {
  messageSequence: number;
  messages: ConversationTimelineMessage[];
  userSeqToTurn: Map<number, ConversationTurnDiagnostics>;
  turnsWithAssistantChip: Set<string>;
}): ConversationTurnDiagnostics | null {
  let priorUserSeq: number | null = null;
  for (const message of args.messages) {
    if (message.sequenceNumber >= args.messageSequence) {
      break;
    }
    if (message.role === 'user') {
      priorUserSeq = message.sequenceNumber;
    }
  }

  if (priorUserSeq == null) {
    return null;
  }

  const turn = args.userSeqToTurn.get(priorUserSeq) ?? null;
  if (!turn || args.turnsWithAssistantChip.has(turn.turnId)) {
    return null;
  }
  if (turn.status !== 'ok' && turn.status !== 'end_session') {
    return null;
  }
  if (!turnHasAssistantMetrics(turn)) {
    return null;
  }
  return turn;
}

function formatChipDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'Unknown';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const totalSeconds = durationMs / 1000;
  const digits = totalSeconds >= 10 ? 1 : totalSeconds >= 2 ? 1 : 2;
  return `${totalSeconds.toFixed(digits)}s`;
}

function averagePositive(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentileNearestRank(sortedAscending: number[], percentileRank: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  if (sortedAscending.length === 1) {
    return sortedAscending[0] ?? null;
  }
  const rank = Math.round((percentileRank / 100) * (sortedAscending.length - 1));
  const index = Math.min(sortedAscending.length - 1, Math.max(0, rank));
  return sortedAscending[index] ?? null;
}

const SLOW_RESPONSE_THRESHOLD_MS = 1800;

const TOOL_DETAIL_LABELS: Record<string, string> = {
  capture_lead: 'Lead capture tool',
  capture_message: 'Message capture tool',
  create_appointment_request: 'Appointment tool',
  offer_human_handoff: 'Handoff tool',
};

function toolDetailLabel(toolName: string | null | undefined): string {
  if (!toolName) {
    return 'Tool execution';
  }
  return TOOL_DETAIL_LABELS[toolName] ?? `Tool ${toolName}`;
}

function isSpeakingDurationStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return (
    label.includes('speaking duration') ||
    label.includes('after response start')
  );
}

function isEndSessionGoodbyeStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return label.includes('goodbye') || label.includes('end session');
}

function isResponseLatencyStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return (
    label.includes('response total') ||
    label.includes('speech stop → bot speaking') ||
    label.includes('speech stop -> bot speaking') ||
    // Legacy persisted stage labels from earlier builds.
    label.includes('end speech →') ||
    label.includes('end speech ->')
  );
}

function isPlaybackOverheadStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return (
    label.includes('playback') ||
    label.includes('tts first audio → bot speaking') ||
    label.includes('tts first audio -> bot speaking')
  );
}

function isSttStage(stage: ConversationTurnStage): boolean {
  return stage.stage === 'stt';
}

function isLlmFirstTokenStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return (
    stage.stage === 'llm' ||
    label.includes('stt final → llm first token') ||
    label.includes('stt final -> llm first token')
  );
}

function isLlmToTtsStage(stage: ConversationTurnStage): boolean {
  const label = (stage.label ?? '').toLowerCase();
  return (
    stage.stage === 'tts' &&
    (label.includes('llm first token → tts first audio') ||
      label.includes('llm first token -> tts first audio'))
  );
}

function isToolStage(stage: ConversationTurnStage): boolean {
  return stage.stage === 'tool';
}

function detailStatusForTurn(
  turn: ConversationTurnDiagnostics,
): ConversationTurnStage['status'] {
  if (turn.status === 'error') {
    return 'error';
  }
  if (turn.status === 'interrupted') {
    return 'retry';
  }
  return 'ok';
}

export function stagesForChipSide(
  turn: ConversationTurnDiagnostics,
  side: ConversationMessageChipSide,
): ConversationTurnStage[] {
  return turn.stages.filter((stage) => {
    if (stage.side) {
      return stage.side === side;
    }
    return side === 'stt' ? stage.stage === 'stt' : stage.stage !== 'stt';
  });
}

export function buildTurnDetailRows(
  turn: ConversationTurnDiagnostics,
  side: ConversationMessageChipSide,
): ConversationTurnDetailRow[] {
  const rows: ConversationTurnDetailRow[] = [];
  const stages = stagesForChipSide(turn, side);
  const fallbackStatus = detailStatusForTurn(turn);

  if (side === 'stt') {
    const sttStage = stages.find(isSttStage) ?? null;
    if (turn.metrics.speechStopToSttFinalMs != null || sttStage) {
      rows.push({
        kind: 'segment',
        label:
          sttStage?.status === 'error'
            ? 'STT failed'
            : 'Speech stop → STT final',
        durationMs: turn.metrics.speechStopToSttFinalMs ?? sttStage?.durationMs ?? null,
        provider: sttStage?.provider ?? 'deepgram',
        status: sttStage?.status ?? (turn.metrics.speechStopToSttFinalMs != null ? 'ok' : null),
      });
    } else if (turn.status === 'error') {
      rows.push({
        kind: 'segment',
        label: 'STT failed',
        durationMs: null,
        provider: 'deepgram',
        status: 'error',
      });
    }
    return rows;
  }

  const isEndSession =
    turn.status === 'end_session' &&
    turn.metrics.sttFinalToLlmFirstTokenMs == null &&
    turn.metrics.llmFirstTokenToTtsFirstAudioMs == null;

  if (isEndSession) {
    const goodbyeStage = stages.find(isEndSessionGoodbyeStage) ?? null;
    rows.push({
      kind: 'duration',
      label: goodbyeStage?.label ?? 'End session · Goodbye played',
      durationMs:
        turn.metrics.botSpeakingDurationMs ?? goodbyeStage?.durationMs ?? null,
      provider: goodbyeStage?.provider ?? 'cartesia',
      status: goodbyeStage?.status ?? 'ok',
    });
    return rows;
  }

  // Response total first — this is what the collapsed "Response" chip measures.
  if (turn.metrics.speechStopToBotSpeakingMs != null) {
    rows.push({
      kind: 'total',
      label: 'Response total · speech stop → bot speaking',
      durationMs: turn.metrics.speechStopToBotSpeakingMs,
      provider: null,
      status: 'ok',
    });
  } else {
    const responseStage = stages.find(isResponseLatencyStage);
    if (responseStage?.durationMs != null) {
      rows.push({
        kind: 'total',
        label: 'Response total · speech stop → bot speaking',
        durationMs: responseStage.durationMs,
        provider: null,
        status: responseStage.status,
      });
    }
  }

  // Exclusive waterfall segments. When all are present they sum to Response total.
  // STT is repeated here so the agent Response breakdown is self-contained.
  const sttStage = stages.find(isSttStage) ?? null;
  if (turn.metrics.speechStopToSttFinalMs != null || sttStage?.durationMs != null) {
    rows.push({
      kind: 'segment',
      label: 'Speech stop → STT final',
      durationMs: turn.metrics.speechStopToSttFinalMs ?? sttStage?.durationMs ?? null,
      provider: sttStage?.provider ?? 'deepgram',
      status: sttStage?.status ?? fallbackStatus,
    });
  }

  const llmStage = stages.find(isLlmFirstTokenStage) ?? null;
  if (
    turn.metrics.sttFinalToLlmFirstTokenMs != null ||
    llmStage?.durationMs != null
  ) {
    rows.push({
      kind: 'segment',
      label: 'STT final → LLM first token',
      durationMs:
        turn.metrics.sttFinalToLlmFirstTokenMs ?? llmStage?.durationMs ?? null,
      provider: llmStage?.provider ?? 'gemini',
      status: llmStage?.status ?? fallbackStatus,
    });
  }

  const ttsStage = stages.find(isLlmToTtsStage) ?? null;
  if (
    turn.metrics.llmFirstTokenToTtsFirstAudioMs != null ||
    ttsStage?.durationMs != null
  ) {
    rows.push({
      kind: 'segment',
      label: 'LLM first token → TTS first audio',
      durationMs:
        turn.metrics.llmFirstTokenToTtsFirstAudioMs ?? ttsStage?.durationMs ?? null,
      // Spans remaining LLM generation plus TTS time-to-first-audio.
      provider: ttsStage?.provider ?? null,
      status: ttsStage?.status ?? fallbackStatus,
    });
  }

  if (turn.metrics.ttsFirstAudioToBotSpeakingMs != null) {
    rows.push({
      kind: 'segment',
      label: 'TTS first audio → bot speaking',
      durationMs: turn.metrics.ttsFirstAudioToBotSpeakingMs,
      provider: null,
      status: 'ok',
    });
  } else {
    const playbackStage = stages.find(isPlaybackOverheadStage);
    if (playbackStage?.durationMs != null) {
      rows.push({
        kind: 'segment',
        label: 'TTS first audio → bot speaking',
        durationMs: playbackStage.durationMs,
        provider: null,
        status: playbackStage.status,
      });
    }
  }

  // Nested diagnostic — already inside one of the exclusive segments above.
  const toolStage = stages.find(isToolStage) ?? null;
  if (turn.metrics.toolExecutionMs != null || toolStage?.durationMs != null) {
    rows.push({
      kind: 'nested',
      label:
        toolStage?.label ??
        `${toolDetailLabel(turn.metrics.toolName)} (nested; do not add)`,
      durationMs: turn.metrics.toolExecutionMs ?? toolStage?.durationMs ?? null,
      provider: toolStage?.provider ?? null,
      status: toolStage?.status ?? fallbackStatus,
    });
  }

  // After response start — not part of response latency.
  if (turn.metrics.botSpeakingDurationMs != null) {
    rows.push({
      kind: 'duration',
      label: 'Bot speaking duration (after response start)',
      durationMs: turn.metrics.botSpeakingDurationMs,
      provider: 'cartesia',
      status: 'ok',
    });
  } else {
    const speakingStage = stages.find(isSpeakingDurationStage);
    if (speakingStage?.durationMs != null) {
      rows.push({
        kind: 'duration',
        label: 'Bot speaking duration (after response start)',
        durationMs: speakingStage.durationMs,
        provider: speakingStage.provider,
        status: speakingStage.status,
      });
    }
  }

  return rows;
}

export function formatTurnChipSummary(
  turn: ConversationTurnDiagnostics,
  side: ConversationMessageChipSide,
): string {
  const stages = stagesForChipSide(turn, side);

  if (side === 'stt') {
    const sttStage = stages.find(isSttStage) ?? null;
    const parts: string[] = [];
    if (turn.status === 'error') {
      parts.push('error');
      parts.push('STT failed');
      return parts.join(' · ');
    }

    if (turn.status === 'incomplete') {
      parts.push('incomplete metrics');
    } else {
      parts.push(turn.status === 'interrupted' ? 'interrupted' : 'Transcribed');
    }
    const sttMs = turn.metrics.speechStopToSttFinalMs ?? sttStage?.durationMs ?? null;
    if (sttMs != null) {
      parts.push(`STT ${formatChipDuration(sttMs)}`);
    }
    return parts.join(' · ');
  }

  if (
    turn.status === 'end_session' &&
    turn.metrics.sttFinalToLlmFirstTokenMs == null &&
    turn.metrics.llmFirstTokenToTtsFirstAudioMs == null
  ) {
    const goodbyeStage = stages.find(isEndSessionGoodbyeStage) ?? null;
    const parts = ['End session', 'Goodbye played'];
    const goodbyeDuration =
      turn.metrics.botSpeakingDurationMs ?? goodbyeStage?.durationMs ?? null;
    if (goodbyeDuration != null) {
      parts.push(formatChipDuration(goodbyeDuration));
    }
    return parts.join(' · ');
  }

  const responseStage = stages.find(isResponseLatencyStage) ?? null;
  const llmStage = stages.find(isLlmFirstTokenStage) ?? null;
  const toolStage = stages.find(isToolStage) ?? null;
  const speakingStage = stages.find(isSpeakingDurationStage) ?? null;
  const parts: string[] = [];
  if (turn.status === 'error') {
    parts.push('error');
  } else if (turn.status === 'interrupted') {
    parts.push('interrupted');
  } else if (turn.status === 'incomplete') {
    parts.push('incomplete metrics');
  }

  const responseMs =
    turn.metrics.speechStopToBotSpeakingMs ?? responseStage?.durationMs ?? null;
  if (responseMs != null) {
    parts.push(
      `Response ${formatChipDuration(responseMs)}`,
    );
  } else {
    const llmMs =
      turn.metrics.sttFinalToLlmFirstTokenMs ?? llmStage?.durationMs ?? null;
    // Legacy turns without playback-start KPI still show processing time.
    if (llmMs != null) {
      parts.push(
        turn.metrics.toolExecutionMs != null || toolStage?.durationMs != null
          ? `Agent ${formatChipDuration(llmMs)}`
          : `LLM ${formatChipDuration(llmMs)}`,
      );
    }
  }

  if (turn.metrics.toolExecutionMs != null || toolStage?.durationMs != null) {
    parts.push('Tool executed');
  }

  const spokeMs =
    turn.metrics.botSpeakingDurationMs ?? speakingStage?.durationMs ?? null;
  if (spokeMs != null) {
    parts.push(`Spoke ${formatChipDuration(spokeMs)}`);
  }

  if (parts.length === 0) {
    parts.push(turn.status);
  }

  return parts.join(' · ');
}

export function buildConversationLatencySummary(
  diagnostics: ConversationLatencyDiagnostics,
): ConversationLatencySummary | null {
  const responseSamples: number[] = [];
  const sttSamples: number[] = [];
  const toolSamples: number[] = [];
  let totalToolCalls = 0;

  for (const turn of diagnostics.turns) {
    // Operator KPIs should only reflect completed conversational replies.
    if (turn.status !== 'ok') {
      continue;
    }
    if (
      turn.metrics.speechStopToBotSpeakingMs != null &&
      turn.metrics.speechStopToBotSpeakingMs > 0
    ) {
      responseSamples.push(turn.metrics.speechStopToBotSpeakingMs);
    }
    if (
      turn.metrics.speechStopToSttFinalMs != null &&
      turn.metrics.speechStopToSttFinalMs > 0
    ) {
      sttSamples.push(turn.metrics.speechStopToSttFinalMs);
    }
    if (
      turn.metrics.toolExecutionMs != null &&
      turn.metrics.toolExecutionMs > 0
    ) {
      toolSamples.push(turn.metrics.toolExecutionMs);
      totalToolCalls += turn.metrics.toolCallCount ?? 1;
    }
  }

  if (
    responseSamples.length === 0 &&
    sttSamples.length === 0 &&
    toolSamples.length === 0
  ) {
    if (!diagnostics.aggregates) {
      return null;
    }

    return {
      medianResponseLatencyMs: diagnostics.aggregates.medianResponseLatencyMs,
      averageResponseLatencyMs: diagnostics.aggregates.averageResponseLatencyMs,
      p95ResponseLatencyMs: diagnostics.aggregates.p95ResponseLatencyMs,
      fastestResponseLatencyMs: diagnostics.aggregates.fastestResponseLatencyMs,
      slowestResponseLatencyMs: diagnostics.aggregates.slowestResponseLatencyMs,
      slowResponseCount: diagnostics.aggregates.slowResponseCount ?? 0,
      responseSampleCount: diagnostics.aggregates.responseSampleCount ?? 0,
      averageSttLatencyMs: diagnostics.aggregates.averageSttLatencyMs,
      averageToolExecutionMs: diagnostics.aggregates.averageToolExecutionMs,
      totalToolCalls: diagnostics.aggregates.totalToolCalls ?? 0,
    };
  }

  const sortedResponses = [...responseSamples].sort((a, b) => a - b);

  return {
    medianResponseLatencyMs: percentileNearestRank(sortedResponses, 50),
    averageResponseLatencyMs: averagePositive(responseSamples),
    p95ResponseLatencyMs: percentileNearestRank(sortedResponses, 95),
    fastestResponseLatencyMs: sortedResponses[0] ?? null,
    slowestResponseLatencyMs: sortedResponses.at(-1) ?? null,
    slowResponseCount: responseSamples.filter(
      (value) => value > SLOW_RESPONSE_THRESHOLD_MS,
    ).length,
    responseSampleCount: responseSamples.length,
    averageSttLatencyMs: averagePositive(sttSamples),
    averageToolExecutionMs: averagePositive(toolSamples),
    totalToolCalls,
  };
}

export function formatStageDetailLabel(stage: ConversationTurnStage): string {
  if (stage.label) {
    return stage.label;
  }

  switch (stage.stage) {
    case 'stt':
      return stage.status === 'error' ? 'STT failed' : 'speech stop → STT final';
    case 'llm':
      return 'STT final → LLM first token';
    case 'tts':
      return 'LLM first token → TTS first audio';
    case 'tool':
      return stage.toolName
        ? `${toolDetailLabel(stage.toolName)} (nested; do not add)`
        : 'Tool execution (nested; do not add)';
    default:
      return stage.stage;
  }
}

export function turnHasOverlappingToolMetrics(
  turn: ConversationTurnDiagnostics,
): boolean {
  return turn.metrics.toolExecutionMs != null && turn.metrics.toolExecutionMs > 0;
}

export function turnHasResponseBreakdown(turn: ConversationTurnDiagnostics): boolean {
  return (
    turn.metrics.speechStopToBotSpeakingMs != null ||
    turn.metrics.sttFinalToLlmFirstTokenMs != null ||
    turn.metrics.llmFirstTokenToTtsFirstAudioMs != null ||
    turn.metrics.ttsFirstAudioToBotSpeakingMs != null
  );
}

export function formatSessionEventTimestamp(
  at: string | null,
  timeZone?: string | null,
): string | null {
  if (!at) {
    return null;
  }

  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return at;
  }

  return formatTimeWithSeconds(at, { timeZone });
}
