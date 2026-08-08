import assert from 'node:assert/strict';
import test from 'node:test';

import {
  abandonBrowserVoicePrebootstrap,
  abandonVoiceSessionPrestart,
  isVoiceSessionPrestartFresh,
  prepareBrowserVoicePrebootstrap,
  prepareVoiceSessionPrestart,
  resetVoiceConnectWarmupForTests,
  takeBrowserVoicePrebootstrap,
  takeVoiceSessionPrestart,
} from '../lib/voice/warm-connect';
import {
  VOICE_SESSION_ARMED_MESSAGE_TYPE,
  VOICE_SESSION_PREJOIN_MAX_AGE_MS,
} from '../lib/voice/browser-test';

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

const runnerStartUrl = 'https://voice-runner.example.com/start';

function buildPrestartFetch(calls: string[], startBodies: unknown[]) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url === '/api/voice/browser-test/bootstrap') {
      return buildBootstrapResponse('2099-01-01T00:00:00.000Z');
    }

    if (url === runnerStartUrl) {
      startBodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          dailyRoom: 'https://example.daily.co/sleek-test',
          dailyToken: 'daily-token-value',
          sessionId: 'session-1',
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 200,
        },
      );
    }

    if (url.endsWith('/lifecycle')) {
      return new Response(
        JSON.stringify({
          conversationId,
          endReason: 'prestart_unused',
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

  return fetchImpl;
}

test('prestart calls /start once and Connect take reuses the same session', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const startBodies: unknown[] = [];
  const fetchImpl = buildPrestartFetch(calls, startBodies);

  await prepareVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    startUrl: runnerStartUrl,
  });

  const timingEvents: string[] = [];
  const taken = await takeVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    onTimingEvent: (name) => timingEvents.push(name),
  });

  assert.ok(taken);
  assert.equal(taken.bootstrap.conversationId, conversationId);
  assert.deepEqual(taken.startResponse, {
    dailyRoom: 'https://example.daily.co/sleek-test',
    dailyToken: 'daily-token-value',
    sessionId: 'session-1',
  });
  assert.deepEqual(timingEvents, [
    'conversation_creation_finished',
    'session_token_finished',
  ]);

  // Exactly one bootstrap and one /start; the /start body is the requestData.
  assert.equal(
    calls.filter((call) => call === `POST ${runnerStartUrl}`).length,
    1,
  );
  assert.equal(
    calls.filter((call) => call.includes('/browser-test/bootstrap')).length,
    1,
  );
  const startBody = startBodies[0] as {
    body: { voiceSessionToken: string };
    createDailyRoom: boolean;
    transport: string;
  };
  assert.equal(startBody.createDailyRoom, true);
  assert.equal(startBody.transport, 'daily');
  assert.equal(startBody.body.voiceSessionToken, 'signed-token-value');

  // A second take finds nothing (session already consumed).
  const second = await takeVoiceSessionPrestart({ agentId, fetch: fetchImpl });
  assert.equal(second, null);

  resetVoiceConnectWarmupForTests();
});

test('prestart prepare dedupes while fresh and abandon finalizes the conversation', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const startBodies: unknown[] = [];
  const fetchImpl = buildPrestartFetch(calls, startBodies);

  await prepareVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    startUrl: runnerStartUrl,
  });
  await prepareVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    startUrl: runnerStartUrl,
  });

  assert.equal(
    calls.filter((call) => call === `POST ${runnerStartUrl}`).length,
    1,
  );

  await abandonVoiceSessionPrestart({ agentId, fetch: fetchImpl });

  assert.ok(
    calls.some(
      (call) =>
        call ===
        `PATCH /api/voice/conversations/${conversationId}/lifecycle`,
    ),
  );

  // Abandoned prestarts are gone; nothing left to take.
  const taken = await takeVoiceSessionPrestart({ agentId, fetch: fetchImpl });
  assert.equal(taken, null);

  resetVoiceConnectWarmupForTests();
});

test('prestart failure finalizes the reserved conversation and take falls back to null', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url === '/api/voice/browser-test/bootstrap') {
      return buildBootstrapResponse('2099-01-01T00:00:00.000Z');
    }

    if (url === runnerStartUrl) {
      return new Response('runner exploded', { status: 500 });
    }

    if (url.endsWith('/lifecycle')) {
      return new Response(
        JSON.stringify({
          conversationId,
          endReason: 'prestart_failed',
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

  const prepared = await prepareVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    startUrl: runnerStartUrl,
  });
  assert.equal(prepared, null);

  const taken = await takeVoiceSessionPrestart({ agentId, fetch: fetchImpl });
  assert.equal(taken, null);

  assert.ok(
    calls.some(
      (call) =>
        call ===
        `PATCH /api/voice/conversations/${conversationId}/lifecycle`,
    ),
  );

  resetVoiceConnectWarmupForTests();
});

test('isVoiceSessionPrestartFresh matches the shared prejoin max age window', () => {
  const startedAtMs = 1_000_000;
  assert.equal(
    isVoiceSessionPrestartFresh(startedAtMs, startedAtMs + VOICE_SESSION_PREJOIN_MAX_AGE_MS),
    true,
  );
  assert.equal(
    isVoiceSessionPrestartFresh(
      startedAtMs,
      startedAtMs + VOICE_SESSION_PREJOIN_MAX_AGE_MS + 1,
    ),
    false,
  );
  assert.equal(VOICE_SESSION_ARMED_MESSAGE_TYPE, 'session_armed');
});

test('Connect take after prepare does not call /start a second time (prejoin reuse)', async () => {
  resetVoiceConnectWarmupForTests();

  const calls: string[] = [];
  const startBodies: unknown[] = [];
  const fetchImpl = buildPrestartFetch(calls, startBodies);

  const prepared = await prepareVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
    startUrl: runnerStartUrl,
  });
  assert.ok(prepared);
  assert.equal(isVoiceSessionPrestartFresh(prepared.startedAtMs), true);

  const taken = await takeVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
  });
  assert.ok(taken);
  assert.equal(taken.bootstrap.conversationId, prepared.bootstrap.conversationId);
  assert.equal(
    calls.filter((call) => call === `POST ${runnerStartUrl}`).length,
    1,
  );

  const secondTake = await takeVoiceSessionPrestart({
    agentId,
    fetch: fetchImpl,
  });
  assert.equal(secondTake, null);

  resetVoiceConnectWarmupForTests();
});
