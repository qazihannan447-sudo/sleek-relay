import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCaptureFiltersHref,
  formatCaptureStatusLabel,
  formatCaptureTypeLabel,
  hasActiveCaptureFilters,
  normalizeCaptureFilters,
  selectCaptureEmptyState,
  summarizeCapturePayload,
} from '../lib/captures/helpers';

const agents = [
  { id: 'agent-1', name: 'Front desk' },
  { id: 'agent-2', name: 'Sales' },
];

test('normalizeCaptureFilters keeps valid type and agent filters', () => {
  const filters = normalizeCaptureFilters(
    {
      agent: 'agent-2',
      from: '2026-08-01',
      page: '2',
      to: '2026-08-08',
      type: 'handoff_request',
    },
    agents,
  );

  assert.equal(filters.type, 'handoff_request');
  assert.equal(filters.agentId, 'agent-2');
  assert.equal(filters.from, '2026-08-01');
  assert.equal(filters.to, '2026-08-08');
  assert.equal(filters.page, 2);
  assert.equal(filters.fromTimestamp, '2026-08-01T00:00:00.000Z');
  assert.equal(filters.toExclusiveTimestamp, '2026-08-09T00:00:00.000Z');
  assert.equal(hasActiveCaptureFilters(filters), true);
});

test('normalizeCaptureFilters drops unknown type and agent values', () => {
  const filters = normalizeCaptureFilters(
    {
      agent: 'missing',
      type: 'not-a-type',
    },
    agents,
  );

  assert.equal(filters.type, null);
  assert.equal(filters.agentId, null);
  assert.equal(hasActiveCaptureFilters(filters), false);
});

test('buildCaptureFiltersHref encodes filters and omits page 1', () => {
  const filters = normalizeCaptureFilters(
    {
      agent: 'agent-1',
      page: '1',
      type: 'lead',
    },
    agents,
  );

  assert.equal(
    buildCaptureFiltersHref('/dashboard/captures', filters),
    '/dashboard/captures?type=lead&agent=agent-1',
  );
  assert.equal(
    buildCaptureFiltersHref('/dashboard/captures', filters, { page: 3 }),
    '/dashboard/captures?type=lead&agent=agent-1&page=3',
  );
});

test('summarizeCapturePayload prefers name and contact fields', () => {
  const summary = summarizeCapturePayload({
    email: 'a@example.com',
    name: 'Ada Lovelace',
    notes: 'Interested in a demo',
    phone: '+15551212',
  });

  assert.equal(summary.primary, 'Ada Lovelace');
  assert.equal(summary.contact, '+15551212 · a@example.com');
});

test('summarizeCapturePayload includes preferred time for appointment requests', () => {
  const summary = summarizeCapturePayload({
    name: 'Ada Lovelace',
    phone: '+15551212',
    preferredTime: 'Thursday at two thirty',
  });

  assert.equal(summary.primary, 'Ada Lovelace · Thursday at two thirty');
  assert.equal(summary.contact, '+15551212');
});

test('summarizeCapturePayload includes destination for handoff requests', () => {
  const summary = summarizeCapturePayload({
    callerName: 'Ada',
    destinationValue: '555-0199',
    reason: 'Wants a callback',
  });

  assert.equal(summary.primary, 'Wants a callback · 555-0199');
  assert.equal(summary.contact, '—');
});

test('format helpers and empty-state selection cover capture inbox states', () => {
  assert.equal(formatCaptureTypeLabel('handoff_request'), 'Handoff request');
  assert.equal(formatCaptureStatusLabel('requested'), 'Requested');
  assert.equal(
    selectCaptureEmptyState({
      hasActiveFilters: false,
      totalCount: 0,
      visibleCount: 0,
    }),
    'empty',
  );
  assert.equal(
    selectCaptureEmptyState({
      hasActiveFilters: true,
      totalCount: 4,
      visibleCount: 0,
    }),
    'filtered-empty',
  );
  assert.equal(
    selectCaptureEmptyState({
      hasActiveFilters: false,
      totalCount: 2,
      visibleCount: 2,
    }),
    'results',
  );
});
