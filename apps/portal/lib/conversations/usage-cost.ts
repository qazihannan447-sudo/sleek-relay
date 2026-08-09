/**
 * Soft CAD estimate for pilot usage visibility.
 * Minutes remain the primary connected-time charge; STT/LLM/TTS lines are
 * indicative until provider invoices are wired.
 */

import {
  formatAudioSeconds,
  parseConversationUsageMetrics,
  type ConversationUsageMetrics,
} from './usage-metrics';
import { resolveConnectedDurationMs } from './connected-duration';

export const CONNECTED_MINUTE_ESTIMATE_RATE_CAD = 0.07;

/** Rough Deepgram nova/flux style rate (CAD / audio second). */
export const STT_AUDIO_SECOND_ESTIMATE_RATE_CAD = 0.0001;

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
  latencyMetrics?: unknown;
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

function buildSttLine(usage: ConversationUsageMetrics): UsageCostLine {
  if (!usage.stt || usage.stt.audioSeconds <= 0) {
    return {
      key: 'stt',
      label: 'Speech-to-text',
      status: 'unavailable',
      amountCad: null,
      detail: 'STT seconds not recorded yet',
    };
  }

  const amountCad = roundCurrency(
    usage.stt.audioSeconds * STT_AUDIO_SECOND_ESTIMATE_RATE_CAD,
    4,
  );
  const sourceNote =
    usage.stt.source === 'input_audio'
      ? ' · from submitted mic audio'
      : usage.stt.source === 'metrics'
        ? ' · provider usage metrics'
        : '';

  return {
    key: 'stt',
    label: 'Speech-to-text',
    status: 'estimated',
    amountCad,
    detail: `${formatAudioSeconds(usage.stt.audioSeconds)}${sourceNote}`,
  };
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
  const connectedMinutesRaw = connectedDurationMs / 60_000;
  const connectedMinutes = roundMinutes(connectedMinutesRaw);
  const hasDuration = connectedDurationMs > 0;
  const minutesAmount = hasDuration
    ? roundCurrency(connectedMinutesRaw * CONNECTED_MINUTE_ESTIMATE_RATE_CAD)
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
    buildSttLine(usage),
    buildTtsLine(usage),
    buildLlmLine(usage),
  ];

  const estimatedAmounts = lines
    .map((line) => line.amountCad)
    .filter((amount): amount is number => typeof amount === 'number');

  const meteredCount = [usage.stt, usage.tts, usage.llm].filter(Boolean).length;
  const estimateScope =
    meteredCount === 3
      ? 'metered'
      : meteredCount > 0
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
