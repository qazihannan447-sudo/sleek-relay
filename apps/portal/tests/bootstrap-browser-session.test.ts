import assert from 'node:assert/strict';
import test from 'node:test';

import { createBootstrapBrowserVoiceSessionService } from '../lib/voice/bootstrap-browser-session';

test('createBootstrapBrowserVoiceSessionService returns conversation, token, and runtime package together', async () => {
  const bootstrap = createBootstrapBrowserVoiceSessionService({
    buildAgentRuntimePackageForTenant: async () => ({
      ok: true,
      runtimePackage: {
        agent: {
          greeting: 'Hello from bootstrap',
        },
      } as never,
    }),
    createServerSupabaseAdminClient: async () =>
      ({
        from() {
          return {
            insert() {
              return {
                select() {
                  return {
                    async single() {
                      return {
                        data: {
                          id: 'aaaaaaaa-5000-4000-8000-000000000001',
                          started_at: '2026-08-06T12:00:00.000Z',
                          status: 'starting',
                        },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      }) as never,
    createServerSupabaseClient: async () =>
      ({
        from() {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return {
                            data: {
                              id: 'aaaaaaaa-2000-4000-8000-000000000001',
                              status: 'active',
                            },
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      }) as never,
    getSupabaseAdminEnv: () => undefined as never,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated' as const,
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-1000-4000-8000-000000000001',
      tenantName: 'Demo Tenant',
      tenantSlug: 'demo-tenant',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken: async () => ({
      expiresAt: '2026-08-06T12:30:00.000Z',
      token: 'signed-token-value',
    }),
  });

  const result = await bootstrap({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    source: 'browser_test',
  });

  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    expiresAt: '2026-08-06T12:30:00.000Z',
    runtimePackage: {
      agent: {
        greeting: 'Hello from bootstrap',
      },
    },
    startedAt: '2026-08-06T12:00:00.000Z',
    status: 'starting',
    token: 'signed-token-value',
    tokenType: 'Bearer',
  });
});

test('createBootstrapBrowserVoiceSessionService returns 404 for unavailable agents', async () => {
  const bootstrap = createBootstrapBrowserVoiceSessionService({
    buildAgentRuntimePackageForTenant: async () => {
      throw new Error('should not build runtime');
    },
    createServerSupabaseAdminClient: async () => {
      throw new Error('should not use admin client');
    },
    createServerSupabaseClient: async () =>
      ({
        from() {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return {
                            data: null,
                            error: null,
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      }) as never,
    getSupabaseAdminEnv: () => undefined as never,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated' as const,
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-1000-4000-8000-000000000001',
      tenantName: 'Demo Tenant',
      tenantSlug: 'demo-tenant',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken: async () => {
      throw new Error('should not sign');
    },
  });

  const result = await bootstrap({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    source: 'browser_test',
  });

  assert.deepEqual(result, {
    body: {
      error: 'The requested agent is unavailable.',
    },
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    },
    status: 404,
  });
});
