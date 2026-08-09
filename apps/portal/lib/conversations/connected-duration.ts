import { parseConversationLatencyDiagnostics } from './conversation-timeline';

type ConnectedDurationInput = {
  durationMs: number | null;
  endedAt?: string | null;
  latencyMetrics?: unknown;
  startedAt?: string | null;
};

function parseEventTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveTimelineConnectedDurationMs(
  input: Pick<ConnectedDurationInput, 'endedAt' | 'latencyMetrics'>,
  nowMs: number,
): number | null {
  const diagnostics = parseConversationLatencyDiagnostics(input.latencyMetrics);

  if (diagnostics.sessionEvents.length === 0) {
    return null;
  }

  const sessionStartedMs = diagnostics.sessionEvents
    .filter((event) => event.type === 'session_started')
    .map((event) => parseEventTimestamp(event.at))
    .find((value): value is number => value !== null);

  if (sessionStartedMs === undefined) {
    return 0;
  }

  const sessionEndedMs =
    diagnostics.sessionEvents
      .filter((event) => event.type === 'session_ended')
      .map((event) => parseEventTimestamp(event.at))
      .find((value): value is number => value !== null) ??
    parseEventTimestamp(input.endedAt) ??
    nowMs;

  if (!Number.isFinite(sessionEndedMs) || sessionEndedMs < sessionStartedMs) {
    return 0;
  }

  return sessionEndedMs - sessionStartedMs;
}

export function resolveConnectedDurationMs(
  input: ConnectedDurationInput,
  nowMs: number,
): number {
  const timelineDurationMs = resolveTimelineConnectedDurationMs(input, nowMs);
  if (timelineDurationMs !== null) {
    return timelineDurationMs;
  }

  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  ) {
    return input.durationMs;
  }

  const startedMs = parseEventTimestamp(input.startedAt);
  if (startedMs === null) {
    return 0;
  }

  const endedMs = parseEventTimestamp(input.endedAt) ?? nowMs;
  if (!Number.isFinite(endedMs) || endedMs < startedMs) {
    return 0;
  }

  return endedMs - startedMs;
}
