import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationUsageCostEstimate,
  CONNECTED_MINUTE_ESTIMATE_RATE_CAD,
  formatCadAmount,
  LLM_TOKEN_ESTIMATE_RATE_CAD,
  STT_AUDIO_SECOND_ESTIMATE_RATE_CAD,
  TTS_CHARACTER_ESTIMATE_RATE_CAD,
} from '../lib/conversations/usage-cost';
import {
  extractTotalTokens,
  formatAudioSeconds,
  formatTokenCount,
  parseConversationUsageMetrics,
} from '../lib/conversations/usage-metrics';

test('formatCadAmount formats CAD currency and unknown values', () => {
  assert.equal(formatCadAmount(0.21), '$0.21');
  assert.equal(formatCadAmount(null), '—');
});

test('buildConversationUsageCostEstimate uses minutes-only pricing with unavailable provider lines', () => {
  const estimate = buildConversationUsageCostEstimate({
    durationMs: 180_000,
    endedAt: '2026-08-08T12:03:00.000Z',
    nowMs: Date.parse('2026-08-08T12:10:00.000Z'),
    startedAt: '2026-08-08T12:00:00.000Z',
  });

  assert.equal(estimate.connectedMinutes, 3);
  assert.equal(estimate.estimateScope, 'minutes_only');
  assert.equal(
    estimate.estimatedTotalCad,
    Math.round(3 * CONNECTED_MINUTE_ESTIMATE_RATE_CAD * 100) / 100,
  );
  assert.equal(estimate.lines.length, 4);
  assert.equal(estimate.lines[0]?.key, 'connected_minutes');
  assert.equal(estimate.lines[0]?.status, 'estimated');
  assert.equal(estimate.lines[1]?.status, 'unavailable');
  assert.equal(estimate.lines[2]?.status, 'unavailable');
  assert.equal(estimate.lines[3]?.status, 'unavailable');
  assert.equal(formatCadAmount(estimate.estimatedTotalCad), '$0.21');
});

test('buildConversationUsageCostEstimate includes recorded STT, LLM, and TTS metering', () => {
  const estimate = buildConversationUsageCostEstimate({
    durationMs: 180_000,
    startedAt: '2026-08-08T12:00:00.000Z',
    endedAt: '2026-08-08T12:03:00.000Z',
    usageMetrics: {
      version: 1,
      stt: {
        audio_seconds: 90,
        call_count: 1,
        source: 'input_audio',
      },
      llm: {
        prompt_tokens: 1000,
        completion_tokens: 250,
        total_tokens: 1250,
        call_count: 2,
      },
      tts: {
        characters: 500,
        call_count: 3,
      },
    },
  });

  const expectedMinutes =
    Math.round(3 * CONNECTED_MINUTE_ESTIMATE_RATE_CAD * 100) / 100;
  const expectedStt =
    Math.round(90 * STT_AUDIO_SECOND_ESTIMATE_RATE_CAD * 10000) / 10000;
  const expectedLlm =
    Math.round(1250 * LLM_TOKEN_ESTIMATE_RATE_CAD * 10000) / 10000;
  const expectedTts =
    Math.round(500 * TTS_CHARACTER_ESTIMATE_RATE_CAD * 10000) / 10000;

  assert.equal(estimate.estimateScope, 'metered');
  assert.equal(estimate.lines[1]?.status, 'estimated');
  assert.equal(estimate.lines[2]?.status, 'estimated');
  assert.equal(estimate.lines[3]?.status, 'estimated');
  assert.equal(estimate.lines[1]?.amountCad, expectedStt);
  assert.equal(estimate.lines[2]?.amountCad, expectedTts);
  assert.equal(estimate.lines[3]?.amountCad, expectedLlm);
  assert.equal(
    estimate.estimatedTotalCad,
    Math.round(
      (expectedMinutes + expectedStt + expectedTts + expectedLlm) * 10000,
    ) / 10000,
  );
});

test('buildConversationUsageCostEstimate prefers connected session timeline over stored duration', () => {
  const estimate = buildConversationUsageCostEstimate({
    durationMs: 180_000,
    endedAt: '2026-08-08T12:03:00.000Z',
    latencyMetrics: {
      session_events: [
        {
          type: 'session_started',
          at: '2026-08-08T12:00:30.000Z',
        },
        {
          type: 'session_ended',
          at: '2026-08-08T12:03:00.000Z',
        },
      ],
    },
    startedAt: '2026-08-08T12:00:00.000Z',
  });

  assert.equal(estimate.connectedDurationMs, 150_000);
  assert.equal(estimate.connectedMinutes, 2.5);
  assert.equal(estimate.estimatedTotalCad, 0.18);
});

test('buildConversationUsageCostEstimate does not bill timeline sessions that never connected', () => {
  const estimate = buildConversationUsageCostEstimate({
    durationMs: 45_000,
    endedAt: '2026-08-08T12:00:45.000Z',
    latencyMetrics: {
      session_events: [
        {
          type: 'session_failed',
          at: '2026-08-08T12:00:45.000Z',
        },
      ],
    },
    startedAt: '2026-08-08T12:00:00.000Z',
  });

  assert.equal(estimate.connectedDurationMs, 0);
  assert.equal(estimate.connectedMinutes, 0);
  assert.equal(estimate.estimatedTotalCad, null);
  assert.equal(estimate.lines[0]?.status, 'unavailable');
});

test('buildConversationUsageCostEstimate returns null total when duration is unknown', () => {
  const estimate = buildConversationUsageCostEstimate({
    durationMs: null,
    endedAt: null,
    nowMs: Date.parse('2026-08-08T12:10:00.000Z'),
    startedAt: null,
  });

  assert.equal(estimate.connectedMinutes, 0);
  assert.equal(estimate.estimatedTotalCad, null);
  assert.equal(estimate.lines[0]?.status, 'unavailable');
  assert.equal(formatCadAmount(estimate.estimatedTotalCad), '—');
});

test('parseConversationUsageMetrics and format helpers', () => {
  assert.equal(extractTotalTokens(null), null);
  assert.equal(
    extractTotalTokens({
      llm: { total_tokens: 2460, prompt_tokens: 1, completion_tokens: 1 },
    }),
    2460,
  );
  assert.equal(formatTokenCount(1840), '1,840');
  assert.equal(formatTokenCount(12_400), '12.4k');
  assert.equal(formatAudioSeconds(12.34), '12.3 s');
  assert.equal(formatAudioSeconds(90), '1.50 min');

  const parsed = parseConversationUsageMetrics({
    version: 1,
    llm: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      call_count: 1,
      model: 'gemini-2.0-flash',
    },
    tts: { characters: 40, call_count: 1 },
    stt: { audio_seconds: 12.5, call_count: 1, source: 'metrics' },
  });
  assert.equal(parsed.llm?.totalTokens, 15);
  assert.equal(parsed.tts?.characters, 40);
  assert.equal(parsed.stt?.audioSeconds, 12.5);
  assert.equal(parsed.stt?.source, 'metrics');
});
