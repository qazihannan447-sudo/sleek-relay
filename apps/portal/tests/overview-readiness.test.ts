import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOverviewReadiness,
  buildOverviewUsageSnapshot,
  hasConfiguredBusinessHours,
  overviewReadinessStatusLabel,
  pickPrimaryTestAgentId,
  selectOverviewAgentPreview,
} from '../lib/dashboard/overview-readiness';
import { emptyBusinessHours } from '../lib/business-configuration/schema';

test('hasConfiguredBusinessHours requires at least one open day with times', () => {
  const hours = emptyBusinessHours();
  assert.equal(hasConfiguredBusinessHours(hours), false);

  hours.mon = { closed: false, open: '09:00', close: '17:00' };
  assert.equal(hasConfiguredBusinessHours(hours), true);
});

test('buildOverviewReadiness marks missing when business name is absent', () => {
  const readiness = buildOverviewReadiness({
    activeAgentCount: 0,
    approvedKnowledgeCount: 0,
    business: null,
  });

  assert.equal(readiness.status, 'missing');
  assert.equal(overviewReadinessStatusLabel(readiness.status), 'Missing');
  assert.equal(readiness.completedCount, 0);
  assert.equal(readiness.totalCount, 5);
});

test('buildOverviewReadiness becomes ready when all checks pass', () => {
  const hours = emptyBusinessHours();
  hours.tue = { closed: false, open: '10:00', close: '16:00' };

  const readiness = buildOverviewReadiness({
    activeAgentCount: 1,
    approvedKnowledgeCount: 2,
    business: {
      businessHours: hours,
      businessName: 'North Clinic',
      businessPhone: '416-555-0100',
      contactEmail: null,
    },
  });

  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.completedCount, 5);
  assert.ok(readiness.items.every((item) => item.complete));
});

test('buildOverviewReadiness stays incomplete with only a business name', () => {
  const readiness = buildOverviewReadiness({
    activeAgentCount: 0,
    approvedKnowledgeCount: 0,
    business: {
      businessHours: emptyBusinessHours(),
      businessName: 'North Clinic',
      businessPhone: null,
      contactEmail: null,
    },
  });

  assert.equal(readiness.status, 'incomplete');
  assert.equal(readiness.completedCount, 1);
  assert.equal(
    readiness.items.find((item) => item.id === 'business_name')?.complete,
    true,
  );
});

test('buildOverviewUsageSnapshot counts finished sessions and minutes', () => {
  const snapshot = buildOverviewUsageSnapshot(
    [
      {
        durationMs: 120_000,
        endedAt: '2026-08-08T12:02:00.000Z',
        startedAt: '2026-08-08T12:00:00.000Z',
        status: 'completed',
      },
      {
        durationMs: 60_000,
        endedAt: '2026-08-08T13:01:00.000Z',
        startedAt: '2026-08-08T13:00:00.000Z',
        status: 'failed',
      },
      {
        durationMs: 30_000,
        endedAt: null,
        startedAt: '2026-08-08T14:00:00.000Z',
        status: 'active',
      },
    ],
    {
      capMinutes: 180,
      now: new Date('2026-08-08T15:00:00.000Z'),
    },
  );

  assert.equal(snapshot.sessionCount, 2);
  assert.equal(snapshot.connectedMinutes, 3);
  assert.equal(snapshot.capStatus, 'within');
  assert.equal(snapshot.usedPercent, 2);
});

test('pickPrimaryTestAgentId prefers an active agent', () => {
  assert.equal(
    pickPrimaryTestAgentId([
      { id: 'a1', status: 'paused' },
      { id: 'a2', status: 'active' },
    ]),
    'a2',
  );
  assert.equal(
    pickPrimaryTestAgentId([{ id: 'a1', status: 'paused' }]),
    null,
  );
});

test('selectOverviewAgentPreview prefers active agents first', () => {
  const preview = selectOverviewAgentPreview(
    [
      { id: 'paused-a', status: 'paused' },
      { id: 'paused-b', status: 'paused' },
      { id: 'active-a', status: 'active' },
      { id: 'paused-c', status: 'paused' },
      { id: 'active-b', status: 'active' },
    ],
    3,
  );

  assert.deepEqual(
    preview.map((agent) => agent.id),
    ['active-a', 'active-b', 'paused-a'],
  );
});
