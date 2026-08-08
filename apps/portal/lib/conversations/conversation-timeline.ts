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

export type TurnDiagnosticsStatus = 'ok' | 'interrupted' | 'error' | 'end_session';

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
  totalTurnDurationMs: number | null;
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

export type ConversationLatencyDiagnostics = {
  failure: ConversationFailureSummary | null;
  isLegacyFallback: boolean;
  sessionEvents: ConversationSessionEvent[];
  turns: ConversationTurnDiagnostics[];
  version: number | null;
};

export type ConversationMessageChipSide = 'stt' | 'assistant';

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
  };
}

function parseTurnMetrics(value: unknown): ConversationTurnMetrics {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as SafeJsonObject)
      : {};

  return {
    speechStopToSttFinalMs: readNonNegativeInt(
      raw.speechStopToSttFinalMs ?? raw.speech_stop_to_stt_final_ms,
    ),
    sttFinalToLlmFirstTokenMs: readNonNegativeInt(
      raw.sttFinalToLlmFirstTokenMs ?? raw.stt_final_to_llm_first_token_ms,
    ),
    llmFirstTokenToTtsFirstAudioMs: readNonNegativeInt(
      raw.llmFirstTokenToTtsFirstAudioMs ??
        raw.llm_first_token_to_tts_first_audio_ms,
    ),
    speechStopToBotSpeakingMs: readNonNegativeInt(
      raw.speechStopToBotSpeakingMs ?? raw.speech_stop_to_bot_speaking_ms,
    ),
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

  if (failure?.stage) {
    return `Failed · ${formatFailureStageLabel(failure.stage)}`;
  }

  const trimmedOutcome = outcome?.trim();
  if (trimmedOutcome && /^failed\s*·/i.test(trimmedOutcome)) {
    return trimmedOutcome;
  }

  const inferred = inferFailureStageFromStoredError({
    errorCode: errorHints?.errorCode,
    errorMessage: errorHints?.errorMessage,
    endReason: errorHints?.endReason,
    outcome,
  });

  if (inferred && inferred !== 'unknown') {
    return `Failed · ${formatFailureStageLabel(inferred)}`;
  }

  return 'Failed';
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
    turn.metrics.botSpeakingDurationMs != null
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

export function formatTurnChipSummary(
  turn: ConversationTurnDiagnostics,
  side: ConversationMessageChipSide,
): string {
  const parts: string[] = [turn.status === 'error' ? 'error' : turn.status];

  if (side === 'stt') {
    if (turn.metrics.speechStopToSttFinalMs != null) {
      parts.push(
        `speech→STT ${formatChipDuration(turn.metrics.speechStopToSttFinalMs)}`,
      );
    } else if (turn.status === 'error') {
      parts.push('STT failed');
    }
  } else {
    if (turn.metrics.sttFinalToLlmFirstTokenMs != null) {
      parts.push(
        `STT→LLM ${formatChipDuration(turn.metrics.sttFinalToLlmFirstTokenMs)}`,
      );
    }
    if (turn.metrics.llmFirstTokenToTtsFirstAudioMs != null) {
      parts.push(
        `LLM→TTS ${formatChipDuration(turn.metrics.llmFirstTokenToTtsFirstAudioMs)}`,
      );
    }
    if (turn.metrics.botSpeakingDurationMs != null) {
      parts.push(
        `spoke ${formatChipDuration(turn.metrics.botSpeakingDurationMs)}`,
      );
    } else if (turn.metrics.totalTurnDurationMs != null) {
      parts.push(`turn ${formatChipDuration(turn.metrics.totalTurnDurationMs)}`);
    }
  }

  return parts.join(' · ');
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
      return stage.toolName ? `tool ${stage.toolName}` : 'tool';
    default:
      return stage.stage;
  }
}

export function formatSessionEventTimestamp(at: string | null): string | null {
  if (!at) {
    return null;
  }

  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return at;
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
