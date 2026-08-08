import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abandonBrowserVoicePrebootstrap,
  prepareBrowserVoicePrebootstrap,
  resetVoiceConnectWarmupForTests,
  takeBrowserVoicePrebootstrap,
} from '../lib/voice/warm-connect';

const agentId = 'aaaaaaaa-2000-4000-8000-000000000001';
const conversationId = 'aaaaaaaa-5000-4000-8000-000000000001';

function buildBootstrapResponse(expiresAt: string) {
  return new Response(
    JSON.stringify({
      conversationId,
      expiresAt,
      runtimePackage: {
        agent: {
          greeting: 'Prebootstrapped greeting',
        },
      },
      startedAt: '2026-08-06T12:00:00.000Z',
      status: 'starting',
      token: 'signed-token-value',
      tokenType: 'Bearer',
    }),
    {
      headers: {
        'content-type': 'application/json',
      },
      status: 201,
    },
  );
}

test('prepare + take reuses one bootstrap and skips a second create on Connect', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url === '/api/voice/browser-test/bootstrap') {
      return buildBootstrapResponse('2099-01-01T00:00:00.000Z');
    }

    if (url.endsWith('/lifecycle')) {
      return new Response(
        JSON.stringify({
          conversationId,
          endReason: 'prebootstrap_unused',
          finalized: true,
          status: 'failed',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await prepareBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
  });

  const timingEvents: string[] = [];
  const first = await takeBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
    onTimingEvent: (name) => timingEvents.push(name),
  });
  const second = await takeBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
  });

  assert.equal(first.conversationId, conversationId);
  assert.equal(second.conversationId, conversationId);
  assert.deepEqual(timingEvents, [
    'conversation_creation_finished',
    'session_token_finished',
  ]);
  assert.deepEqual(
    calls.filter((call) => call.includes('/browser-test/bootstrap')),
    [
      'POST /api/voice/browser-test/bootstrap',
      'POST /api/voice/browser-test/bootstrap',
    ],
  );

  resetVoiceConnectWarmupForTests();
});

test('abandon finalizes an unused prebootstrap conversation', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url === '/api/voice/browser-test/bootstrap') {
      return buildBootstrapResponse('2099-01-01T00:00:00.000Z');
    }

    if (url.endsWith('/lifecycle')) {
      assert.equal(init?.method, 'PATCH');
      return new Response(
        JSON.stringify({
          conversationId,
          endReason: 'prebootstrap_unused',
          finalized: true,
          status: 'failed',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      );
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  await prepareBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
  });
  await abandonBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
  });

  assert.ok(
    calls.some(
      (call) =>
        call ===
        `PATCH /api/voice/conversations/${conversationId}/lifecycle`,
    ),
  );

  resetVoiceConnectWarmupForTests();
});
