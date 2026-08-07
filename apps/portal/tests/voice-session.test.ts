import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SignJWT } from 'jose';

import {
  createIssueVoiceSessionTokenService,
  mapIssueVoiceSessionTokenSuccess,
} from '../lib/voice/issue-session-token';
import {
  createIssueVoiceSessionTokenRouteHandler,
} from '../lib/voice/issue-session-token-route';
import {
  createBrowserConversationLifecycleRouteHandler,
} from '../lib/voice/conversation-lifecycle-route';
import {
  createBrowserConversationLifecycleService,
  parseBrowserConversationLifecycleJsonRequest,
  parseBrowserConversationLifecycleRequestBody,
} from '../lib/voice/conversation-lifecycle';
import {
  createIssueVoiceRuntimeConfigRouteHandler,
  createIssueVoiceRuntimeConfigService,
} from '../lib/voice/runtime-config';
import {
  getVoiceSessionSigningConfig,
  parseBearerAuthorizationHeader,
  signVoiceSessionToken,
  verifyVoiceSessionToken,
  VOICE_SESSION_TOKEN_AUDIENCE,
  VOICE_SESSION_TOKEN_DEFAULT_TTL_SECONDS,
  VOICE_SESSION_TOKEN_ISSUER,
  VOICE_SESSION_TOKEN_PURPOSE,
  VOICE_SESSION_TOKEN_VERSION,
} from '../lib/voice/session-token';
import {
  browserConversationLifecycleEvents,
  createBrowserStartupTimingTracker,
  buildVoiceSessionRequestData,
  createBrowserVoiceBootstrap,
  createBrowserVoiceConversationLifecycle,
} from '../lib/voice/browser-test';
import {
  GENERIC_FATAL_DISCONNECT_MESSAGE,
  isTransientWebSocketError,
  mapTransportStateToStatus,
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
  stopLocalMicrophoneTracks,
} from '../lib/voice/session';
import type { AgentRuntimePackage } from '../lib/runtime/schema';
import {
  buildStartConversationInsert,
  createStartConversationService,
  mapStartConversationSuccess,
  parseStartConversationJsonRequest,
  parseStartConversationRequestBody,
} from '../lib/voice/start-conversation';
import {
  buildConversationFiltersHref,
  buildConversationPagination,
  formatConversationMessageRoleLabel,
  formatConversationMessageState,
  formatConversationDuration,
  formatOptionalConversationText,
  getAllowedConversationMetadataFields,
  getAllowedLatencyMetrics,
  getAllowedRuntimeSnapshotFields,
  isConversationUuid,
  normalizeConversationFilters,
  parseConversationDateRange,
  resolveConversationMessageTimestamp,
  selectTranscriptState,
  selectConversationEmptyState,
  sortConversationMessagesBySequence,
} from '../lib/conversations/helpers';
import { createConversationDetailPageLoader } from '../lib/conversations/load-conversation-detail';
import { getSupabaseAdminEnv } from '../lib/supabase/admin';

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T | Promise<T>,
) {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  try {
    const result = run();

    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return (result as Promise<T>).finally(restore);
    }

    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function createStartConversationSupabaseStub(args: {
  agent?: { id: string; status: 'active' | 'draft' | 'paused'; tenant_id: string } | null;
  insertError?: { message: string } | null;
  insertedConversationId?: string;
  insertedStartedAt?: string;
  onInsert?: (_value: unknown) => void;
}) {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();

      const query = {
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        insert(value: unknown) {
          if (args.onInsert) {
            args.onInsert(value);
          }
          return query;
        },
        maybeSingle: async () => {
          if (table !== 'agents') {
            return { data: null, error: null };
          }

          const agent =
            args.agent &&
            filters.get('tenant_id') === args.agent.tenant_id &&
            filters.get('id') === args.agent.id
              ? {
                  id: args.agent.id,
                  status: args.agent.status,
                }
              : null;

          return { data: agent, error: null };
        },
        select() {
          return query;
        },
        single: async () => {
          if (table !== 'conversations') {
            return { data: null, error: null };
          }

          if (args.insertError) {
            return { data: null, error: args.insertError };
          }

          return {
            data: {
              id:
                args.insertedConversationId ??
                'aaaaaaaa-3000-4000-8000-000000000001',
              started_at:
                args.insertedStartedAt ?? '2026-08-06T12:34:56.000Z',
              status: 'starting' as const,
            },
            error: null,
          };
        },
      };

      return query;
    },
  };
}

function asSupabaseClientStub<T>(value: T) {
  return value as any;
}

function createVoiceSessionTokenSupabaseStub(args: {
  agent?: { id: string; tenant_id: string } | null;
  conversation?: {
    agent_id: string;
    id: string;
    source: string;
    status: 'starting' | 'active' | 'completed' | 'failed' | 'cancelled';
    tenant_id: string;
  } | null;
  tenant?: { id: string; name: string; slug: string } | null;
}) {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();

      const query = {
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        maybeSingle: async () => {
          if (table === 'conversations') {
            const matchesConversationId =
              !filters.has('id') || filters.get('id') === args.conversation?.id;
            const matchesTenantId =
              !filters.has('tenant_id') ||
              filters.get('tenant_id') === args.conversation?.tenant_id;
            const matchesAgentId =
              !filters.has('agent_id') ||
              filters.get('agent_id') === args.conversation?.agent_id;

            const conversation =
              args.conversation &&
              matchesConversationId &&
              matchesTenantId &&
              matchesAgentId
                ? args.conversation
                : null;

            return { data: conversation, error: null };
          }

          if (table === 'agents') {
            const matchesAgentId =
              !filters.has('id') || filters.get('id') === args.agent?.id;
            const matchesTenantId =
              !filters.has('tenant_id') ||
              filters.get('tenant_id') === args.agent?.tenant_id;

            const agent =
              args.agent &&
              matchesTenantId &&
              matchesAgentId
                ? args.agent
                : null;

            return { data: agent, error: null };
          }

          if (table === 'tenants') {
            const tenant =
              args.tenant && filters.get('id') === args.tenant.id
                ? args.tenant
                : null;

            return { data: tenant, error: null };
          }

          return { data: null, error: null };
        },
        select() {
          return query;
        },
      };

      return query;
    },
  };
}

function createConversationLifecycleSupabaseStub(args: {
  conversation?: {
    end_reason: string | null;
    id: string;
    outcome?: string | null;
    runtime_snapshot?: Record<string, unknown> | null;
    started_at: string;
    status: 'starting' | 'active' | 'completed' | 'failed' | 'cancelled';
    summary?: string | null;
    tenant_id: string;
  } | null;
  messages?: Array<{
    content: string;
    conversation_id: string;
    interrupted: boolean;
    is_final: boolean;
    role: string;
    sequence_number: number;
    tenant_id: string;
  }>;
  onUpsert?: (_value: unknown) => void;
  onUpdate?: (_value: unknown) => void;
  updateError?: { message: string } | null;
  upsertError?: { message: string } | null;
}) {
  let conversation = args.conversation ? { ...args.conversation } : null;
  let messages = (args.messages ?? []).map((message) => ({ ...message }));

  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      let pendingUpdate: Record<string, unknown> | null = null;

      const query = {
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
          maybeSingle: async () => {
            if (table !== 'conversations') {
              return { data: null, error: null };
            }

          const matchesConversation =
            conversation !== null &&
            (!filters.has('id') || filters.get('id') === conversation.id) &&
            (!filters.has('tenant_id') ||
              filters.get('tenant_id') === conversation.tenant_id) &&
            (!filters.has('source') ||
              filters.get('source') === 'browser_test') &&
            (!filters.has('status') ||
              filters.get('status') === conversation.status);

          if (pendingUpdate) {
            const nextUpdate = pendingUpdate;
            pendingUpdate = null;

            if (args.updateError) {
              return { data: null, error: args.updateError };
            }

            if (!matchesConversation || !conversation) {
              return { data: null, error: null };
            }

            conversation = {
              ...conversation,
              ...nextUpdate,
            } as typeof conversation;

            return { data: conversation, error: null };
          }

          return {
            data: matchesConversation ? conversation : null,
            error: null,
          };
        },
          select() {
            return query;
          },
          upsert: async (value: unknown) => {
            if (table !== 'conversation_messages') {
              return { data: null, error: null };
            }

            if (args.onUpsert) {
              args.onUpsert(value);
            }

            if (args.upsertError) {
              return { data: null, error: args.upsertError };
            }

            const nextRows = Array.isArray(value) ? value : [];
            for (const row of nextRows as typeof messages) {
              const existingIndex = messages.findIndex(
                (message) =>
                  message.conversation_id === row.conversation_id &&
                  message.sequence_number === row.sequence_number,
              );

              if (existingIndex >= 0) {
                messages[existingIndex] = { ...messages[existingIndex], ...row };
              } else {
                messages.push({ ...row });
              }
            }

            return { data: null, error: null };
          },
          update(value: unknown) {
            pendingUpdate = value as Record<string, unknown>;

            if (args.onUpdate) {
            args.onUpdate(value);
          }

          return query;
        },
      };

      return query;
    },
  };
}

function createVoiceSessionSigningSecret() {
  return '0123456789abcdef0123456789abcdef0123456789abcdef';
}

async function signVoiceSessionTokenForTest(args: {
  agentId?: string;
  algorithm?: 'HS256' | 'HS512';
  audience?: string;
  conversationId?: string;
  expiresAtSeconds?: number;
  issuedAtSeconds?: number;
  issuer?: string;
  purpose?: string;
  source?: string;
  subject?: string;
  tokenId?: string;
  version?: number;
}) {
  const secret = new TextEncoder().encode(createVoiceSessionSigningSecret());
  const issuedAtSeconds = args.issuedAtSeconds ?? 1_754_485_200;
  const expiresAtSeconds = args.expiresAtSeconds ?? issuedAtSeconds + 1800;
  const conversationId =
    args.conversationId ?? 'aaaaaaaa-5000-4000-8000-000000000001';

  return new SignJWT({
    agentId: args.agentId ?? 'aaaaaaaa-2000-4000-8000-000000000001',
    conversationId,
    purpose: args.purpose ?? VOICE_SESSION_TOKEN_PURPOSE,
    source: args.source ?? 'browser_test',
    version: args.version ?? VOICE_SESSION_TOKEN_VERSION,
  })
    .setProtectedHeader({
      alg: args.algorithm ?? 'HS256',
      typ: 'JWT',
    })
    .setSubject(args.subject ?? conversationId)
    .setIssuer(args.issuer ?? VOICE_SESSION_TOKEN_ISSUER)
    .setAudience(args.audience ?? VOICE_SESSION_TOKEN_AUDIENCE)
    .setJti(args.tokenId ?? 'token-test-id')
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(secret);
}

function createRuntimePackageFixture(): AgentRuntimePackage {
  return {
    agent: {
      fallbackMessage: 'Please leave a message and we will follow up.',
      greeting: 'Thanks for calling Greenleaf Dental.',
      id: 'aaaaaaaa-2000-4000-8000-000000000001',
      interruptionEnabled: true,
      language: 'en',
      maximumSessionDurationSeconds: 900,
      name: 'Front Desk',
      role: 'Receptionist',
      silenceTimeoutSeconds: 8,
      specialInstructions: 'Collect the caller name and callback number.',
      status: 'active',
      tone: 'warm',
      voiceId: 'alloy',
    },
    business: {
      businessHours: {
        fri: { close: '17:00', closed: false, open: '09:00' },
        mon: { close: '17:00', closed: false, open: '09:00' },
        sat: { close: null, closed: true, open: null },
        sun: { close: null, closed: true, open: null },
        thu: { close: '17:00', closed: false, open: '09:00' },
        tue: { close: '17:00', closed: false, open: '09:00' },
        wed: { close: '17:00', closed: false, open: '09:00' },
      },
      businessName: 'Greenleaf Dental',
      businessPhone: '+1 555 0100',
      category: 'Dental',
      contactEmail: 'frontdesk@greenleaf.example',
      contactName: 'Pat Rivera',
      website: 'https://greenleaf.example',
      timezone: 'America/Chicago',
    },
    generatedAt: '2026-08-06T12:00:00.000Z',
    groundingRules: ['Use only approved tenant knowledge.'],
    knowledge: [
      {
        content: 'We accept online appointment requests.',
        id: 'aaaaaaaa-9000-4000-8000-000000000001',
        kind: 'faq',
        title: 'Appointments',
      },
    ],
    promptText: 'Prompt text',
    tenant: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      name: 'Greenleaf Dental',
      slug: 'greenleaf-dental',
    },
  };
}

function createSupabaseEnv() {
  return {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  };
}

async function withCapturedConsole<T>(run: () => Promise<T>) {
  const entries: string[] = [];
  const methods = ['log', 'info', 'warn', 'error'] as const;
  const previous = new Map<
    (typeof methods)[number],
    (..._args: unknown[]) => void
  >();

  for (const method of methods) {
    previous.set(method, console[method]);
    console[method] = (...args: unknown[]) => {
      entries.push(args.map((value) => String(value)).join(' '));
    };
  }

  try {
    return {
      entries,
      result: await run(),
    };
  } finally {
    for (const method of methods) {
      console[method] = previous.get(method)!;
    }
  }
}

test('resolveVoiceRunnerConfig accepts a valid local runner URL', () => {
  const result = resolveVoiceRunnerConfig('http://localhost:7860');

  assert.equal(result.kind, 'valid');

  if (result.kind === 'valid') {
    assert.equal(result.baseUrl, 'http://localhost:7860');
    assert.equal(result.startUrl, 'http://localhost:7860/start');
  }
});

test('resolveVoiceRunnerConfig rejects missing and malformed URLs', () => {
  const missing = resolveVoiceRunnerConfig(undefined);
  const malformed = resolveVoiceRunnerConfig('localhost:7860');

  assert.equal(missing.kind, 'invalid');
  assert.equal(malformed.kind, 'invalid');
});

test('buildVoiceSessionRequestData places the worker token in the supported SmallWebRTC fields', () => {
  assert.deepEqual(buildVoiceSessionRequestData('token-123'), {
    enableCam: false,
    enableMic: true,
    metadata: {
      voiceSessionToken: 'token-123',
    },
    voiceSessionToken: 'token-123',
  });
});

test('createBrowserVoiceBootstrap creates the conversation, then issues the session token, then returns the worker request data', async () => {
  const calls: Array<{
    body?: string;
    method?: string;
    url: string;
  }> = [];
  const timingEvents: string[] = [];

  const bootstrap = createBrowserVoiceBootstrap({
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({
        body: typeof init?.body === 'string' ? init.body : undefined,
        method: init?.method,
        url,
      });

      if (url === '/api/voice/conversations') {
        return new Response(
          JSON.stringify({
            conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
            startedAt: '2026-08-06T12:00:00.000Z',
            status: 'starting',
          }),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 201,
          },
        );
      }

      return new Response(
        JSON.stringify({
          conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
          expiresAt: '2026-08-06T12:30:00.000Z',
          token: 'signed-token-value',
          tokenType: 'Bearer',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      );
    },
  });

  const result = await bootstrap({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    onTimingEvent: (name) => timingEvents.push(name),
  });

  assert.deepEqual(calls, [
    {
      body: JSON.stringify({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
      method: 'POST',
      url: '/api/voice/conversations',
    },
    {
      body: undefined,
      method: 'POST',
      url: '/api/voice/conversations/aaaaaaaa-5000-4000-8000-000000000001/session-token',
    },
  ]);
  assert.deepEqual(result, {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    expiresAt: '2026-08-06T12:30:00.000Z',
    requestData: {
      enableCam: false,
      enableMic: true,
      metadata: {
        voiceSessionToken: 'signed-token-value',
      },
      voiceSessionToken: 'signed-token-value',
    },
    token: 'signed-token-value',
  });
  assert.deepEqual(timingEvents, [
    'conversation_creation_finished',
    'session_token_finished',
  ]);
});

test('createBrowserStartupTimingTracker logs one concise startup summary with elapsed timings', async () => {
  const entries: string[] = [];
  let now = 100;

  const tracker = createBrowserStartupTimingTracker({
    logger: {
      info: (entry: string) => entries.push(entry),
    },
    monotonicNow: () => {
      now += 25;
      return now;
    },
  });

  tracker.mark('connect_clicked');
  tracker.mark('conversation_creation_finished');
  tracker.mark('session_token_finished');
  tracker.mark('smallwebrtc_connect_started');
  tracker.mark('webrtc_connected');
  tracker.mark('worker_client_ready');
  tracker.logSummary('success');
  tracker.logSummary('failed');

  assert.deepEqual(entries, [
    'browser voice startup: outcome=success connect_clicked_ms=25 conversation_creation_finished_ms=50 session_token_finished_ms=75 smallwebrtc_connect_started_ms=100 webrtc_connected_ms=125 worker_client_ready_ms=150',
  ]);
});

test('createBrowserVoiceBootstrap returns safe visible errors when bootstrap APIs fail', async () => {
  const startFailure = createBrowserVoiceBootstrap({
    fetch: async () =>
      new Response(JSON.stringify({ error: 'The requested agent is unavailable.' }), {
        headers: {
          'content-type': 'application/json',
        },
        status: 404,
      }),
  });

  await assert.rejects(
    () =>
      startFailure({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
      }),
    /The requested agent is unavailable\./,
  );

  const tokenFailure = createBrowserVoiceBootstrap({
    fetch: async (input) => {
      const url = String(input);

      if (url === '/api/voice/conversations') {
        return new Response(
          JSON.stringify({
            conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
            startedAt: '2026-08-06T12:00:00.000Z',
            status: 'starting',
          }),
          {
            headers: {
              'content-type': 'application/json',
            },
            status: 201,
          },
        );
      }

      return new Response(
        JSON.stringify({
          error: 'The requested conversation is unavailable.',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 404,
        },
      );
    },
  });

  await assert.rejects(
    () =>
      tokenFailure({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
      }),
    /The requested conversation is unavailable\./,
  );
});

test('createBrowserVoiceBootstrap rejects malformed successful payloads safely', async () => {
  const bootstrap = createBrowserVoiceBootstrap({
    fetch: async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json',
        },
        status: 200,
      }),
  });

  await assert.rejects(
    () =>
      bootstrap({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
      }),
    /Unable to start the browser voice conversation right now\./,
  );
});

test('createBrowserVoiceConversationLifecycle sends only the narrow lifecycle payload to the authenticated endpoint', async () => {
  const calls: Array<{
    body?: string;
    method?: string;
    url: string;
  }> = [];

  const updateLifecycle = createBrowserVoiceConversationLifecycle({
    fetch: async (input, init) => {
      calls.push({
        body: typeof init?.body === 'string' ? init.body : undefined,
        method: init?.method,
        url: String(input),
      });

      return new Response(
        JSON.stringify({
          conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
          endReason: 'user_disconnect',
          finalized: true,
          status: 'completed',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        },
      );
    },
  });

  const result = await updateLifecycle({
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    endReason: browserConversationLifecycleEvents.userDisconnect,
    event: browserConversationLifecycleEvents.completed,
  });

  assert.deepEqual(calls, [
    {
      body: JSON.stringify({
        endReason: 'user_disconnect',
        errorMessage: undefined,
        event: 'completed',
      }),
      method: 'PATCH',
      url: '/api/voice/conversations/aaaaaaaa-5000-4000-8000-000000000001/lifecycle',
    },
  ]);
  assert.deepEqual(result, {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    endReason: 'user_disconnect',
    finalized: true,
    status: 'completed',
  });
});

test('createBrowserVoiceConversationLifecycle surfaces safe lifecycle endpoint failures', async () => {
  const updateLifecycle = createBrowserVoiceConversationLifecycle({
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: 'The requested conversation is unavailable.',
        }),
        {
          headers: {
            'content-type': 'application/json',
          },
          status: 404,
        },
      ),
  });

  await assert.rejects(
    () =>
      updateLifecycle({
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
        errorMessage: 'provider dropped',
        event: browserConversationLifecycleEvents.failed,
      }),
    /The requested conversation is unavailable\./,
  );
});

test('mapTransportStateToStatus compresses Pipecat transport states for the UI', () => {
  assert.equal(mapTransportStateToStatus('disconnected'), 'disconnected');
  assert.equal(mapTransportStateToStatus('initializing'), 'connecting');
  assert.equal(mapTransportStateToStatus('connected'), 'connecting');
  assert.equal(mapTransportStateToStatus('ready'), 'ready');
  assert.equal(mapTransportStateToStatus('error'), 'error');
});

test('resolveVisibleVoiceErrorMessage keeps the more specific worker failure when Pipecat emits a generic fatal disconnect message', () => {
  assert.equal(
    resolveVisibleVoiceErrorMessage({
      currentMessage: 'The requested voice session is unavailable.',
      nextMessage: GENERIC_FATAL_DISCONNECT_MESSAGE,
    }),
    'The requested voice session is unavailable.',
  );

  assert.equal(
    resolveVisibleVoiceErrorMessage({
      currentMessage: null,
      nextMessage: GENERIC_FATAL_DISCONNECT_MESSAGE,
    }),
    GENERIC_FATAL_DISCONNECT_MESSAGE,
  );
});

test('resolveVisibleVoiceErrorMessage filters out transient WebSocket 400 and rejected connection errors', () => {
  const transientMsg = 'Unknown error occurred: server rejected WebSocket connection: HTTP 400';
  assert.equal(isTransientWebSocketError(transientMsg), true);

  assert.equal(
    resolveVisibleVoiceErrorMessage({
      currentMessage: null,
      nextMessage: transientMsg,
    }),
    null,
  );

  assert.equal(
    resolveVisibleVoiceErrorMessage({
      currentMessage: 'Previous valid error',
      nextMessage: transientMsg,
    }),
    'Previous valid error',
  );
});

test('parseConversationDateRange accepts valid ISO dates and rejects invalid ranges', () => {
  const valid = parseConversationDateRange('2026-08-01', '2026-08-06');
  const invalid = parseConversationDateRange('2026-08-07', '2026-08-06');
  const malformed = parseConversationDateRange('08/01/2026', '2026-08-06');

  assert.equal(valid.from, '2026-08-01');
  assert.equal(valid.to, '2026-08-06');
  assert.equal(valid.fromTimestamp, '2026-08-01T00:00:00.000Z');
  assert.equal(valid.toExclusiveTimestamp, '2026-08-07T00:00:00.000Z');

  assert.deepEqual(invalid, {
    from: null,
    fromTimestamp: null,
    to: null,
    toExclusiveTimestamp: null,
  });
  assert.equal(malformed.from, null);
});

test('buildConversationPagination normalizes invalid and oversized page values', () => {
  const clamped = buildConversationPagination({
    page: 9,
    pageSize: 20,
    totalCount: 35,
  });
  const empty = buildConversationPagination({
    page: -2,
    pageSize: 20,
    totalCount: 0,
  });

  assert.equal(clamped.page, 2);
  assert.equal(clamped.startIndex, 21);
  assert.equal(clamped.endIndex, 35);
  assert.equal(clamped.totalPages, 2);

  assert.deepEqual(empty, {
    endIndex: 0,
    hasNextPage: false,
    hasPreviousPage: false,
    page: 1,
    pageSize: 20,
    startIndex: 0,
    totalCount: 0,
    totalPages: 1,
  });
});

test('formatConversationDuration returns readable labels across supported ranges', () => {
  assert.equal(formatConversationDuration(null), 'Unknown');
  assert.equal(formatConversationDuration(-1), 'Unknown');
  assert.equal(formatConversationDuration(900), '<1s');
  assert.equal(formatConversationDuration(12_000), '12s');
  assert.equal(formatConversationDuration(125_000), '2m 5s');
  assert.equal(formatConversationDuration(7_380_000), '2h 3m');
});

test('buildConversationFiltersHref preserves active filters and swaps page overrides', () => {
  const href = buildConversationFiltersHref(
    '/dashboard/conversations',
    {
      agentId: 'agent-a',
      from: '2026-08-01',
      fromTimestamp: '2026-08-01T00:00:00.000Z',
      page: 3,
      source: 'browser_test',
      status: 'completed',
      to: '2026-08-06',
      toExclusiveTimestamp: '2026-08-07T00:00:00.000Z',
    },
    { page: 2 },
  );

  assert.equal(
    href,
    '/dashboard/conversations?status=completed&agent=agent-a&source=browser_test&from=2026-08-01&to=2026-08-06&page=2',
  );
});

test('normalizeConversationFilters ignores agent filters outside the tenant-owned list', () => {
  const filters = normalizeConversationFilters(
    {
      agent: 'agent-b',
      page: '-4',
      status: 'active',
    },
    [{ id: 'agent-a', name: 'Agent A' }],
  );

  assert.equal(filters.agentId, null);
  assert.equal(filters.page, 1);
  assert.equal(filters.status, 'active');
});

test('selectConversationEmptyState distinguishes empty and filtered-empty states', () => {
  assert.equal(
    selectConversationEmptyState({
      hasActiveFilters: false,
      totalConversationCount: 0,
      visibleConversationCount: 0,
    }),
    'empty',
  );
  assert.equal(
    selectConversationEmptyState({
      hasActiveFilters: true,
      totalConversationCount: 4,
      visibleConversationCount: 0,
    }),
    'filtered-empty',
  );
  assert.equal(
    selectConversationEmptyState({
      hasActiveFilters: true,
      totalConversationCount: 4,
      visibleConversationCount: 1,
    }),
    'results',
  );
});

function createConversationDetailSupabaseStub(args: {
  agent?: { id: string; name: string; tenant_id: string } | null;
  conversation?: {
    agent_id: string;
    duration_ms: number | null;
    ended_at: string | null;
    end_reason: string | null;
    error_code: string | null;
    error_message: string | null;
    id: string;
    latency_metrics: unknown;
    metadata: unknown;
    outcome: string | null;
    runtime_snapshot: unknown;
    source: string;
    started_at: string;
    status: 'starting' | 'active' | 'completed' | 'failed' | 'cancelled';
    summary: string | null;
    tenant_id: string;
  } | null;
  messages?: Array<{
    content: string;
    conversation_id: string;
    created_at: string;
    ended_at: string | null;
    id: string;
    interrupted: boolean;
    is_final: boolean;
    role: string;
    sequence_number: number;
    started_at: string | null;
    tenant_id: string;
  }>;
}): any {
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();

      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        maybeSingle: async () => {
          if (table === 'conversations') {
            const conversation =
              args.conversation &&
              filters.get('tenant_id') === args.conversation.tenant_id &&
              filters.get('id') === args.conversation.id
                ? args.conversation
                : null;

            return { data: conversation, error: null };
          }

          if (table === 'agents') {
            const agent =
              args.agent &&
              filters.get('tenant_id') === args.agent.tenant_id &&
              filters.get('id') === args.agent.id
                ? args.agent
                : null;

            return { data: agent, error: null };
          }

          return { data: null, error: null };
        },
        order: async () => {
          if (table !== 'conversation_messages') {
            return { data: [], error: null };
          }

          const messages = (args.messages ?? [])
            .filter(
              (message) =>
                message.tenant_id === filters.get('tenant_id') &&
                message.conversation_id === filters.get('conversation_id'),
            )
            .sort((left, right) => left.sequence_number - right.sequence_number);

          return { data: messages, error: null };
        },
      };

      return query;
    },
  };
}

test('isConversationUuid accepts valid UUIDs and rejects malformed values', () => {
  assert.equal(isConversationUuid('aaaaaaaa-2000-4000-8000-000000000001'), true);
  assert.equal(isConversationUuid('not-a-uuid'), false);
  assert.equal(isConversationUuid('aaaaaaaa200040008000000000000001'), false);
});

test('conversation detail loader returns safe not-found for invalid ids before querying', async () => {
  const loader = createConversationDetailPageLoader({
    createServerSupabaseClient: async () => {
      throw new Error('should not query for invalid ids');
    },
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
  });

  const result = await loader('bad-id');

  assert.equal(result.kind, 'not-found');
});

test('conversation detail loader returns the same safe not-found result for cross-tenant records', async () => {
  const loader = createConversationDetailPageLoader({
    createServerSupabaseClient: async () =>
      createConversationDetailSupabaseStub({
        conversation: {
          agent_id: 'bbbbbbbb-0000-4000-8000-000000000001',
          duration_ms: 87000,
          ended_at: '2026-08-06T15:11:27Z',
          end_reason: 'provider_timeout',
          error_code: 'provider_timeout',
          error_message: 'Timeout',
          id: 'bbbbbbbb-2000-4000-8000-000000000001',
          latency_metrics: {},
          metadata: {},
          outcome: null,
          runtime_snapshot: {},
          source: 'browser_test',
          started_at: '2026-08-06T15:10:00Z',
          status: 'failed',
          summary: null,
          tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        },
      }),
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'member@example.com',
      kind: 'authenticated',
      membershipRole: 'member',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
  });

  const result = await loader('bbbbbbbb-2000-4000-8000-000000000001');

  assert.equal(result.kind, 'not-found');
});

test('sortConversationMessagesBySequence orders transcript messages ascending', () => {
  const messages = sortConversationMessagesBySequence([
    { sequenceNumber: 3, value: 'third' },
    { sequenceNumber: 1, value: 'first' },
    { sequenceNumber: 2, value: 'second' },
  ]);

  assert.deepEqual(messages.map((message) => message.value), [
    'first',
    'second',
    'third',
  ]);
});

test('formatConversationMessageRoleLabel returns stable user-facing labels', () => {
  assert.equal(formatConversationMessageRoleLabel('user'), 'User');
  assert.equal(formatConversationMessageRoleLabel('assistant'), 'Assistant');
  assert.equal(formatConversationMessageRoleLabel('system'), 'System');
  assert.equal(formatConversationMessageRoleLabel('tool'), 'Tool');
  assert.equal(formatConversationMessageRoleLabel('custom'), 'Message');
});

test('formatConversationMessageState marks interrupted interim assistant output clearly', () => {
  assert.deepEqual(
    formatConversationMessageState({
      interrupted: true,
      isFinal: false,
    }),
    {
      interruptedLabel: 'Interrupted',
      stateLabel: 'Interim',
    },
  );
});

test('formatOptionalConversationText hides null summary and outcome values', () => {
  assert.equal(formatOptionalConversationText(null), 'Not set');
  assert.equal(formatOptionalConversationText(undefined), 'Not set');
  assert.equal(formatOptionalConversationText('  captured  '), 'captured');
});

test('getAllowedLatencyMetrics keeps only safe known metric fields', () => {
  const metrics = getAllowedLatencyMetrics({
    authorization: 'secret',
    nested: { unsafe: true },
    speech_stop_to_stt_final_ms: 420,
    total_turn_duration_ms: 2100,
    unsupported_ms: 999,
  });

  assert.deepEqual(
    metrics.map((metric) => [metric.key, metric.valueLabel]),
    [
      ['speech_stop_to_stt_final_ms', '420 ms'],
      ['total_turn_duration_ms', '2.10 s'],
    ],
  );
});

test('getAllowedRuntimeSnapshotFields excludes secret and prompt-bearing fields', () => {
  const fields = getAllowedRuntimeSnapshotFields({
    agent_name: 'Reception Assistant',
    api_key: 'secret',
    authorization: 'Bearer value',
    business_name: 'Greenleaf Dental',
    language: 'en',
    system_prompt: 'do not expose',
    voice_id: 'en-CA-calm-2',
  });

  assert.deepEqual(
    fields.map((field) => field.label),
    ['Agent name', 'Language', 'Voice', 'Business name'],
  );
});

test('getAllowedConversationMetadataFields excludes secret metadata fields', () => {
  const fields = getAllowedConversationMetadataFields({
    api_key: 'secret',
    authorization: 'Bearer token',
    browser: 'Chrome',
    environment: 'demo',
    transport: 'webrtc',
  });

  assert.deepEqual(
    fields.map((field) => `${field.label}:${field.value}`),
    ['Browser:Chrome', 'Transport:webrtc', 'Environment:demo'],
  );
});

test('conversation detail loader returns safe stored error fields and empty transcript state', async () => {
  const loader = createConversationDetailPageLoader({
    createServerSupabaseClient: async () =>
      createConversationDetailSupabaseStub({
        agent: {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'Front Desk Assistant',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
        conversation: {
          agent_id: 'aaaaaaaa-0000-4000-8000-000000000001',
          duration_ms: 87000,
          ended_at: '2026-08-06T15:11:27Z',
          end_reason: null,
          error_code: 'provider_timeout',
          error_message:
            'The assistant could not finish the response before the provider timeout window closed.',
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          latency_metrics: {
            speech_stop_to_stt_final_ms: 400,
          },
          metadata: {
            browser: 'Chrome',
            authorization: 'hidden',
          },
          outcome: null,
          runtime_snapshot: {
            agent_name: 'Front Desk Assistant',
            api_key: 'hidden',
            language: 'en',
          },
          source: 'browser_test',
          started_at: '2026-08-06T15:10:00Z',
          status: 'failed',
          summary: null,
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
        messages: [],
      }),
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
  });

  const result = await loader('aaaaaaaa-2000-4000-8000-000000000001');

  assert.equal(result.kind, 'authenticated');

  if (result.kind === 'authenticated') {
    assert.equal(result.conversation.errorCode, 'provider_timeout');
    assert.match(
      result.conversation.errorMessage ?? '',
      /provider timeout window closed/i,
    );
    assert.equal(result.conversation.summary, 'Not set');
    assert.equal(result.conversation.outcome, 'Not set');
    assert.equal(result.transcriptState, 'empty');
    assert.deepEqual(
      result.metadataFields.map((field) => field.label),
      ['Browser'],
    );
    assert.deepEqual(
      result.runtimeSnapshotFields.map((field) => field.label),
      ['Agent name', 'Language'],
    );
  }
});

test('resolveConversationMessageTimestamp prefers ended then started then created timestamps', () => {
  assert.equal(
    resolveConversationMessageTimestamp({
      createdAt: '2026-08-06T10:00:00Z',
      endedAt: '2026-08-06T10:00:03Z',
      startedAt: '2026-08-06T10:00:01Z',
    }),
    '2026-08-06T10:00:03Z',
  );
  assert.equal(
    resolveConversationMessageTimestamp({
      createdAt: '2026-08-06T10:00:00Z',
      endedAt: null,
      startedAt: '2026-08-06T10:00:01Z',
    }),
    '2026-08-06T10:00:01Z',
  );
});

test('selectTranscriptState returns empty when no messages were stored', () => {
  assert.equal(selectTranscriptState(0), 'empty');
  assert.equal(selectTranscriptState(2), 'results');
});

test('parseStartConversationRequestBody accepts a valid browser_test payload', () => {
  const result = parseStartConversationRequestBody({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    source: 'browser_test',
  });

  assert.equal(result.ok, true);

  if (result.ok) {
    assert.deepEqual(result.data, {
      agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
      source: 'browser_test',
    });
  }
});

test('parseStartConversationJsonRequest returns a safe invalid-json error', async () => {
  const request = new Request('http://localhost/api/voice/conversations', {
    body: '{bad',
    headers: {
      'content-type': 'application/json',
    },
    method: 'POST',
  });

  const result = await parseStartConversationJsonRequest(request);

  assert.deepEqual(result, {
    body: {
      error: 'Invalid JSON request body.',
    },
    ok: false,
    status: 400,
  });
});

test('parseStartConversationRequestBody rejects invalid UUIDs and unsupported sources', () => {
  const invalidUuid = parseStartConversationRequestBody({
    agentId: 'not-a-uuid',
    source: 'browser_test',
  });
  const invalidSource = parseStartConversationRequestBody({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    source: 'telephony',
  });

  assert.deepEqual(invalidUuid, {
    body: {
      error: 'Agent ID must be a valid UUID.',
    },
    ok: false,
    status: 400,
  });
  assert.deepEqual(invalidSource, {
    body: {
      error: 'Source must be browser_test.',
    },
    ok: false,
    status: 400,
  });
});

test('buildStartConversationInsert uses only server-generated fields', () => {
  const insert = buildStartConversationInsert({
    agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
    now: new Date('2026-08-06T12:34:56.000Z'),
    tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  });

  assert.deepEqual(insert, {
    agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
    latency_metrics: {},
    metadata: {
      client_type: 'portal',
      environment: 'local',
      transport: 'smallwebrtc',
    },
    runtime_snapshot: {},
    source: 'browser_test',
    started_at: '2026-08-06T12:34:56.000Z',
    status: 'starting',
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  });
});

test('mapStartConversationSuccess returns the safe public response contract', () => {
  assert.deepEqual(
    mapStartConversationSuccess({
      id: 'aaaaaaaa-3000-4000-8000-000000000001',
      started_at: '2026-08-06T12:34:56.000Z',
      status: 'starting',
    }),
    {
      conversationId: 'aaaaaaaa-3000-4000-8000-000000000001',
      startedAt: '2026-08-06T12:34:56.000Z',
      status: 'starting',
    },
  );
});

test('createStartConversationService returns 401 for unauthenticated sessions', async () => {
  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      kind: 'unauthenticated',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      startConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'Your session is not authenticated.',
    },
    status: 401,
  });
});

test('createStartConversationService returns 403 when the user has no workspace membership', async () => {
  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      email: 'member@example.com',
      kind: 'missing-membership',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      startConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'A tenant workspace is required before starting a conversation.',
    },
    status: 403,
  });
});

test('createStartConversationService starts a conversation for an active own-tenant agent and ignores injected tenant fields', async () => {
  let insertedConversation: unknown = null;

  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        onInsert(value) {
          insertedConversation = value;
        },
      })),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          status: 'active',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
      })),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      startConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      conversationId: 'aaaaaaaa-3000-4000-8000-000000000001',
      startedAt: '2026-08-06T12:34:56.000Z',
      status: 'starting',
    },
    status: 201,
  });
  assert.deepEqual(insertedConversation, {
    agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
    latency_metrics: {},
    metadata: {
      client_type: 'portal',
      environment: 'local',
      transport: 'smallwebrtc',
    },
    runtime_snapshot: {},
    source: 'browser_test',
    started_at: '2026-08-06T12:34:56.000Z',
    status: 'starting',
    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  });
});

test('createStartConversationService rejects inactive or paused agents with the same safe 404 response', async () => {
  const pausedConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          status: 'paused',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
      })),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      pausedConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'The requested agent is unavailable.',
    },
    status: 404,
  });
});

test('createStartConversationService returns the same safe 404 response for cross-tenant agents', async () => {
  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'bbbbbbbb-2000-4000-8000-000000000001',
          status: 'active',
          tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        },
      })),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      startConversation({
        agentId: 'bbbbbbbb-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'The requested agent is unavailable.',
    },
    status: 404,
  });
});

test('createStartConversationService returns a safe database-error response', async () => {
  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          status: 'active',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
        insertError: {
          message: 'violates something internal',
        },
      })),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          status: 'active',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
      })),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    },
    () =>
      startConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'Unable to start the conversation right now.',
    },
    status: 500,
  });
});

test('createStartConversationService returns a safe configuration error when the service role key is missing', async () => {
  const startConversation = createStartConversationService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({})),
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createStartConversationSupabaseStub({
        agent: {
          id: 'aaaaaaaa-2000-4000-8000-000000000001',
          status: 'active',
          tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        },
      })),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:34:56.000Z'),
  });

  const result = await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    () =>
      startConversation({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        source: 'browser_test',
      }),
  );

  assert.deepEqual(result, {
    body: {
      error: 'Server configuration for conversation writes is unavailable.',
    },
    status: 500,
  });
});

test('getSupabaseAdminEnv validates environment without exposing secret values', async () => {
  await withEnv(
    {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    },
    async () => {
      assert.throws(
        () => getSupabaseAdminEnv(),
        /Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY/,
      );
    },
  );
});

test('supabase admin helper remains server-only', async () => {
  const adminContent = await readFile(
    new URL('../lib/supabase/admin.ts', import.meta.url),
    'utf8',
  );
  const serverOnlyContent = await readFile(
    new URL('../lib/supabase/server-only.ts', import.meta.url),
    'utf8',
  );

  assert.match(adminContent, /import '\.\/server-only';/);
  assert.match(adminContent, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminContent, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(
    serverOnlyContent,
    /createRequire\(import\.meta\.url\)\('server-only'\)/,
  );
});

test('getVoiceSessionSigningConfig validates a strong server-only secret', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const config = getVoiceSessionSigningConfig();

      assert.equal(config.algorithm, 'HS256');
      assert.equal(config.audience, 'sleek-relay-voice-worker');
      assert.equal(config.issuer, 'sleek-relay-portal');
      assert.equal(config.ttlSeconds, VOICE_SESSION_TOKEN_DEFAULT_TTL_SECONDS);
      assert.ok(config.secret.byteLength >= 32);
    },
  );
});

test('getVoiceSessionSigningConfig rejects weak secrets without exposing the secret value', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: 'too-short-secret',
    },
    async () => {
      assert.throws(() => getVoiceSessionSigningConfig(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /VOICE_SESSION_SIGNING_SECRET/);
        assert.doesNotMatch(error.message, /too-short-secret/);
        return true;
      });
    },
  );
});

test('signVoiceSessionToken issues a 30 minute browser_test token with the allowlisted claims', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const now = new Date('2026-08-06T12:00:00.000Z');
      const signed = await signVoiceSessionToken({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
        now,
      });

      assert.equal(signed.expiresAt, '2026-08-06T12:30:00.000Z');

      const verified = await verifyVoiceSessionToken(signed.token, {
        currentDate: new Date('2026-08-06T12:05:00.000Z'),
      });

      assert.equal(verified.ok, true);

      if (verified.ok) {
        assert.deepEqual(
          {
            agentId: verified.claims.agentId,
            audience: verified.claims.audience,
            conversationId: verified.claims.conversationId,
            expiresAt: verified.claims.expiresAt,
            issuer: verified.claims.issuer,
            purpose: verified.claims.purpose,
            source: verified.claims.source,
            subject: verified.claims.subject,
            version: verified.claims.version,
          },
          {
            agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
            audience: 'sleek-relay-voice-worker',
            conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
            expiresAt: '2026-08-06T12:30:00.000Z',
            issuer: 'sleek-relay-portal',
            purpose: 'voice-session',
            source: 'browser_test',
            subject: 'aaaaaaaa-5000-4000-8000-000000000001',
            version: 1,
          },
        );
        assert.match(verified.claims.tokenId, /\S+/);
      }
    },
  );
});

test('verifyVoiceSessionToken rejects expired tokens after the clock-skew window', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const token = await signVoiceSessionTokenForTest({
        expiresAtSeconds: 1_754_487_000,
        issuedAtSeconds: 1_754_485_200,
      });

      const result = await verifyVoiceSessionToken(token, {
        currentDate: new Date('2026-08-06T12:30:31.000Z'),
      });

      assert.deepEqual(result, {
        error: 'Invalid voice session token.',
        ok: false,
      });
    },
  );
});

test('verifyVoiceSessionToken rejects invalid signatures and malformed tokens safely', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const valid = await signVoiceSessionTokenForTest({});
      const tampered = `${valid.slice(0, -1)}x`;

      assert.deepEqual(await verifyVoiceSessionToken(tampered), {
        error: 'Invalid voice session token.',
        ok: false,
      });
      assert.deepEqual(await verifyVoiceSessionToken('not-a-jwt'), {
        error: 'Invalid voice session token.',
        ok: false,
      });
    },
  );
});

test('verifyVoiceSessionToken rejects wrong issuer, audience, purpose, version, algorithm, and subject mismatches', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const wrongIssuer = await signVoiceSessionTokenForTest({
        issuer: 'another-issuer',
      });
      const wrongAudience = await signVoiceSessionTokenForTest({
        audience: 'another-audience',
      });
      const wrongPurpose = await signVoiceSessionTokenForTest({
        purpose: 'other-purpose',
      });
      const wrongVersion = await signVoiceSessionTokenForTest({
        version: 2,
      });
      const wrongAlgorithm = await signVoiceSessionTokenForTest({
        algorithm: 'HS512',
      });
      const mismatchedSubject = await signVoiceSessionTokenForTest({
        subject: 'aaaaaaaa-5000-4000-8000-000000000999',
      });

      assert.equal((await verifyVoiceSessionToken(wrongIssuer)).ok, false);
      assert.equal((await verifyVoiceSessionToken(wrongAudience)).ok, false);
      assert.equal((await verifyVoiceSessionToken(wrongPurpose)).ok, false);
      assert.equal((await verifyVoiceSessionToken(wrongVersion)).ok, false);
      assert.equal((await verifyVoiceSessionToken(wrongAlgorithm)).ok, false);
      assert.equal((await verifyVoiceSessionToken(mismatchedSubject)).ok, false);
    },
  );
});

test('verifyVoiceSessionToken rejects invalid conversation and agent UUID claims', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const invalidConversation = await signVoiceSessionTokenForTest({
        conversationId: 'not-a-uuid',
        subject: 'not-a-uuid',
      });
      const invalidAgent = await signVoiceSessionTokenForTest({
        agentId: 'not-a-uuid',
      });

      assert.equal((await verifyVoiceSessionToken(invalidConversation)).ok, false);
      assert.equal((await verifyVoiceSessionToken(invalidAgent)).ok, false);
      await assert.rejects(
        () =>
          signVoiceSessionToken({
            agentId: 'not-a-uuid',
            conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
            now: new Date('2026-08-06T12:00:00.000Z'),
          }),
        /Voice session token agent ID must be a valid UUID/,
      );
    },
  );
});

test('parseBearerAuthorizationHeader validates required Bearer headers', () => {
  assert.deepEqual(parseBearerAuthorizationHeader(null), {
    error: 'Authorization header is required.',
    ok: false,
  });
  assert.deepEqual(parseBearerAuthorizationHeader('Basic abc'), {
    error: 'Authorization header must use the Bearer scheme.',
    ok: false,
  });
  assert.deepEqual(parseBearerAuthorizationHeader('Bearer'), {
    error: 'Authorization header must contain a bearer token.',
    ok: false,
  });
  assert.deepEqual(parseBearerAuthorizationHeader('Bearer token extra'), {
    error: 'Authorization header must contain a bearer token.',
    ok: false,
  });
  assert.deepEqual(parseBearerAuthorizationHeader('Bearer abc.def.ghi'), {
    ok: true,
    token: 'abc.def.ghi',
  });
});

test('mapIssueVoiceSessionTokenSuccess returns the expected body and no-store headers', () => {
  assert.deepEqual(
    mapIssueVoiceSessionTokenSuccess({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      expiresAt: '2026-08-06T12:30:00.000Z',
      token: 'token-value',
    }),
    {
      body: {
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
        expiresAt: '2026-08-06T12:30:00.000Z',
        token: 'token-value',
        tokenType: 'Bearer',
      },
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
      },
      status: 200,
    },
  );
});

test('createIssueVoiceSessionTokenService returns 401 when unauthenticated', async () => {
  const issueToken = createIssueVoiceSessionTokenService({
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createVoiceSessionTokenSupabaseStub({})),
    loadWorkspaceContext: async () => ({
      kind: 'unauthenticated',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken,
  });

  const result = await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => issueToken('aaaaaaaa-5000-4000-8000-000000000001'),
  );

  assert.deepEqual(result, {
    body: {
      error: 'Your session is not authenticated.',
    },
    status: 401,
  });
});

test('createIssueVoiceSessionTokenService returns 403 when the workspace is missing', async () => {
  const issueToken = createIssueVoiceSessionTokenService({
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(createVoiceSessionTokenSupabaseStub({})),
    loadWorkspaceContext: async () => ({
      email: 'member@example.com',
      kind: 'missing-membership',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken,
  });

  const result = await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => issueToken('aaaaaaaa-5000-4000-8000-000000000001'),
  );

  assert.deepEqual(result, {
    body: {
      error:
        'A tenant workspace is required before issuing a voice session token.',
    },
    status: 403,
  });
});

test('createIssueVoiceSessionTokenService issues tokens for own-tenant starting and active browser_test conversations', async () => {
  for (const status of ['starting', 'active'] as const) {
    const issueToken = createIssueVoiceSessionTokenService({
      createServerSupabaseClient: async () =>
        asSupabaseClientStub(
          createVoiceSessionTokenSupabaseStub({
            agent: {
              id: 'aaaaaaaa-2000-4000-8000-000000000001',
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
            conversation: {
              agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
              id: 'aaaaaaaa-5000-4000-8000-000000000001',
              source: 'browser_test',
              status,
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
          }),
        ),
      loadWorkspaceContext: async () => ({
        canManageAgents: true,
        canManageBusinessConfiguration: true,
        canManageKnowledge: true,
        email: 'owner@example.com',
        kind: 'authenticated',
        membershipRole: 'owner',
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        tenantName: 'Tenant A',
        tenantSlug: 'tenant-a',
      }),
      now: () => new Date('2026-08-06T12:00:00.000Z'),
      signVoiceSessionToken,
    });

    const result = await withEnv(
      {
        VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
      },
      () => issueToken('aaaaaaaa-5000-4000-8000-000000000001'),
    );

    assert.equal(result.status, 200);
    assert.deepEqual(result.headers, {
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
    });

    const body = result.body;

    if (result.status === 200 && 'token' in body) {
      const verified = await withEnv(
        {
          VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
        },
        () =>
          verifyVoiceSessionToken(body.token, {
            currentDate: new Date('2026-08-06T12:05:00.000Z'),
          }),
      );

      assert.equal(verified.ok, true);

      if (verified.ok) {
        assert.equal(
          verified.claims.conversationId,
          'aaaaaaaa-5000-4000-8000-000000000001',
        );
        assert.equal(
          verified.claims.agentId,
          'aaaaaaaa-2000-4000-8000-000000000001',
        );
        assert.equal(verified.claims.expiresAt, '2026-08-06T12:30:00.000Z');
      }
    } else {
      assert.fail('Expected a successful voice session token response.');
    }
  }
});

test('createIssueVoiceSessionTokenService rejects invalid IDs and cross-tenant conversations with the same safe 404 response', async () => {
  const issueToken = createIssueVoiceSessionTokenService({
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(
        createVoiceSessionTokenSupabaseStub({
          conversation: {
            agent_id: 'bbbbbbbb-2000-4000-8000-000000000001',
            id: 'bbbbbbbb-5000-4000-8000-000000000001',
            source: 'browser_test',
            status: 'starting',
            tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          },
        }),
      ),
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken,
  });

  const invalidId = await issueToken('bad-id');
  const crossTenant = await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => issueToken('bbbbbbbb-5000-4000-8000-000000000001'),
  );

  assert.deepEqual(invalidId, {
    body: {
      error: 'The requested conversation is unavailable.',
    },
    status: 404,
  });
  assert.deepEqual(crossTenant, {
    body: {
      error: 'The requested conversation is unavailable.',
    },
    status: 404,
  });
});

test('createIssueVoiceSessionTokenService rejects non-browser and completed terminal conversations', async () => {
  for (const conversation of [
    {
      source: 'browser_test',
      status: 'completed' as const,
    },
    {
      source: 'browser_test',
      status: 'failed' as const,
    },
    {
      source: 'browser_test',
      status: 'cancelled' as const,
    },
    {
      source: 'api',
      status: 'starting' as const,
    },
  ]) {
    const issueToken = createIssueVoiceSessionTokenService({
      createServerSupabaseClient: async () =>
        asSupabaseClientStub(
          createVoiceSessionTokenSupabaseStub({
            agent: {
              id: 'aaaaaaaa-2000-4000-8000-000000000001',
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
            conversation: {
              agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
              id: 'aaaaaaaa-5000-4000-8000-000000000001',
              source: conversation.source,
              status: conversation.status,
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
          }),
        ),
      loadWorkspaceContext: async () => ({
        canManageAgents: true,
        canManageBusinessConfiguration: true,
        canManageKnowledge: true,
        email: 'owner@example.com',
        kind: 'authenticated',
        membershipRole: 'owner',
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        tenantName: 'Tenant A',
        tenantSlug: 'tenant-a',
      }),
      now: () => new Date('2026-08-06T12:00:00.000Z'),
      signVoiceSessionToken,
    });

    const result = await withEnv(
      {
        VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
      },
      () => issueToken('aaaaaaaa-5000-4000-8000-000000000001'),
    );

    assert.deepEqual(result, {
      body: {
        error:
          'The requested conversation is not eligible for a voice session token.',
      },
      status: 409,
    });
  }
});

test('createIssueVoiceSessionTokenService rejects conversations whose linked agent is no longer tenant-accessible', async () => {
  const issueToken = createIssueVoiceSessionTokenService({
    createServerSupabaseClient: async () =>
      asSupabaseClientStub(
        createVoiceSessionTokenSupabaseStub({
          agent: null,
          conversation: {
            agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            source: 'browser_test',
            status: 'starting',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
        }),
      ),
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:00:00.000Z'),
    signVoiceSessionToken,
  });

  const result = await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => issueToken('aaaaaaaa-5000-4000-8000-000000000001'),
  );

  assert.deepEqual(result, {
    body: {
      error: 'The requested conversation is unavailable.',
    },
    status: 404,
  });
});

test('createIssueVoiceSessionTokenRouteHandler ignores browser-controlled body fields and preserves no-store headers', async () => {
  const handler = createIssueVoiceSessionTokenRouteHandler(async (id) => {
    assert.equal(id, 'aaaaaaaa-5000-4000-8000-000000000001');
    return mapIssueVoiceSessionTokenSuccess({
      conversationId: id,
      expiresAt: '2026-08-06T12:30:00.000Z',
      token: 'signed-token-value',
    });
  });

  const response = await handler(
    new Request(
      'http://localhost/api/voice/conversations/aaaaaaaa-5000-4000-8000-000000000001/session-token',
      {
        body: '{"agentId":"fake","tenantId":"fake","expiresAt":"2000-01-01T00:00:00Z","claims":{"role":"admin"}}',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ),
    {
      params: Promise.resolve({
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store, max-age=0');
  assert.equal(response.headers.get('Pragma'), 'no-cache');
  assert.deepEqual(await response.json(), {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    expiresAt: '2026-08-06T12:30:00.000Z',
    token: 'signed-token-value',
    tokenType: 'Bearer',
  });
});

test('parseBrowserConversationLifecycleRequestBody accepts only the narrow lifecycle event contract', () => {
  assert.deepEqual(
    parseBrowserConversationLifecycleRequestBody({
      endReason: ' user_disconnect ',
      errorMessage: ' provider dropped ',
      event: 'failed',
      runtimeSnapshot: {
        agent_name: ' Front Desk Assistant ',
        api_key: 'hidden',
        language: ' en ',
      },
      status: 'failed',
      tenantId: 'ignored',
      transcriptMessages: [
        {
          content: ' Hello there ',
          role: 'user',
        },
        {
          content: '   ',
          role: 'assistant',
        },
      ],
    }),
    {
      data: {
        endReason: 'user_disconnect',
        errorMessage: 'provider dropped',
        event: 'failed',
        runtimeSnapshot: {
          agent_name: 'Front Desk Assistant',
          language: 'en',
        },
        transcriptMessages: [
          {
            content: 'Hello there',
            role: 'user',
          },
        ],
      },
      ok: true,
    },
  );
});

test('stopLocalMicrophoneTracks stops local audio and screen-audio tracks only', () => {
  const audioTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const screenAudioTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };
  const botAudioTrack = { stopCalls: 0, stop() { this.stopCalls += 1; } };

  stopLocalMicrophoneTracks({
    bot: {
      audio: botAudioTrack as any,
    },
    local: {
      audio: audioTrack as any,
      screenAudio: screenAudioTrack as any,
    },
  } as any);

  assert.equal(audioTrack.stopCalls, 1);
  assert.equal(screenAudioTrack.stopCalls, 1);
  assert.equal(botAudioTrack.stopCalls, 0);
});

test('parseBrowserConversationLifecycleJsonRequest rejects invalid JSON and unsupported lifecycle events', async () => {
  const invalidJson = await parseBrowserConversationLifecycleJsonRequest(
    new Request('http://localhost/api/voice/conversations/id/lifecycle', {
      body: '{',
      headers: {
        'content-type': 'application/json',
      },
      method: 'PATCH',
    }),
  );

  const invalidEvent = parseBrowserConversationLifecycleRequestBody({
    event: 'paused',
  });

  assert.deepEqual(invalidJson, {
    body: {
      error: 'Invalid JSON request body.',
    },
    ok: false,
    status: 400,
  });
  assert.deepEqual(invalidEvent, {
    body: {
      error: 'Event must be one of connected, completed, or failed.',
    },
    ok: false,
    status: 400,
  });
});

test('createBrowserConversationLifecycleService marks a starting tenant conversation active after connect', async () => {
  const updateCalls: unknown[] = [];
  const updateLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createConversationLifecycleSupabaseStub({
          conversation: {
            end_reason: null,
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            started_at: '2026-08-06T12:00:00.000Z',
            status: 'starting',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          onUpdate: (value) => updateCalls.push(value),
        }),
      ),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:03:00.000Z'),
  });

  const result = await withEnv(createSupabaseEnv(), () =>
    updateLifecycle({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      request: {
        event: 'connected',
      },
    }),
  );

  assert.deepEqual(updateCalls, [
    {
      status: 'active',
    },
  ]);
  assert.deepEqual(result, {
    body: {
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      endReason: null,
      finalized: false,
      status: 'active',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 200,
  });
});

test('createBrowserConversationLifecycleService finalizes tenant conversations safely and idempotently', async () => {
  const updateCalls: unknown[] = [];
  const supabase = createConversationLifecycleSupabaseStub({
    conversation: {
      end_reason: null,
      id: 'aaaaaaaa-5000-4000-8000-000000000001',
      started_at: '2026-08-06T12:00:00.000Z',
      status: 'active',
      tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    },
    onUpdate: (value) => updateCalls.push(value),
  });
  const updateLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () => asSupabaseClientStub(supabase),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:05:30.000Z'),
  });

  const firstResult = await withEnv(createSupabaseEnv(), () =>
    updateLifecycle({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      request: {
        endReason: 'user_disconnect',
        event: 'completed',
      },
    }),
  );

  const secondResult = await withEnv(createSupabaseEnv(), () =>
    updateLifecycle({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      request: {
        event: 'failed',
      },
    }),
  );

  assert.deepEqual(updateCalls, [
    {
      duration_ms: 330000,
      end_reason: 'user_disconnect',
      ended_at: '2026-08-06T12:05:30.000Z',
      error_code: null,
      error_message: null,
      status: 'completed',
    },
  ]);
  assert.deepEqual(firstResult, {
    body: {
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      endReason: 'user_disconnect',
      finalized: true,
      status: 'completed',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 200,
  });
  assert.deepEqual(secondResult, firstResult);
});

test('createBrowserConversationLifecycleService persists transcript rows and fallback detail artifacts for completed sessions', async () => {
  const updateCalls: unknown[] = [];
  const upsertCalls: unknown[] = [];
  const updateLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createConversationLifecycleSupabaseStub({
          conversation: {
            end_reason: null,
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            outcome: null,
            runtime_snapshot: {},
            started_at: '2026-08-06T12:00:00.000Z',
            status: 'active',
            summary: null,
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          onUpdate: (value) => updateCalls.push(value),
          onUpsert: (value) => upsertCalls.push(value),
        }),
      ),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:05:30.000Z'),
  });

  const result = await withEnv(createSupabaseEnv(), () =>
    updateLifecycle({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      request: {
        endReason: 'user_disconnect',
        event: 'completed',
        runtimeSnapshot: {
          agent_name: 'Front Desk Assistant',
          language: 'en',
          role: 'receptionist',
          voice_id: 'voice-1',
        },
        transcriptMessages: [
          {
            content: 'I need to book a cleaning.',
            role: 'user',
          },
          {
            content: 'I can help with that request.',
            role: 'assistant',
          },
        ],
      },
    }),
  );

  assert.deepEqual(result, {
    body: {
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      endReason: 'user_disconnect',
      finalized: true,
      status: 'completed',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 200,
  });
  assert.deepEqual(upsertCalls, [
    [
      {
        content: 'I need to book a cleaning.',
        conversation_id: 'aaaaaaaa-5000-4000-8000-000000000001',
        interrupted: false,
        is_final: true,
        role: 'user',
        sequence_number: 1,
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
      {
        content: 'I can help with that request.',
        conversation_id: 'aaaaaaaa-5000-4000-8000-000000000001',
        interrupted: false,
        is_final: true,
        role: 'assistant',
        sequence_number: 2,
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
    ],
  ]);
  assert.deepEqual(updateCalls, [
    {
      duration_ms: 330000,
      end_reason: 'user_disconnect',
      ended_at: '2026-08-06T12:05:30.000Z',
      error_code: null,
      error_message: null,
      status: 'completed',
    },
    {
      outcome: 'User disconnected',
      runtime_snapshot: {
        agent_name: 'Front Desk Assistant',
        language: 'en',
        role: 'receptionist',
        voice_id: 'voice-1',
      },
      summary:
        'Browser voice test completed with 1 user message and 1 agent message. The caller inquired: "I need to book a cleaning.". The agent replied: "I can help with that request.".',
    },
  ]);
});

test('createBrowserConversationLifecycleService finalizes failures and protects tenant scope', async () => {
  const crossTenantLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createConversationLifecycleSupabaseStub({
          conversation: {
            end_reason: null,
            id: 'bbbbbbbb-5000-4000-8000-000000000001',
            started_at: '2026-08-06T12:00:00.000Z',
            status: 'starting',
            tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          },
        }),
      ),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:01:00.000Z'),
  });

  const crossTenant = await withEnv(createSupabaseEnv(), () =>
    crossTenantLifecycle({
      conversationId: 'bbbbbbbb-5000-4000-8000-000000000001',
      request: {
        errorMessage: 'provider dropped',
        event: 'failed',
      },
    }),
  );

  assert.deepEqual(crossTenant, {
    body: {
      error: 'The requested conversation is unavailable.',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 404,
  });

  const sameTenantLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createConversationLifecycleSupabaseStub({
          conversation: {
            end_reason: null,
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            started_at: '2026-08-06T12:00:00.000Z',
            status: 'starting',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
        }),
      ),
    getSupabaseAdminEnv,
    loadWorkspaceContext: async () => ({
      canManageAgents: true,
      canManageBusinessConfiguration: true,
      canManageKnowledge: true,
      email: 'owner@example.com',
      kind: 'authenticated',
      membershipRole: 'owner',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Tenant A',
      tenantSlug: 'tenant-a',
    }),
    now: () => new Date('2026-08-06T12:01:00.000Z'),
  });

  const failureResult = await withEnv(createSupabaseEnv(), () =>
    sameTenantLifecycle({
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      request: {
        errorMessage: 'provider dropped',
        event: 'failed',
      },
    }),
  );

  assert.deepEqual(failureResult, {
    body: {
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      endReason: 'failed',
      finalized: true,
      status: 'failed',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 200,
  });
});

test('createBrowserConversationLifecycleRouteHandler ignores browser-controlled status fields and uses the route conversation id', async () => {
  const handler = createBrowserConversationLifecycleRouteHandler(
    async ({ conversationId, request }) => {
      const parsed = await parseBrowserConversationLifecycleJsonRequest(request);

      assert.equal(conversationId, 'aaaaaaaa-5000-4000-8000-000000000001');
      assert.equal(parsed.ok, true);

      if (!parsed.ok) {
        assert.fail('Expected a valid lifecycle request body.');
      }

      assert.deepEqual(parsed.data, {
        endReason: undefined,
        errorMessage: undefined,
        event: 'completed',
      });

      return {
        body: {
          conversationId,
          endReason: 'user_disconnect',
          finalized: true,
          status: 'completed',
        },
        headers: {
          'Cache-Control': 'no-store',
        },
        status: 200,
      };
    },
  );

  const response = await handler(
    new Request(
      'http://localhost/api/voice/conversations/aaaaaaaa-5000-4000-8000-000000000001/lifecycle',
      {
        body: JSON.stringify({
          endReason: undefined,
          event: 'completed',
          status: 'failed',
          tenantId: 'fake',
        }),
        headers: {
          'content-type': 'application/json',
        },
        method: 'PATCH',
      },
    ),
    {
      params: Promise.resolve({
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    endReason: 'user_disconnect',
    finalized: true,
    status: 'completed',
  });
});

test('createIssueVoiceRuntimeConfigService returns 401 for missing and invalid bearer tokens', async () => {
  const issueRuntimeConfig = createIssueVoiceRuntimeConfigService({
    buildAgentRuntimePackageForTenant: async () => {
      throw new Error('should not build runtime config');
    },
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createVoiceSessionTokenSupabaseStub({})),
    getSupabaseAdminEnv,
    verifyVoiceSessionToken,
  });

  const missingHeader = await issueRuntimeConfig(null);

  const invalidToken = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => issueRuntimeConfig('Bearer not-a-jwt'),
  );

  assert.deepEqual(missingHeader, {
    body: {
      error: 'Authorization header is required.',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 401,
  });
  assert.deepEqual(invalidToken, {
    body: {
      error: 'Invalid voice session token.',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 401,
  });
});

test('createIssueVoiceRuntimeConfigService builds the runtime package from the verified conversation and tenant only', async () => {
  const runtimePackage = createRuntimePackageFixture();
  const builderCalls: Array<{
    agentId: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
  }> = [];
  const issueRuntimeConfig = createIssueVoiceRuntimeConfigService({
    buildAgentRuntimePackageForTenant: async (args) => {
      builderCalls.push({
        agentId: args.agentId,
        tenantId: args.tenantId,
        tenantName: args.tenantName,
        tenantSlug: args.tenantSlug,
      });

      return {
        ok: true,
        runtimePackage,
      };
    },
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createVoiceSessionTokenSupabaseStub({
          agent: {
            id: 'aaaaaaaa-2000-4000-8000-000000000001',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          conversation: {
            agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            source: 'browser_test',
            status: 'active',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          tenant: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            name: 'Greenleaf Dental',
            slug: 'greenleaf-dental',
          },
        }),
      ),
    getSupabaseAdminEnv,
    verifyVoiceSessionToken,
  });

  const signedToken = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => signVoiceSessionTokenForTest({ expiresAtSeconds: 1_800_000_000 }),
  );

  const result = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () =>
      issueRuntimeConfig(
        `Bearer ${signedToken}`,
      ),
  );

  assert.deepEqual(builderCalls, [
    {
      agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantName: 'Greenleaf Dental',
      tenantSlug: 'greenleaf-dental',
    },
  ]);
  assert.deepEqual(result, {
    body: {
      conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
      runtimePackage,
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 200,
  });
});

test('createIssueVoiceRuntimeConfigService returns safe 404s for unavailable conversation relationships', async () => {
  const scenarios = [
    createVoiceSessionTokenSupabaseStub({
      agent: {
        id: 'aaaaaaaa-2000-4000-8000-000000000001',
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
      conversation: null,
      tenant: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        name: 'Greenleaf Dental',
        slug: 'greenleaf-dental',
      },
    }),
    createVoiceSessionTokenSupabaseStub({
      agent: null,
      conversation: {
        agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
        id: 'aaaaaaaa-5000-4000-8000-000000000001',
        source: 'browser_test',
        status: 'starting',
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
      tenant: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        name: 'Greenleaf Dental',
        slug: 'greenleaf-dental',
      },
    }),
    createVoiceSessionTokenSupabaseStub({
      agent: {
        id: 'aaaaaaaa-2000-4000-8000-000000000001',
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
      conversation: {
        agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
        id: 'aaaaaaaa-5000-4000-8000-000000000001',
        source: 'browser_test',
        status: 'starting',
        tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      },
      tenant: null,
    }),
  ];

  const signedToken = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => signVoiceSessionTokenForTest({ expiresAtSeconds: 1_800_000_000 }),
  );

  for (const supabase of scenarios) {
    const issueRuntimeConfig = createIssueVoiceRuntimeConfigService({
      buildAgentRuntimePackageForTenant: async () => {
        throw new Error('should not build unavailable conversations');
      },
      createServerSupabaseAdminClient: async () => asSupabaseClientStub(supabase),
      getSupabaseAdminEnv,
      verifyVoiceSessionToken,
    });

    const result = await withEnv(
      {
        ...createSupabaseEnv(),
        VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
      },
      () => issueRuntimeConfig(`Bearer ${signedToken}`),
    );

    assert.deepEqual(result, {
      body: {
        error: 'The requested conversation is unavailable.',
      },
      headers: {
        'Cache-Control': 'no-store',
      },
      status: 404,
    });
  }
});

test('createIssueVoiceRuntimeConfigService rejects non-browser and terminal conversations with 409', async () => {
  const signedToken = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => signVoiceSessionTokenForTest({ expiresAtSeconds: 1_800_000_000 }),
  );

  for (const conversation of [
    {
      source: 'browser_test',
      status: 'completed' as const,
    },
    {
      source: 'api',
      status: 'starting' as const,
    },
  ]) {
    const issueRuntimeConfig = createIssueVoiceRuntimeConfigService({
      buildAgentRuntimePackageForTenant: async () => {
        throw new Error('should not build ineligible runtime config');
      },
      createServerSupabaseAdminClient: async () =>
        asSupabaseClientStub(
          createVoiceSessionTokenSupabaseStub({
            agent: {
              id: 'aaaaaaaa-2000-4000-8000-000000000001',
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
            conversation: {
              agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
              id: 'aaaaaaaa-5000-4000-8000-000000000001',
              source: conversation.source,
              status: conversation.status,
              tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            },
            tenant: {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
              name: 'Greenleaf Dental',
              slug: 'greenleaf-dental',
            },
          }),
        ),
      getSupabaseAdminEnv,
      verifyVoiceSessionToken,
    });

    const result = await withEnv(
      {
        ...createSupabaseEnv(),
        VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
      },
      () => issueRuntimeConfig(`Bearer ${signedToken}`),
    );

    assert.deepEqual(result, {
      body: {
        error:
          'The requested conversation is not eligible for runtime configuration.',
      },
      headers: {
        'Cache-Control': 'no-store',
      },
      status: 409,
    });
  }
});

test('createIssueVoiceRuntimeConfigService returns a safe 500 when server configuration or runtime building fails', async () => {
  const signedToken = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => signVoiceSessionTokenForTest({ expiresAtSeconds: 1_800_000_000 }),
  );

  const missingConfigService = createIssueVoiceRuntimeConfigService({
    buildAgentRuntimePackageForTenant: async () => {
      throw new Error('should not build without config');
    },
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(createVoiceSessionTokenSupabaseStub({})),
    getSupabaseAdminEnv,
    verifyVoiceSessionToken,
  });

  const missingConfig = await withEnv(
    {
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => missingConfigService(`Bearer ${signedToken}`),
  );

  assert.deepEqual(missingConfig, {
    body: {
      error:
        'Server configuration for voice runtime configuration is unavailable.',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 500,
  });

  const buildFailureService = createIssueVoiceRuntimeConfigService({
    buildAgentRuntimePackageForTenant: async () => ({
      message: 'No business configuration is available for this tenant runtime.',
      ok: false,
    }),
    createServerSupabaseAdminClient: async () =>
      asSupabaseClientStub(
        createVoiceSessionTokenSupabaseStub({
          agent: {
            id: 'aaaaaaaa-2000-4000-8000-000000000001',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          conversation: {
            agent_id: 'aaaaaaaa-2000-4000-8000-000000000001',
            id: 'aaaaaaaa-5000-4000-8000-000000000001',
            source: 'browser_test',
            status: 'starting',
            tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          },
          tenant: {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
            name: 'Greenleaf Dental',
            slug: 'greenleaf-dental',
          },
        }),
      ),
    getSupabaseAdminEnv,
    verifyVoiceSessionToken,
  });

  const buildFailure = await withEnv(
    {
      ...createSupabaseEnv(),
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    () => buildFailureService(`Bearer ${signedToken}`),
  );

  assert.deepEqual(buildFailure, {
    body: {
      error: 'Unable to build the runtime configuration right now.',
    },
    headers: {
      'Cache-Control': 'no-store',
    },
    status: 500,
  });
});

test('createIssueVoiceRuntimeConfigRouteHandler ignores body runtime configuration and uses the bearer header only', async () => {
  const handler = createIssueVoiceRuntimeConfigRouteHandler(async (header) => {
    assert.equal(header, 'Bearer signed-token-value');
    return {
      body: {
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
        runtimePackage: createRuntimePackageFixture(),
      },
      headers: {
        'Cache-Control': 'no-store',
      },
      status: 200,
    };
  });

  const response = await handler(
    new Request('http://localhost/api/voice/runtime-config', {
      body: JSON.stringify({
        runtimeConfig: {
          agentId: 'fake-agent',
          tenantId: 'fake-tenant',
          voiceId: 'fake-voice',
        },
      }),
      headers: {
        authorization: 'Bearer signed-token-value',
        'content-type': 'application/json',
      },
      method: 'POST',
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    runtimePackage: createRuntimePackageFixture(),
  });
});

test('voice session token helpers do not write full token values to console output', async () => {
  await withEnv(
    {
      VOICE_SESSION_SIGNING_SECRET: createVoiceSessionSigningSecret(),
    },
    async () => {
      const signed = await signVoiceSessionToken({
        agentId: 'aaaaaaaa-2000-4000-8000-000000000001',
        conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
        now: new Date('2026-08-06T12:00:00.000Z'),
      });

      const captured = await withCapturedConsole(async () =>
        verifyVoiceSessionToken(signed.token, {
          currentDate: new Date('2026-08-06T12:05:00.000Z'),
        }),
      );

      assert.equal(captured.result.ok, true);
      assert.equal(captured.entries.length, 0);
      assert.equal(captured.entries.includes(signed.token), false);
    },
  );
});
