import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildConversationLatencySummary,
  buildConversationTimelineItems,
  buildTurnDetailRows,
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
    'Transcribed · STT 410ms',
  );

  assert.ok(assistantItem && assistantItem.kind === 'message');
  assert.equal(assistantItem.chipSide, 'assistant');
  assert.equal(
    formatTurnChipSummary(assistantItem.turn!, 'assistant'),
    'LLM 40ms',
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
    'LLM 40ms · Spoke 1.20s',
  );
});

test('formatTurnChipSummary prefers response latency and separates speaking duration', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        metrics: {
          speechStopToSttFinalMs: 42,
          sttFinalToLlmFirstTokenMs: 549,
          llmFirstTokenToTtsFirstAudioMs: 74,
          ttsFirstAudioToBotSpeakingMs: 42,
          speechStopToBotSpeakingMs: 665,
          botSpeakingDurationMs: 3200,
        },
        stages: [
          { stage: 'stt', status: 'ok', durationMs: 42, provider: 'deepgram', side: 'stt' },
          { stage: 'llm', status: 'ok', durationMs: 549, provider: 'gemini', side: 'assistant' },
          { stage: 'tts', status: 'ok', durationMs: 74, provider: 'cartesia', side: 'assistant' },
          {
            stage: 'tts',
            status: 'ok',
            durationMs: 3200,
            provider: 'cartesia',
            label: 'Speaking duration',
            side: 'assistant',
          },
        ],
      },
    ],
  });

  const turn = diagnostics.turns[0]!;
  assert.equal(formatTurnChipSummary(turn, 'stt'), 'Transcribed · STT 42ms');
  assert.equal(
    formatTurnChipSummary(turn, 'assistant'),
    'Response 665ms · Spoke 3.2s',
  );

  assert.deepEqual(
    buildTurnDetailRows(turn, 'stt').map((row) => row.label),
    ['Speech stop → STT final'],
  );
  assert.deepEqual(
    buildTurnDetailRows(turn, 'assistant').map((row) => row.label),
    [
      'LLM first token',
      'TTS first audio',
      'Playback overhead',
      'End speech → first audio',
      'Speaking duration',
    ],
  );
});

test('buildConversationLatencySummary reports median and extremes', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        metrics: { speechStopToBotSpeakingMs: 500, speechStopToSttFinalMs: 40 },
        stages: [],
      },
      {
        turnId: 's1-t2',
        index: 2,
        status: 'ok',
        metrics: { speechStopToBotSpeakingMs: 700, toolExecutionMs: 1200, toolCallCount: 1 },
        stages: [],
      },
      {
        turnId: 's1-t3',
        index: 3,
        status: 'ok',
        metrics: { speechStopToBotSpeakingMs: 2000 },
        stages: [],
      },
    ],
  });

  const summary = buildConversationLatencySummary(diagnostics);
  assert.ok(summary);
  assert.equal(summary.medianResponseLatencyMs, 700);
  assert.equal(summary.fastestResponseLatencyMs, 500);
  assert.equal(summary.slowestResponseLatencyMs, 2000);
  assert.equal(summary.slowResponseCount, 1);
  assert.equal(summary.totalToolCalls, 1);
});

test('end-session assistant chips avoid inventing LLM metrics', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t9',
        index: 9,
        status: 'end_session',
        metrics: { botSpeakingDurationMs: 975 },
        stages: [
          {
            stage: 'tts',
            status: 'ok',
            durationMs: 975,
            label: 'End session · Goodbye played',
            side: 'assistant',
          },
        ],
      },
    ],
  });

  const turn = diagnostics.turns[0]!;
  assert.equal(
    formatTurnChipSummary(turn, 'assistant'),
    'End session · Goodbye played · 975ms',
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
