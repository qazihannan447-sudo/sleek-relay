import { formatConversationOutcomeLabel } from '../conversations/helpers';
import { resolveConnectedDurationMs } from '../conversations/connected-duration';
import { normalizeSafeJsonObject } from '../conversations/helpers';
import {
  extractTotalTokens,
  formatTokenCount,
} from '../conversations/usage-metrics';
import { usagePeriodLabel } from './period';
import {
  formatUsageDayKey,
  formatUsageDayLabel,
  listUsageDayKeys,
  resolveUsagePeriodBounds,
  type UsagePeriodBounds,
} from './period-bounds';
import type {
  UsageAnalyticsView,
  UsageCapStatus,
  UsageNamedValue,
  UsagePeriodId,
  UsageSeriesPoint,
} from './types';

/** Default monthly connected-minute budget until tenant caps are stored. */
export const DEFAULT_TENANT_CONNECTED_MINUTE_CAP = 180;
export { resolveConnectedDurationMs } from '../conversations/connected-duration';

function buildConversationsHref(bounds: UsagePeriodBounds): string {
  const from = formatUsageDayKey(bounds.start);
  const to = formatUsageDayKey(bounds.end);
  const params = new URLSearchParams({ from, to });
  return `/dashboard/conversations?${params.toString()}`;
}

export type UsageConversationInput = {
  agentId: string;
  durationMs: number | null;
  endedAt: string | null;
  id: string;
  latencyMetrics: unknown;
  outcome: string | null;
  startedAt: string;
  status: string;
  usageMetrics?: unknown;
};

export type UsageAgentInput = {
  id: string;
  name: string;
};

export type BuildUsageAnalyticsArgs = {
  agents: UsageAgentInput[];
  capMinutes?: number;
  conversations: UsageConversationInput[];
  now?: Date;
  periodId: UsagePeriodId;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildCapStatus(usedPercent: number): UsageCapStatus {
  if (usedPercent >= 100) {
    return 'exceeded';
  }

  if (usedPercent >= 80) {
    return 'warning';
  }

  return 'within';
}

export function msToMinutes(durationMs: number): number {
  return durationMs / 60_000;
}

function percentile(sortedAscending: number[], percentileRank: number): number {
  if (sortedAscending.length === 0) {
    return 0;
  }

  if (sortedAscending.length === 1) {
    return sortedAscending[0] ?? 0;
  }

  const rank = Math.round(
    (percentileRank / 100) * (sortedAscending.length - 1),
  );
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, rank),
  );
  return sortedAscending[index] ?? 0;
}

export function extractSpeechStopToBotSpeakingSamples(
  latencyMetrics: unknown,
): number[] {
  const metrics = normalizeSafeJsonObject(latencyMetrics);
  const turnsRaw = Array.isArray(metrics.turns) ? metrics.turns : [];
  const samples: number[] = [];

  for (const turn of turnsRaw) {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) {
      continue;
    }

    const rawTurn = normalizeSafeJsonObject(turn);
    if (rawTurn.status !== 'ok') {
      continue;
    }

    const rawMetrics = normalizeSafeJsonObject(rawTurn.metrics);
    const value =
      rawMetrics.speechStopToBotSpeakingMs ??
      rawMetrics.speech_stop_to_bot_speaking_ms;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      samples.push(Math.round(value));
    }
  }

  return samples;
}

function outcomeBucket(conversation: UsageConversationInput): string {
  if (conversation.outcome?.trim()) {
    return formatConversationOutcomeLabel(conversation.outcome);
  }

  switch (conversation.status) {
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    case 'starting':
    case 'active':
      return 'In progress';
    case 'completed':
      return 'Completed';
    default:
      return 'Other';
  }
}

function buildMinutesOverTime(
  conversations: Array<UsageConversationInput & { connectedMs: number }>,
  bounds: UsagePeriodBounds,
): UsageSeriesPoint[] {
  const dayKeys = listUsageDayKeys(bounds);
  const totals = new Map(dayKeys.map((key) => [key, 0]));

  for (const conversation of conversations) {
    const startedMs = Date.parse(conversation.startedAt);
    if (!Number.isFinite(startedMs)) {
      continue;
    }

    const dayKey = formatUsageDayKey(new Date(startedMs));
    const current = totals.get(dayKey);
    if (current === undefined) {
      continue;
    }

    totals.set(dayKey, current + conversation.connectedMs);
  }

  return dayKeys.map((dayKey) => ({
    dayKey,
    label: formatUsageDayLabel(dayKey),
    value: round1(msToMinutes(totals.get(dayKey) ?? 0)),
  }));
}

function buildMinutesByAgent(
  conversations: Array<UsageConversationInput & { connectedMs: number }>,
  agents: UsageAgentInput[],
): UsageNamedValue[] {
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const totals = new Map<string, number>();

  for (const conversation of conversations) {
    const current = totals.get(conversation.agentId) ?? 0;
    totals.set(conversation.agentId, current + conversation.connectedMs);
  }

  return [...totals.entries()]
    .map(([agentId, connectedMs]) => ({
      label: nameById.get(agentId)?.trim() || 'Unknown agent',
      value: round1(msToMinutes(connectedMs)),
    }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value);
}

function buildOutcomes(
  conversations: UsageConversationInput[],
): UsageNamedValue[] {
  const counts = new Map<string, number>();

  for (const conversation of conversations) {
    const label = outcomeBucket(conversation);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value);
}

export function buildUsageAnalytics(
  args: BuildUsageAnalyticsArgs,
): UsageAnalyticsView {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();
  const capMinutes = args.capMinutes ?? DEFAULT_TENANT_CONNECTED_MINUTE_CAP;
  const bounds = resolveUsagePeriodBounds(args.periodId, now);

  const conversations = args.conversations.map((conversation) => ({
    ...conversation,
    connectedMs: resolveConnectedDurationMs(conversation, nowMs),
  }));

  const totalConnectedMs = conversations.reduce(
    (sum, conversation) => sum + conversation.connectedMs,
    0,
  );
  const connectedMinutes = round1(msToMinutes(totalConnectedMs));
  const sessionCount = conversations.length;
  const averageSessionMinutes =
    sessionCount > 0 ? round1(connectedMinutes / sessionCount) : 0;

  const latencySamples = conversations
    .flatMap((conversation) =>
      extractSpeechStopToBotSpeakingSamples(conversation.latencyMetrics),
    )
    .sort((left, right) => left - right);

  const usedPercent = Math.min(
    100,
    Math.round((connectedMinutes / Math.max(capMinutes, 1)) * 100),
  );
  const remainingMinutes = Math.max(0, round1(capMinutes - connectedMinutes));

  let estimatedTokensTotal = 0;
  let hasTokenMetering = false;
  for (const conversation of conversations) {
    const tokens = extractTotalTokens(conversation.usageMetrics);
    if (tokens === null) {
      continue;
    }
    hasTokenMetering = true;
    estimatedTokensTotal += tokens;
  }

  return {
    averageSessionMinutes,
    capMinutes,
    capStatus: buildCapStatus(usedPercent),
    connectedMinutes,
    conversationsHref: buildConversationsHref(bounds),
    estimatedTokensLabel: hasTokenMetering
      ? formatTokenCount(estimatedTokensTotal)
      : '—',
    hasTokenMetering,
    latency:
      latencySamples.length > 0
        ? {
            p50Seconds: round1(percentile(latencySamples, 50) / 1000),
            p95Seconds: round1(percentile(latencySamples, 95) / 1000),
          }
        : null,
    minutesByAgent: buildMinutesByAgent(conversations, args.agents),
    minutesOverTime: buildMinutesOverTime(conversations, bounds),
    outcomes: buildOutcomes(conversations),
    periodId: args.periodId,
    periodLabel: usagePeriodLabel(args.periodId),
    periodRangeLabel: `${formatUsageDayLabel(formatUsageDayKey(bounds.start))} – ${formatUsageDayLabel(formatUsageDayKey(bounds.end))} (UTC)`,
    remainingMinutes,
    sessionCount,
    usedPercent,
  };
}
