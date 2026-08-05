import assert from 'node:assert/strict';
import test from 'node:test';

import { getHealthPayload } from '../lib/health';

test('getHealthPayload returns a healthy portal response', () => {
  const payload = getHealthPayload();

  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'portal');
  assert.equal(typeof payload.timestamp, 'string');
  assert.ok(Number.isFinite(Date.parse(payload.timestamp)));
});
