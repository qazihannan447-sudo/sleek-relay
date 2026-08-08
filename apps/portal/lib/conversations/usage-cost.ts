/**
 * Temporary minutes-only estimate until STT/TTS/token metering is stored.
 * Rough pilot rate: ~CAD $21 / 300 connected minutes.
 */
export const CONNECTED_MINUTE_ESTIMATE_RATE_CAD = 0.07;

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
  estimateScope: 'minutes_only';
  estimatedTotalCad: number | null;
  lines: UsageCostLine[];
};

export type ConversationUsageCostInput = {
  durationMs: number | null;
  endedAt?: string | null;
  nowMs?: number;
  startedAt?: string | null;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
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

  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountCad);
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
    {
      key: 'tts',
      label: 'Text-to-speech',
      status: 'unavailable',
      amountCad: null,
      detail: 'TTS characters not recorded yet',
    },
    {
      key: 'llm',
      label: 'LLM tokens',
      status: 'unavailable',
      amountCad: null,
      detail: 'Token usage not recorded yet',
    },
  ];

  return {
    connectedDurationMs,
    connectedMinutes,
    estimateScope: 'minutes_only',
    estimatedTotalCad: minutesAmount,
    lines,
  };
}
