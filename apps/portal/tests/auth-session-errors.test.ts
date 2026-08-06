import assert from 'node:assert/strict';
import test from 'node:test';

import { isMissingAuthSessionError } from '../lib/supabase/auth-errors';

test('isMissingAuthSessionError recognizes Supabase missing-session errors', () => {
  assert.equal(
    isMissingAuthSessionError({
      message: 'Auth session missing!',
      name: 'AuthSessionMissingError',
    }),
    true,
  );

  assert.equal(
    isMissingAuthSessionError({
      message: 'Auth session missing!',
    }),
    true,
  );
});

test('isMissingAuthSessionError ignores unrelated auth failures', () => {
  assert.equal(
    isMissingAuthSessionError({
      message: 'Invalid login credentials',
      name: 'AuthApiError',
    }),
    false,
  );

  assert.equal(isMissingAuthSessionError(null), false);
});
