import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatTimeWithSeconds,
  formatTimestamp,
  resolveDisplayTimezone,
} from '../lib/format-timestamp';

test('resolveDisplayTimezone keeps Canadian workspace timezones', () => {
  assert.equal(resolveDisplayTimezone('America/Vancouver'), 'America/Vancouver');
  assert.equal(resolveDisplayTimezone('America/Toronto'), 'America/Toronto');
});

test('resolveDisplayTimezone falls back for missing or invalid values', () => {
  assert.equal(resolveDisplayTimezone(null), 'America/Toronto');
  assert.equal(resolveDisplayTimezone(undefined), 'America/Toronto');
  assert.equal(resolveDisplayTimezone('America/Chicago'), 'America/Toronto');
});

test('formatTimestamp renders in the workspace timezone', () => {
  const value = '2026-08-06T12:00:00.000Z';

  assert.equal(
    formatTimestamp(value, { timeZone: 'America/Vancouver' }),
    '6 Aug 2026, 05:00',
  );
  assert.equal(
    formatTimestamp(value, { timeZone: 'America/Toronto' }),
    '6 Aug 2026, 08:00',
  );
  assert.equal(
    formatTimestamp(value, { timeZone: 'America/Halifax' }),
    '6 Aug 2026, 09:00',
  );
});

test('formatTimeWithSeconds renders in the workspace timezone', () => {
  const value = '2026-08-06T12:00:00.000Z';

  assert.equal(
    formatTimeWithSeconds(value, { timeZone: 'America/Vancouver' }),
    '05:00:00',
  );
  assert.equal(
    formatTimeWithSeconds(value, { timeZone: 'America/Toronto' }),
    '08:00:00',
  );
});
