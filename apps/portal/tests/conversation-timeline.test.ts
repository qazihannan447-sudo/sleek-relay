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
    aggregates: {
      median_response_latency_ms: 700,
      p95_response_latency_ms: 1200,
    },
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
  assert.equal(diagnostics.aggregates?.medianResponseLatencyMs, 700);
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
          // Exclusive segments sum to response total.
          speechStopToBotSpeakingMs: 707,
          botSpeakingDurationMs: 3200,
        },
        stages: [],
      },
    ],
  });

  const turn = diagnostics.turns[0]!;
  assert.equal(formatTurnChipSummary(turn, 'stt'), 'Transcribed · STT 42ms');
  assert.equal(
    formatTurnChipSummary(turn, 'assistant'),
    'Response 707ms · Spoke 3.2s',
  );

  assert.deepEqual(
    buildTurnDetailRows(turn, 'stt').map((row) => row.label),
    ['Speech stop → STT final'],
  );
  assert.deepEqual(
    buildTurnDetailRows(turn, 'assistant').map((row) => row.label),
    [
      'Response total · speech stop → bot speaking',
      'Speech stop → STT final',
      'STT final → LLM first token',
      'LLM first token → TTS first audio',
      'TTS first audio → bot speaking',
      'Bot speaking duration (after response start)',
    ],
  );

  const assistantRows = buildTurnDetailRows(turn, 'assistant');
  const segments = assistantRows.filter((row) => row.kind === 'segment');
  const segmentSum = segments.reduce(
    (sum, row) => sum + (row.durationMs ?? 0),
    0,
  );
  assert.equal(segmentSum, turn.metrics.speechStopToBotSpeakingMs);
});

test('tool turns nest tool time outside the exclusive response waterfall', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t2',
        index: 2,
        status: 'ok',
        metrics: {
          speechStopToSttFinalMs: 40,
          sttFinalToLlmFirstTokenMs: 520,
          llmFirstTokenToTtsFirstAudioMs: 1400,
          ttsFirstAudioToBotSpeakingMs: 40,
          speechStopToBotSpeakingMs: 2000,
          toolExecutionMs: 1200,
          toolName: 'create_appointment_request',
          toolCallCount: 1,
          botSpeakingDurationMs: 1800,
        },
        stages: [],
      },
    ],
  });

  const turn = diagnostics.turns[0]!;
  const labels = buildTurnDetailRows(turn, 'assistant').map((row) => row.label);
  assert.deepEqual(labels, [
    'Response total · speech stop → bot speaking',
    'Speech stop → STT final',
    'STT final → LLM first token',
    'LLM first token → TTS first audio',
    'TTS first audio → bot speaking',
    'Appointment tool (nested; do not add)',
    'Bot speaking duration (after response start)',
  ]);

  const segments = buildTurnDetailRows(turn, 'assistant').filter(
    (row) => row.kind === 'segment',
  );
  assert.equal(
    segments.reduce((sum, row) => sum + (row.durationMs ?? 0), 0),
    2000,
  );
});

test('incomplete turns parse as incomplete and are excluded from summary KPIs', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'incomplete',
        metrics: {
          speechStopToBotSpeakingMs: 9000,
          speechStopToSttFinalMs: 40,
        },
        stages: [],
      },
      {
        turnId: 's1-t2',
        index: 2,
        status: 'ok',
        metrics: {
          speechStopToBotSpeakingMs: 700,
          speechStopToSttFinalMs: 50,
        },
        stages: [],
      },
    ],
  });

  assert.equal(diagnostics.turns[0]?.status, 'incomplete');
  assert.equal(
    formatTurnChipSummary(diagnostics.turns[0]!, 'assistant'),
    'incomplete metrics · Response 9.0s',
  );

  const summary = buildConversationLatencySummary(diagnostics);
  assert.ok(summary);
  assert.equal(summary.responseSampleCount, 1);
  assert.equal(summary.medianResponseLatencyMs, 700);
  assert.equal(summary.averageSttLatencyMs, 50);
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

test('buildConversationLatencySummary excludes interrupted and error turns from KPIs', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t1',
        index: 1,
        status: 'ok',
        metrics: { speechStopToBotSpeakingMs: 650, speechStopToSttFinalMs: 55 },
        stages: [],
      },
      {
        turnId: 's1-t2',
        index: 2,
        status: 'interrupted',
        metrics: { speechStopToBotSpeakingMs: 5200, speechStopToSttFinalMs: 480 },
        stages: [],
      },
      {
        turnId: 's1-t3',
        index: 3,
        status: 'error',
        metrics: { speechStopToBotSpeakingMs: 8100, speechStopToSttFinalMs: 900 },
        stages: [],
      },
    ],
  });

  const summary = buildConversationLatencySummary(diagnostics);
  assert.ok(summary);
  assert.equal(summary.responseSampleCount, 1);
  assert.equal(summary.medianResponseLatencyMs, 650);
  assert.equal(summary.p95ResponseLatencyMs, 650);
  assert.equal(summary.averageSttLatencyMs, 55);
  assert.equal(summary.slowResponseCount, 0);
});

test('buildConversationLatencySummary falls back to stored aggregates when turns are unavailable', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    aggregates: {
      average_response_latency_ms: 910,
      fastest_response_latency_ms: 700,
      median_response_latency_ms: 800,
      p95_response_latency_ms: 1400,
      response_sample_count: 4,
      slow_response_count: 1,
      slowest_response_latency_ms: 1500,
      speech_stop_to_stt_final_ms: 120,
      average_tool_execution_ms: 450,
      total_tool_calls: 2,
    },
    turns: [],
  });

  const summary = buildConversationLatencySummary(diagnostics);
  assert.ok(summary);
  assert.equal(summary.medianResponseLatencyMs, 800);
  assert.equal(summary.averageResponseLatencyMs, 910);
  assert.equal(summary.p95ResponseLatencyMs, 1400);
  assert.equal(summary.fastestResponseLatencyMs, 700);
  assert.equal(summary.slowestResponseLatencyMs, 1500);
  assert.equal(summary.responseSampleCount, 4);
  assert.equal(summary.slowResponseCount, 1);
  assert.equal(summary.averageSttLatencyMs, 120);
  assert.equal(summary.averageToolExecutionMs, 450);
  assert.equal(summary.totalToolCalls, 2);
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

test('stage-only assistant diagnostics still render transcript breakdown rows and chip summary', () => {
  const diagnostics = parseConversationLatencyDiagnostics({
    version: 2,
    turns: [
      {
        turnId: 's1-t4',
        index: 4,
        status: 'ok',
        metrics: {
          speechStopToBotSpeakingMs: 920,
        },
        stages: [
          {
            stage: 'stt',
            status: 'ok',
            durationMs: 70,
            provider: 'deepgram',
            label: 'Speech stop → STT final',
            side: 'assistant',
          },
          {
            stage: 'llm',
            status: 'ok',
            durationMs: 500,
            provider: 'gemini',
            label: 'STT final → LLM first token',
            side: 'assistant',
          },
          {
            stage: 'tts',
            status: 'ok',
            durationMs: 300,
            label: 'LLM first token → TTS first audio',
            side: 'assistant',
          },
          {
            stage: 'tts',
            status: 'ok',
            durationMs: 50,
            label: 'TTS first audio → bot speaking',
            side: 'assistant',
          },
          {
            stage: 'tool',
            status: 'ok',
            durationMs: 240,
            label: 'Appointment tool (nested; do not add)',
            toolName: 'create_appointment_request',
            side: 'assistant',
          },
          {
            stage: 'tts',
            status: 'ok',
            durationMs: 1800,
            provider: 'cartesia',
            label: 'Bot speaking duration (after response start)',
            side: 'assistant',
          },
        ],
      },
    ],
  });

  const turn = diagnostics.turns[0]!;
  assert.equal(
    formatTurnChipSummary(turn, 'assistant'),
    'Response 920ms · Tool executed · Spoke 1.80s',
  );
  assert.deepEqual(
    buildTurnDetailRows(turn, 'assistant').map((row) => row.label),
    [
      'Response total · speech stop → bot speaking',
      'Speech stop → STT final',
      'STT final → LLM first token',
      'LLM first token → TTS first audio',
      'TTS first audio → bot speaking',
      'Appointment tool (nested; do not add)',
      'Bot speaking duration (after response start)',
    ],
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
