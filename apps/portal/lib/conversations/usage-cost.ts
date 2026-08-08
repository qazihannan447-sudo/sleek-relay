/**
 * Soft CAD estimate for pilot usage visibility.
 * Minutes remain the primary connected-time charge; LLM/TTS lines are
 * indicative until provider invoices are wired.
 */

import {
  parseConversationUsageMetrics,
  type ConversationUsageMetrics,
} from './usage-metrics';

export const CONNECTED_MINUTE_ESTIMATE_RATE_CAD = 0.07;

/** Rough Gemini Flash blended token rate (CAD / token). */
export const LLM_TOKEN_ESTIMATE_RATE_CAD = 0.0000004;

/** Rough Cartesia character rate (CAD / character). */
export const TTS_CHARACTER_ESTIMATE_RATE_CAD = 0.00002;

export type UsageCostLineStatus = 'estimated' | 'unavailable';

export type UsageCostLine = {
  amountCad: number | null;
  detail: string;
  key: string;
  label: string;
  status: UsageCostLineStatus;
};

export type ConversationUsageCostEstimate = {
  connectedDurationMs: number;
  connectedMinutes: number;
  estimateScope: 'minutes_only' | 'metered' | 'partial';
  estimatedTotalCad: number | null;
  lines: UsageCostLine[];
};

export type ConversationUsageCostInput = {
  durationMs: number | null;
  endedAt?: string | null;
  nowMs?: number;
  startedAt?: string | null;
  usageMetrics?: unknown;
};

function roundCurrency(value: number, fractionDigits = 2): number {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

function roundMinutes(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveConnectedDurationMs(
  input: ConversationUsageCostInput,
  nowMs: number,
): number {
  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  ) {
    return input.durationMs;
  }

  const startedAt = input.startedAt?.trim();
  if (!startedAt) {
    return 0;
  }

  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    return 0;
  }

  const endedMs = input.endedAt ? Date.parse(input.endedAt) : nowMs;
  if (!Number.isFinite(endedMs) || endedMs < startedMs) {
    return 0;
  }

  return endedMs - startedMs;
}

export function formatCadAmount(amountCad: number | null): string {
  if (amountCad === null || !Number.isFinite(amountCad)) {
    return '—';
  }

  const fractionDigits = amountCad > 0 && amountCad < 0.01 ? 4 : 2;

  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amountCad);
}

function buildLlmLine(usage: ConversationUsageMetrics): UsageCostLine {
  if (!usage.llm || usage.llm.totalTokens <= 0) {
    return {
      key: 'llm',
      label: 'LLM tokens',
      status: 'unavailable',
      amountCad: null,
      detail: 'Token usage not recorded yet',
    };
  }

  const amountCad = roundCurrency(
    usage.llm.totalTokens * LLM_TOKEN_ESTIMATE_RATE_CAD,
    4,
  );

  return {
    key: 'llm',
    label: 'LLM tokens',
    status: 'estimated',
    amountCad,
    detail: `${usage.llm.totalTokens.toLocaleString('en-CA')} tokens · ${usage.llm.promptTokens.toLocaleString('en-CA')} prompt / ${usage.llm.completionTokens.toLocaleString('en-CA')} completion`,
  };
}

function buildTtsLine(usage: ConversationUsageMetrics): UsageCostLine {
  if (!usage.tts || usage.tts.characters <= 0) {
    return {
      key: 'tts',
      label: 'Text-to-speech',
      status: 'unavailable',
      amountCad: null,
      detail: 'TTS characters not recorded yet',
    };
  }

  const amountCad = roundCurrency(
    usage.tts.characters * TTS_CHARACTER_ESTIMATE_RATE_CAD,
    4,
  );

  return {
    key: 'tts',
    label: 'Text-to-speech',
    status: 'estimated',
    amountCad,
    detail: `${usage.tts.characters.toLocaleString('en-CA')} characters`,
  };
}

export function buildConversationUsageCostEstimate(
  input: ConversationUsageCostInput,
): ConversationUsageCostEstimate {
  const nowMs = input.nowMs ?? Date.now();
  const connectedDurationMs = resolveConnectedDurationMs(input, nowMs);
  const connectedMinutes = roundMinutes(connectedDurationMs / 60_000);
  const hasDuration = connectedDurationMs > 0;
  const minutesAmount = hasDuration
    ? roundCurrency(connectedMinutes * CONNECTED_MINUTE_ESTIMATE_RATE_CAD)
    : null;
  const usage = parseConversationUsageMetrics(input.usageMetrics);

  const lines: UsageCostLine[] = [
    {
      key: 'connected_minutes',
      label: 'Connected minutes',
      status: hasDuration ? 'estimated' : 'unavailable',
      amountCad: minutesAmount,
      detail: hasDuration
        ? `${connectedMinutes} min × $${CONNECTED_MINUTE_ESTIMATE_RATE_CAD.toFixed(2)}/min`
        : 'No connected duration stored yet',
    },
    {
      key: 'stt',
      label: 'Speech-to-text',
      status: 'unavailable',
      amountCad: null,
      detail: 'STT seconds not recorded yet',
    },
    buildTtsLine(usage),
    buildLlmLine(usage),
  ];

  const estimatedAmounts = lines
    .map((line) => line.amountCad)
    .filter((amount): amount is number => typeof amount === 'number');

  const hasLlm = usage.llm !== null;
  const hasTts = usage.tts !== null;
  const estimateScope =
    hasLlm && hasTts
      ? 'metered'
      : hasLlm || hasTts
        ? 'partial'
        : 'minutes_only';

  return {
    connectedDurationMs,
    connectedMinutes,
    estimateScope,
    estimatedTotalCad:
      estimatedAmounts.length > 0
        ? roundCurrency(
            estimatedAmounts.reduce((sum, amount) => sum + amount, 0),
            4,
          )
        : null,
    lines,
  };
}
