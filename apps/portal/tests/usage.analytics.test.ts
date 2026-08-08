import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildUsageAnalytics,
  extractSpeechStopToBotSpeakingSamples,
  resolveConnectedDurationMs,
} from '../lib/usage/build-analytics';
import {
  formatMinutes,
  formatMinutesLabel,
  usageCapStatusLabel,
} from '../lib/usage/format';
import {
  buildUsagePeriodHref,
  normalizeUsagePeriod,
  usagePeriodLabel,
} from '../lib/usage/period';
import {
  formatUsageDayKey,
  resolveUsagePeriodBounds,
} from '../lib/usage/period-bounds';

test('normalizeUsagePeriod accepts known period ids and defaults to month', () => {
  assert.equal(normalizeUsagePeriod('7d'), '7d');
  assert.equal(normalizeUsagePeriod(['30d']), '30d');
  assert.equal(normalizeUsagePeriod('month'), 'month');
  assert.equal(normalizeUsagePeriod('weird'), 'month');
  assert.equal(normalizeUsagePeriod(undefined), 'month');
});

test('buildUsagePeriodHref omits the default month query param', () => {
  assert.equal(buildUsagePeriodHref('month'), '/dashboard/usage');
  assert.equal(buildUsagePeriodHref('7d'), '/dashboard/usage?period=7d');
  assert.equal(usagePeriodLabel('30d'), 'Last 30 days');
});

test('resolveUsagePeriodBounds covers calendar month and rolling windows', () => {
  const now = new Date('2026-08-08T15:00:00.000Z');

  const month = resolveUsagePeriodBounds('month', now);
  assert.equal(month.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(month.end.toISOString(), now.toISOString());

  const week = resolveUsagePeriodBounds('7d', now);
  assert.equal(formatUsageDayKey(week.start), '2026-08-02');

  const thirty = resolveUsagePeriodBounds('30d', now);
  assert.equal(formatUsageDayKey(thirty.start), '2026-07-10');
});

test('resolveConnectedDurationMs prefers duration_ms then ended_at fallback', () => {
  const nowMs = Date.parse('2026-08-08T12:10:00.000Z');

  assert.equal(
    resolveConnectedDurationMs(
      {
        durationMs: 90_000,
        endedAt: '2026-08-08T12:05:00.000Z',
        startedAt: '2026-08-08T12:00:00.000Z',
      },
      nowMs,
    ),
    90_000,
  );

  assert.equal(
    resolveConnectedDurationMs(
      {
        durationMs: null,
        endedAt: '2026-08-08T12:05:00.000Z',
        startedAt: '2026-08-08T12:00:00.000Z',
      },
      nowMs,
    ),
    300_000,
  );

  assert.equal(
    resolveConnectedDurationMs(
      {
        durationMs: null,
        endedAt: null,
        startedAt: '2026-08-08T12:00:00.000Z',
      },
      nowMs,
    ),
    600_000,
  );
});

test('extractSpeechStopToBotSpeakingSamples reads turn and flat metrics', () => {
  assert.deepEqual(
    extractSpeechStopToBotSpeakingSamples({
      turns: [
        {
          turn_id: 't1',
          metrics: { speech_stop_to_bot_speaking_ms: 1100 },
        },
        {
          turnId: 't2',
          metrics: { speechStopToBotSpeakingMs: 1500 },
        },
      ],
    }),
    [1100, 1500],
  );

  assert.deepEqual(
    extractSpeechStopToBotSpeakingSamples({
      speech_stop_to_bot_speaking_ms: 900,
    }),
    [900],
  );
});

test('buildUsageAnalytics aggregates real conversation minutes, agents, and outcomes', () => {
  const now = new Date('2026-08-08T18:00:00.000Z');
  const analytics = buildUsageAnalytics({
    now,
    periodId: 'month',
    agents: [
      { id: 'agent-1', name: 'Front Desk' },
      { id: 'agent-2', name: 'After Hours' },
    ],
    conversations: [
      {
        id: 'c1',
        agentId: 'agent-1',
        status: 'completed',
        startedAt: '2026-08-02T10:00:00.000Z',
        endedAt: '2026-08-02T10:03:00.000Z',
        durationMs: 180_000,
        outcome: 'appointment_requested',
        latencyMetrics: {
          turns: [
            {
              turn_id: 't1',
              metrics: { speech_stop_to_bot_speaking_ms: 1000 },
            },
            {
              turn_id: 't2',
              metrics: { speech_stop_to_bot_speaking_ms: 2000 },
            },
          ],
        },
      },
      {
        id: 'c2',
        agentId: 'agent-2',
        status: 'failed',
        startedAt: '2026-08-05T11:00:00.000Z',
        endedAt: '2026-08-05T11:01:00.000Z',
        durationMs: 60_000,
        outcome: null,
        latencyMetrics: {},
      },
      {
        id: 'c3',
        agentId: 'agent-1',
        status: 'completed',
        startedAt: '2026-08-07T09:00:00.000Z',
        endedAt: '2026-08-07T09:02:00.000Z',
        durationMs: 120_000,
        outcome: 'lead_captured',
        latencyMetrics: {
          aggregates: { speech_stop_to_bot_speaking_ms: 1600 },
        },
      },
    ],
  });

  assert.equal(analytics.sessionCount, 3);
  assert.equal(analytics.connectedMinutes, 6);
  assert.equal(analytics.averageSessionMinutes, 2);
  assert.equal(analytics.estimatedTokensLabel, '—');
  assert.equal(analytics.capMinutes, 180);
  assert.equal(analytics.capStatus, 'within');
  assert.equal(usageCapStatusLabel(analytics.capStatus), 'Within limits');
  assert.equal(formatMinutes(analytics.connectedMinutes), '6');
  assert.equal(formatMinutesLabel(analytics.averageSessionMinutes), '2 min');

  assert.deepEqual(analytics.minutesByAgent, [
    { label: 'Front Desk', value: 5 },
    { label: 'After Hours', value: 1 },
  ]);

  assert.deepEqual(
    analytics.outcomes.map((item) => item.label).sort(),
    ['Appointment requested', 'Failed', 'Lead captured'],
  );

  assert.ok(analytics.latency);
  assert.equal(analytics.latency?.p50Seconds, 1.6);
  assert.equal(analytics.latency?.p95Seconds, 2);

  const augustSecond = analytics.minutesOverTime.find(
    (point) => point.label === 'Aug 2',
  );
  assert.equal(augustSecond?.value, 3);
});

test('buildUsageAnalytics returns empty-friendly zeros when there are no sessions', () => {
  const analytics = buildUsageAnalytics({
    now: new Date('2026-08-08T18:00:00.000Z'),
    periodId: '7d',
    agents: [],
    conversations: [],
  });

  assert.equal(analytics.sessionCount, 0);
  assert.equal(analytics.connectedMinutes, 0);
  assert.equal(analytics.averageSessionMinutes, 0);
  assert.equal(analytics.latency, null);
  assert.equal(analytics.minutesByAgent.length, 0);
  assert.equal(analytics.outcomes.length, 0);
  assert.ok(analytics.minutesOverTime.length >= 7);
  assert.ok(analytics.minutesOverTime.every((point) => point.value === 0));
});
