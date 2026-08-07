export const CONVERSATION_PAGE_SIZE = 20;

export const conversationStatuses = [
  'starting',
  'active',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ConversationStatus = (typeof conversationStatuses)[number];

export type ConversationAgentOption = {
  id: string;
  name: string;
};

export type ConversationFilterInput = {
  agent?: string | string[] | undefined;
  from?: string | string[] | undefined;
  page?: string | string[] | undefined;
  source?: string | string[] | undefined;
  status?: string | string[] | undefined;
  to?: string | string[] | undefined;
};

export type NormalizedConversationFilters = {
  agentId: string | null;
  from: string | null;
  fromTimestamp: string | null;
  page: number;
  source: string | null;
  status: ConversationStatus | null;
  to: string | null;
  toExclusiveTimestamp: string | null;
};

export type ConversationEmptyState = 'empty' | 'filtered-empty' | 'results';

export type ConversationPagination = {
  endIndex: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
  startIndex: number;
  totalCount: number;
  totalPages: number;
};

export type SafeJsonObject = Record<string, unknown>;

export type TranscriptState = 'empty' | 'results';

export type AllowedLatencyMetric = {
  key: string;
  label: string;
  valueMs: number;
  valueLabel: string;
};

export type SafeDetailField = {
  label: string;
  value: string;
};

function pickSingleValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function isIsoDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readStringValue(
  object: SafeJsonObject,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readNumberValue(
  object: SafeJsonObject,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readBooleanValue(
  object: SafeJsonObject,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const value = object[key];

    if (typeof value === 'boolean') {
      return value;
    }
  }

  return null;
}

function toUtcDateStart(value: string): Date | null {
  if (!isIsoDateValue(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export function parseConversationStatus(
  value: string | string[] | undefined,
): ConversationStatus | null {
  const normalized = pickSingleValue(value)?.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return conversationStatuses.includes(normalized as ConversationStatus)
    ? (normalized as ConversationStatus)
    : null;
}

export function parseConversationSource(
  value: string | string[] | undefined,
): string | null {
  const normalized = pickSingleValue(value)?.trim();

  return normalized ? normalized : null;
}

export function parseConversationDateValue(
  value: string | string[] | undefined,
): string | null {
  const normalized = pickSingleValue(value)?.trim();

  if (!normalized) {
    return null;
  }

  return toUtcDateStart(normalized) ? normalized : null;
}

export function parseConversationDateRange(
  from: string | string[] | undefined,
  to: string | string[] | undefined,
): Pick<
  NormalizedConversationFilters,
  'from' | 'fromTimestamp' | 'to' | 'toExclusiveTimestamp'
> {
  const normalizedFrom = parseConversationDateValue(from);
  const normalizedTo = parseConversationDateValue(to);

  const fromDate = normalizedFrom ? toUtcDateStart(normalizedFrom) : null;
  const toDate = normalizedTo ? toUtcDateStart(normalizedTo) : null;

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return {
      from: null,
      fromTimestamp: null,
      to: null,
      toExclusiveTimestamp: null,
    };
  }

  const toExclusiveDate = toDate
    ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000)
    : null;

  return {
    from: normalizedFrom,
    fromTimestamp: fromDate ? fromDate.toISOString() : null,
    to: normalizedTo,
    toExclusiveTimestamp: toExclusiveDate ? toExclusiveDate.toISOString() : null,
  };
}

export function parseConversationPage(
  value: string | string[] | undefined,
): number {
  const normalized = pickSingleValue(value)?.trim();

  if (!normalized) {
    return 1;
  }

  const page = Number.parseInt(normalized, 10);

  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function normalizeConversationAgentFilter(
  value: string | string[] | undefined,
  agents: ConversationAgentOption[],
): string | null {
  const normalized = pickSingleValue(value)?.trim();

  if (!normalized) {
    return null;
  }

  return agents.some((agent) => agent.id === normalized) ? normalized : null;
}

export function normalizeConversationFilters(
  input: ConversationFilterInput,
  agents: ConversationAgentOption[],
): NormalizedConversationFilters {
  const dateRange = parseConversationDateRange(input.from, input.to);

  return {
    agentId: normalizeConversationAgentFilter(input.agent, agents),
    from: dateRange.from,
    fromTimestamp: dateRange.fromTimestamp,
    page: parseConversationPage(input.page),
    source: parseConversationSource(input.source),
    status: parseConversationStatus(input.status),
    to: dateRange.to,
    toExclusiveTimestamp: dateRange.toExclusiveTimestamp,
  };
}

export function hasActiveConversationFilters(
  filters: Pick<NormalizedConversationFilters, 'agentId' | 'from' | 'source' | 'status' | 'to'>,
): boolean {
  return Boolean(
    filters.agentId || filters.from || filters.source || filters.status || filters.to,
  );
}

export function selectConversationEmptyState(args: {
  hasActiveFilters: boolean;
  totalConversationCount: number;
  visibleConversationCount: number;
}): ConversationEmptyState {
  if (args.visibleConversationCount > 0) {
    return 'results';
  }

  if (args.totalConversationCount === 0) {
    return 'empty';
  }

  return args.hasActiveFilters ? 'filtered-empty' : 'empty';
}

export function buildConversationPagination(args: {
  page: number;
  pageSize?: number;
  totalCount: number;
}): ConversationPagination {
  const pageSize = args.pageSize ?? CONVERSATION_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(args.totalCount / pageSize));
  const page = Math.min(Math.max(args.page, 1), totalPages);

  if (args.totalCount === 0) {
    return {
      endIndex: 0,
      hasNextPage: false,
      hasPreviousPage: false,
      page: 1,
      pageSize,
      startIndex: 0,
      totalCount: 0,
      totalPages: 1,
    };
  }

  const startIndex = (page - 1) * pageSize + 1;
  const endIndex = Math.min(page * pageSize, args.totalCount);

  return {
    endIndex,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    page,
    pageSize,
    startIndex,
    totalCount: args.totalCount,
    totalPages,
  };
}

export function isConversationUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function normalizeSafeJsonObject(value: unknown): SafeJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as SafeJsonObject;
}

export function formatConversationDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) {
    return 'Unknown';
  }

  if (durationMs < 1000) {
    return '<1s';
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

export function formatLatencyMetricDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 'Unknown';
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  const totalSeconds = durationMs / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(totalSeconds >= 10 ? 1 : 2)} s`;
  }

  return formatConversationDuration(Math.round(durationMs));
}

export function formatConversationStatusLabel(status: ConversationStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'active':
      return 'Active';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

export function formatConversationSourceLabel(source: string): string {
  return source
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatConversationMessageRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return 'User';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
    case 'tool':
      return 'Tool';
    default:
      return 'Message';
  }
}

export function formatConversationMessageState(args: {
  interrupted: boolean;
  isFinal: boolean;
}) {
  return {
    interruptedLabel: args.interrupted ? 'Interrupted' : null,
    stateLabel: args.isFinal ? 'Final' : 'Interim',
  };
}

export function resolveConversationMessageTimestamp(args: {
  createdAt: string;
  endedAt: string | null;
  startedAt: string | null;
}): string {
  return args.endedAt ?? args.startedAt ?? args.createdAt;
}

export function sortConversationMessagesBySequence<
  T extends { sequenceNumber: number },
>(messages: T[]): T[] {
  return [...messages].sort(
    (left, right) => left.sequenceNumber - right.sequenceNumber,
  );
}

export function selectTranscriptState(messageCount: number): TranscriptState {
  return messageCount > 0 ? 'results' : 'empty';
}

export function formatOptionalConversationText(
  value: string | null | undefined,
  fallback = 'Not set',
): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function formatConversationBoolean(value: boolean): string {
  return value ? 'Enabled' : 'Disabled';
}

export function formatConversationSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 'Unknown';
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  return formatConversationDuration(Math.round(seconds * 1000));
}

export function getAllowedLatencyMetrics(
  value: unknown,
): AllowedLatencyMetric[] {
  const metrics = normalizeSafeJsonObject(value);
  const allowedMetrics = [
    {
      key: 'speech_stop_to_stt_final_ms',
      label: 'Speech stop to STT final',
    },
    {
      key: 'stt_final_to_llm_first_token_ms',
      label: 'STT final to LLM first token',
    },
    {
      key: 'llm_first_token_to_tts_first_audio_ms',
      label: 'LLM first token to TTS first audio',
    },
    {
      key: 'speech_stop_to_bot_speaking_ms',
      label: 'Speech stop to bot speaking',
    },
    {
      key: 'bot_speaking_duration_ms',
      label: 'Bot speaking duration',
    },
    {
      key: 'total_turn_duration_ms',
      label: 'Total turn duration',
    },
    {
      key: 'stt_first_partial_ms',
      label: 'STT first partial',
    },
    {
      key: 'stt_final_ms',
      label: 'STT final',
    },
    {
      key: 'llm_first_token_ms',
      label: 'LLM first token',
    },
    {
      key: 'tts_first_byte_ms',
      label: 'TTS first byte',
    },
  ] as const;

  return allowedMetrics.flatMap((metric) => {
    const valueMs = metrics[metric.key];

    if (typeof valueMs !== 'number' || !Number.isFinite(valueMs) || valueMs < 0) {
      return [];
    }

    return [
      {
        key: metric.key,
        label: metric.label,
        valueLabel: formatLatencyMetricDuration(valueMs),
        valueMs,
      },
    ];
  });
}

export function getAllowedRuntimeSnapshotFields(value: unknown): SafeDetailField[] {
  const snapshot = normalizeSafeJsonObject(value);
  const fields: SafeDetailField[] = [];

  const agentName = readStringValue(snapshot, ['agent_name', 'agentName']);
  const agentRole = readStringValue(snapshot, ['role', 'agent_role', 'agentRole']);
  const language = readStringValue(snapshot, ['language']);
  const llmModel = readStringValue(snapshot, ['llm_model', 'llmModel', 'model']);
  const sttModel = readStringValue(snapshot, ['stt_model', 'sttModel']);
  const ttsModel = readStringValue(snapshot, ['tts_model', 'ttsModel']);
  const voiceLabel = readStringValue(snapshot, [
    'voice_label',
    'voiceLabel',
    'voice_id',
    'voiceId',
  ]);
  const businessName = readStringValue(snapshot, ['business_name', 'businessName']);
  const knowledgeCount = readNumberValue(snapshot, [
    'knowledge_item_count',
    'knowledgeItemCount',
    'knowledge_count',
  ]);
  const interruptionEnabled = readBooleanValue(snapshot, [
    'interruption_enabled',
    'interruptionEnabled',
  ]);
  const silenceTimeout = readNumberValue(snapshot, [
    'silence_timeout_seconds',
    'silenceTimeoutSeconds',
  ]);
  const maximumSessionDuration = readNumberValue(snapshot, [
    'maximum_session_duration_seconds',
    'maximumSessionDurationSeconds',
  ]);

  if (agentName) {
    fields.push({ label: 'Agent name', value: agentName });
  }

  if (agentRole) {
    fields.push({ label: 'Agent role', value: agentRole });
  }

  if (language) {
    fields.push({ label: 'Language', value: language });
  }

  if (llmModel) {
    fields.push({ label: 'LLM model', value: llmModel });
  }

  if (sttModel) {
    fields.push({ label: 'STT model', value: sttModel });
  }

  if (ttsModel) {
    fields.push({ label: 'TTS model', value: ttsModel });
  }

  if (voiceLabel) {
    fields.push({ label: 'Voice', value: voiceLabel });
  }

  if (businessName) {
    fields.push({ label: 'Business name', value: businessName });
  }

  if (knowledgeCount !== null) {
    fields.push({ label: 'Knowledge items', value: String(knowledgeCount) });
  }

  if (interruptionEnabled !== null) {
    fields.push({
      label: 'Interruptions',
      value: formatConversationBoolean(interruptionEnabled),
    });
  }

  if (silenceTimeout !== null) {
    fields.push({
      label: 'Silence timeout',
      value: formatConversationSeconds(silenceTimeout),
    });
  }

  if (maximumSessionDuration !== null) {
    fields.push({
      label: 'Maximum session duration',
      value: formatConversationSeconds(maximumSessionDuration),
    });
  }

  return fields;
}

export function getAllowedConversationMetadataFields(
  value: unknown,
): SafeDetailField[] {
  const metadata = normalizeSafeJsonObject(value);
  const fields: SafeDetailField[] = [];
  const browser = readStringValue(metadata, ['browser']);
  const clientType = readStringValue(metadata, ['client_type', 'clientType']);
  const transport = readStringValue(metadata, ['transport']);
  const environment = readStringValue(metadata, ['environment']);
  const sessionVersion = readStringValue(metadata, [
    'session_version',
    'sessionVersion',
  ]);

  if (browser) {
    fields.push({ label: 'Browser', value: browser });
  }

  if (clientType) {
    fields.push({ label: 'Client type', value: clientType });
  }

  if (transport) {
    fields.push({ label: 'Transport', value: transport });
  }

  if (environment) {
    fields.push({ label: 'Environment', value: environment });
  }

  if (sessionVersion) {
    fields.push({ label: 'Session version', value: sessionVersion });
  }

  return fields;
}

export function sanitizeConversationReturnTo(
  value: string | string[] | undefined,
): string | null {
  const normalized = pickSingleValue(value)?.trim();

  if (!normalized || !normalized.startsWith('/dashboard/conversations')) {
    return null;
  }

  try {
    const url = new URL(normalized, 'https://sleek-relay.local');

    if (url.origin !== 'https://sleek-relay.local') {
      return null;
    }

    if (url.pathname !== '/dashboard/conversations') {
      return null;
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

export function buildConversationFiltersHref(
  pathname: string,
  filters: NormalizedConversationFilters,
  overrides: Partial<NormalizedConversationFilters> = {},
): string {
  const nextFilters = {
    ...filters,
    ...overrides,
  };

  const searchParams = new URLSearchParams();

  if (nextFilters.status) {
    searchParams.set('status', nextFilters.status);
  }

  if (nextFilters.agentId) {
    searchParams.set('agent', nextFilters.agentId);
  }

  if (nextFilters.source) {
    searchParams.set('source', nextFilters.source);
  }

  if (nextFilters.from) {
    searchParams.set('from', nextFilters.from);
  }

  if (nextFilters.to) {
    searchParams.set('to', nextFilters.to);
  }

  if (nextFilters.page > 1) {
    searchParams.set('page', String(nextFilters.page));
  }

  const queryString = searchParams.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
}
