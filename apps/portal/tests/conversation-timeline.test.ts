import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationTimelineItems,
  enrichConversationLatencyDiagnostics,
  formatConversationFailureBadge,
  formatTurnChipSummary,
  inferFailureStageFromStoredError,
  parseConversationLatencyDiagnostics,
} from '../lib/conversations/conversation-timeline';

test('parseConversationLatencyDiagnostics allowlists v2 timeline fields', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    speech_stop_to_stt_final_ms: 410,
    session_events: [
      {
        id: 'sev_1',
        at: '2026-08-08T07:01:03.000Z',
        type: 'session_started',
        status: 'info',
        label: 'Session started',
      },
      {
        id: 'sev_2',
        type: 'not_a_real_event',
        status: 'info',
        label: 'Ignore me',
      },
    ],
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        userMessageSeq: 2,
        assistantMessageSeq: 3,
        metrics: {
          speechStopToSttFinalMs: 410,
          sttFinalToLlmFirstTokenMs: 40,
          llmFirstTokenToTtsFirstAudioMs: 90,
          totalTurnDurationMs: 2100,
        },
        stages: [
          { stage: 'stt', status: 'ok', durationMs: 410, provider: 'deepgram' },
          { stage: 'llm', status: 'ok', durationMs: 40, provider: 'gemini' },
          { stage: 'tts', status: 'ok', durationMs: 90, provider: 'cartesia' },
        ],
      },
    ],
    failure: null,
    secretPrompt: 'should be ignored',
  });

  assert.equal(diagnostics.version, 2);
  assert.equal(diagnostics.sessionEvents.length, 1);
  assert.equal(diagnostics.turns.length, 1);
  assert.equal(diagnostics.turns[0]?.userMessageSeq, 2);
  assert.equal(diagnostics.failure, null);
  assert.equal(diagnostics.isLegacyFallback, false);
});

test('buildConversationTimelineItems puts STT under user and LLM/TTS under assistant', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    session_events: [
      {
        id: 'sev_1',
        type: 'session_started',
        status: 'info',
        label: 'Session started',
      },
      {
        id: 'sev_2',
        type: 'greeting_played',
        status: 'ok',
        label: 'Greeting played',
      },
      {
        id: 'sev_3',
        type: 'session_ended',
        status: 'ok',
        label: 'Session ended',
      },
    ],
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        userMessageSeq: 2,
        assistantMessageSeq: 3,
        metrics: {
          speechStopToSttFinalMs: 410,
          sttFinalToLlmFirstTokenMs: 40,
          llmFirstTokenToTtsFirstAudioMs: 90,
          totalTurnDurationMs: 2100,
        },
        stages: [],
      },
    ],
    failure: null,
  });

  const items = buildConversationTimelineItems({
    diagnostics,
    messages: [
      {
        id: 'm1',
        sequenceNumber: 1,
        role: 'assistant',
        roleLabel: 'Agent',
        content: 'Hi',
        interrupted: false,
        interruptedLabel: null,
        isFinal: true,
        stateLabel: 'Final',
        timestamp: '2026-08-08T07:01:04.000Z',
      },
      {
        id: 'm2',
        sequenceNumber: 2,
        role: 'user',
        roleLabel: 'Caller',
        content: 'Hours?',
        interrupted: false,
        interruptedLabel: null,
        isFinal: true,
        stateLabel: 'Final',
        timestamp: '2026-08-08T07:01:12.000Z',
      },
      {
        id: 'm3',
        sequenceNumber: 3,
        role: 'assistant',
        roleLabel: 'Agent',
        content: 'Saturday 9 to 2',
        interrupted: false,
        interruptedLabel: null,
        isFinal: true,
        stateLabel: 'Final',
        timestamp: '2026-08-08T07:01:14.000Z',
      },
    ],
  });

  assert.equal(items[0]?.kind, 'session');
  assert.equal(items[1]?.kind, 'session');

  const userItem = items.find(
    (item) => item.kind === 'message' && item.message.sequenceNumber === 2,
  );
  const assistantItem = items.find(
    (item) => item.kind === 'message' && item.message.sequenceNumber === 3,
  );

  assert.ok(userItem && userItem.kind === 'message');
  assert.equal(userItem.chipSide, 'stt');
  assert.equal(
    formatTurnChipSummary(userItem.turn!, 'stt'),
    'ok · speech→STT 410ms',
  );

  assert.ok(assistantItem && assistantItem.kind === 'message');
  assert.equal(assistantItem.chipSide, 'assistant');
  assert.equal(
    formatTurnChipSummary(assistantItem.turn!, 'assistant'),
    'ok · STT→LLM 40ms · LLM→TTS 90ms · turn 2.1s',
  );

  assert.equal(items.at(-1)?.kind, 'session');
});

test('buildConversationTimelineItems rematches by user transcript when seq differs', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    session_events: [],
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        userMessageSeq: 99,
        assistantMessageSeq: 100,
        userTranscript: 'Hours?',
        metrics: {
          speechStopToSttFinalMs: 410,
          sttFinalToLlmFirstTokenMs: 40,
          llmFirstTokenToTtsFirstAudioMs: 90,
          botSpeakingDurationMs: 1200,
        },
        stages: [],
      },
    ],
    failure: null,
  });

  const items = buildConversationTimelineItems({
    diagnostics,
    messages: [
      {
        id: 'm2',
        sequenceNumber: 2,
        role: 'user',
        roleLabel: 'Caller',
        content: 'Hours?',
        interrupted: false,
        interruptedLabel: null,
        isFinal: true,
        stateLabel: 'Final',
        timestamp: '2026-08-08T07:01:12.000Z',
      },
      {
        id: 'm3',
        sequenceNumber: 3,
        role: 'assistant',
        roleLabel: 'Agent',
        content: 'Saturday 9 to 2',
        interrupted: false,
        interruptedLabel: null,
        isFinal: true,
        stateLabel: 'Final',
        timestamp: '2026-08-08T07:01:14.000Z',
      },
    ],
  });

  const userItem = items.find(
    (item) => item.kind === 'message' && item.message.sequenceNumber === 2,
  );
  const assistantItem = items.find(
    (item) => item.kind === 'message' && item.message.sequenceNumber === 3,
  );

  assert.ok(userItem && userItem.kind === 'message');
  assert.equal(userItem.chipSide, 'stt');
  assert.ok(assistantItem && assistantItem.kind === 'message');
  assert.equal(assistantItem.chipSide, 'assistant');
  assert.equal(
    formatTurnChipSummary(assistantItem.turn!, 'assistant'),
    'ok · STT→LLM 40ms · LLM→TTS 90ms · spoke 1.20s',
  );
});

test('formatConversationFailureBadge prefers structured failure stage', () => {
  assert.equal(
    formatConversationFailureBadge(
      'failed',
      {
        stage: 'stt',
        turnId: 's1-t3',
        at: null,
        callerHeard: null,
        errorCode: 'deepgram_startup_exhausted',
      },
      'Completed',
    ),
    'STT',
  );
  assert.equal(formatConversationFailureBadge('completed', null, null), null);
  assert.equal(
    formatConversationFailureBadge(
      'failed',
      {
        stage: 'unknown',
        turnId: null,
        at: null,
        callerHeard: null,
        errorCode: null,
      },
      null,
    ),
    null,
  );
  assert.equal(formatConversationFailureBadge('failed', null, null), null);
});

test('enrichConversationLatencyDiagnostics rebuilds rails for legacy calls', () => {
  const enriched = enrichConversationLatencyDiagnostics(
    parseConversationLatencyDiagnostics({
      speech_stop_to_stt_final_ms: 250,
    }),
    {
      startedAt: '2026-08-08T07:01:03.000Z',
      endedAt: '2026-08-08T07:01:40.000Z',
      status: 'failed',
      errorCode: 'deepgram_startup_exhausted',
      errorMessage: 'I am having trouble hearing you.',
      endReason: 'provider_error',
      outcome: null,
    },
  );

  assert.equal(enriched.isLegacyFallback, true);
  assert.equal(enriched.turns.length, 0);
  assert.equal(enriched.failure?.stage, 'stt');
  assert.deepEqual(
    enriched.sessionEvents.map((event) => event.type),
    ['session_started', 'session_failed', 'session_ended'],
  );
  assert.equal(
    inferFailureStageFromStoredError({ errorCode: 'deepgram_startup_exhausted' }),
    'stt',
  );
  assert.equal(
    formatConversationFailureBadge('failed', null, null, {
      errorCode: 'deepgram_startup_exhausted',
    }),
    'STT',
  );
});
