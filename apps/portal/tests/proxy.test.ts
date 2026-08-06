import assert from 'node:assert/strict';
import test from 'node:test';

import { config } from '../proxy';

test('proxy matcher includes the dashboard app surface', () => {
  assert.equal(Array.isArray(config.matcher), true);
  assert.equal(config.matcher[0]?.includes('api/health'), true);
  assert.equal(config.matcher[0]?.includes('_next/static'), true);
  assert.equal(config.matcher[0]?.includes('favicon.ico'), true);
});

test('proxy matcher keeps the health endpoint excluded', () => {
  assert.equal(
    config.matcher[0],
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  );
});
