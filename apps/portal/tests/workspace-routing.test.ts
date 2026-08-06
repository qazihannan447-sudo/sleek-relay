import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKSPACE_ONBOARDING_PATH } from '../lib/auth/paths';
import {
  DEFAULT_AUTHENTICATED_PATH,
  getAuthenticatedAppPath,
} from '../lib/workspace/routing';

test('getAuthenticatedAppPath sends users without a workspace to onboarding', () => {
  assert.equal(
    getAuthenticatedAppPath({
      hasWorkspace: false,
      nextPath: '/dashboard/agents',
    }),
    WORKSPACE_ONBOARDING_PATH,
  );
});

test('getAuthenticatedAppPath preserves safe dashboard targets for existing workspaces', () => {
  assert.equal(
    getAuthenticatedAppPath({
      hasWorkspace: true,
      nextPath: '/dashboard/business',
    }),
    '/dashboard/business',
  );
});

test('getAuthenticatedAppPath falls back to the dashboard when no next path is provided', () => {
  assert.equal(
    getAuthenticatedAppPath({
      hasWorkspace: true,
      nextPath: undefined,
    }),
    DEFAULT_AUTHENTICATED_PATH,
  );
});

test('getAuthenticatedAppPath avoids sending existing workspaces back to onboarding', () => {
  assert.equal(
    getAuthenticatedAppPath({
      hasWorkspace: true,
      nextPath: WORKSPACE_ONBOARDING_PATH,
    }),
    DEFAULT_AUTHENTICATED_PATH,
  );
});
