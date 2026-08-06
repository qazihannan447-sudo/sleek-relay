import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getConversationMessageText,
  mapTransportStateToStatus,
  resolveVoiceRunnerConfig,
} from '../lib/voice/session';

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

test('mapTransportStateToStatus compresses Pipecat transport states for the UI', () => {
  assert.equal(mapTransportStateToStatus('disconnected'), 'disconnected');
  assert.equal(mapTransportStateToStatus('initializing'), 'connecting');
  assert.equal(mapTransportStateToStatus('connected'), 'connecting');
  assert.equal(mapTransportStateToStatus('ready'), 'ready');
  assert.equal(mapTransportStateToStatus('error'), 'error');
});

test('getConversationMessageText combines spoken and pending agent transcript text', () => {
  const text = getConversationMessageText({
    createdAt: '2026-08-06T10:00:00.000Z',
    parts: [
      {
        createdAt: '2026-08-06T10:00:01.000Z',
        final: false,
        text: {
          spoken: 'Hello there',
          unspoken: ', how can I help?',
        },
      },
    ],
    role: 'assistant',
  });

  assert.equal(text, 'Hello there, how can I help?');
});

test('getConversationMessageText ignores non-text React content parts', () => {
  const text = getConversationMessageText({
    createdAt: '2026-08-06T10:00:00.000Z',
    parts: [
      {
        createdAt: '2026-08-06T10:00:01.000Z',
        final: true,
        text: 'Need an appointment tomorrow',
      },
      {
        createdAt: '2026-08-06T10:00:02.000Z',
        final: true,
        text: null,
      },
    ],
    role: 'user',
  });

  assert.equal(text, 'Need an appointment tomorrow');
});
