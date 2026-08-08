export type ConversationLlmUsageMetrics = {
  callCount: number;
  completionTokens: number;
  model: string | null;
  promptTokens: number;
  totalTokens: number;
};

export type ConversationTtsUsageMetrics = {
  callCount: number;
  characters: number;
  model: string | null;
};

export type ConversationUsageMetrics = {
  llm: ConversationLlmUsageMetrics | null;
  tts: ConversationTtsUsageMetrics | null;
  version: number | null;
};

function asNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }

  return null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseLlmUsage(value: unknown): ConversationLlmUsageMetrics | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const promptTokens = asNonNegativeInt(record.prompt_tokens ?? record.promptTokens) ?? 0;
  const completionTokens =
    asNonNegativeInt(record.completion_tokens ?? record.completionTokens) ?? 0;
  const totalTokens =
    asNonNegativeInt(record.total_tokens ?? record.totalTokens) ??
    promptTokens + completionTokens;
  const callCount = asNonNegativeInt(record.call_count ?? record.callCount) ?? 0;

  if (totalTokens <= 0 && callCount <= 0) {
    return null;
  }

  return {
    callCount,
    completionTokens,
    model: asOptionalString(record.model),
    promptTokens,
    totalTokens,
  };
}

function parseTtsUsage(value: unknown): ConversationTtsUsageMetrics | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const characters = asNonNegativeInt(record.characters) ?? 0;
  const callCount = asNonNegativeInt(record.call_count ?? record.callCount) ?? 0;

  if (characters <= 0 && callCount <= 0) {
    return null;
  }

  return {
    callCount,
    characters,
    model: asOptionalString(record.model),
  };
}

export function parseConversationUsageMetrics(
  value: unknown,
): ConversationUsageMetrics {
  const record = readRecord(value);
  if (!record) {
    return { llm: null, tts: null, version: null };
  }

  return {
    llm: parseLlmUsage(record.llm),
    tts: parseTtsUsage(record.tts),
    version: asNonNegativeInt(record.version),
  };
}

export function extractTotalTokens(usageMetrics: unknown): number | null {
  const parsed = parseConversationUsageMetrics(usageMetrics);
  if (!parsed.llm || parsed.llm.totalTokens <= 0) {
    return null;
  }

  return parsed.llm.totalTokens;
}

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '—';
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (value >= 10_000) {
    const thousands = value / 1_000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
  }

  return new Intl.NumberFormat('en-CA').format(Math.round(value));
}
