import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLoginHref,
  isProtectedRoute,
  sanitizeReturnPath,
  WORKSPACE_ONBOARDING_PATH,
} from '../lib/auth/paths';

test('isProtectedRoute matches dashboard routes only', () => {
  assert.equal(isProtectedRoute('/dashboard'), true);
  assert.equal(isProtectedRoute('/dashboard/agents'), true);
  assert.equal(isProtectedRoute(WORKSPACE_ONBOARDING_PATH), true);
  assert.equal(isProtectedRoute('/login'), false);
  assert.equal(isProtectedRoute('/api/health'), false);
});

test('sanitizeReturnPath prevents open redirects', () => {
  assert.equal(sanitizeReturnPath('/dashboard/agents'), '/dashboard/agents');
  assert.equal(sanitizeReturnPath('https://example.com'), '/dashboard');
  assert.equal(sanitizeReturnPath('//malicious'), '/dashboard');
  assert.equal(sanitizeReturnPath(undefined), '/dashboard');
});

test('buildLoginHref preserves a safe next path', () => {
  assert.equal(
    buildLoginHref('/dashboard/conversations'),
    '/login?next=%2Fdashboard%2Fconversations',
  );
  assert.equal(
    buildLoginHref('https://example.com'),
    '/login?next=%2Fdashboard',
  );
});
