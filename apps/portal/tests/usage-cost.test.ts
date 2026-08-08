import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationUsageCostEstimate,
  CONNECTED_MINUTE_ESTIMATE_RATE_CAD,
  formatCadAmount,
} from '../lib/conversations/usage-cost';

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
