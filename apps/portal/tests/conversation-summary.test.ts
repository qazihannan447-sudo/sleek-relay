import assert from 'node:assert/strict';
import test from 'node:test';

import {
  preferSummaryTranscript,
  normalizeSummaryTranscriptMessages,
} from '../lib/conversations/conversation-summary-persistence';
import {
  buildConversationSummaryPrompts,
  formatTranscriptForSummary,
  generateConversationSummaryFromTranscript,
  loadConversationSummaryLlmConfig,
  shouldReplaceConversationSummary,
} from '../lib/conversations/generate-conversation-summary';
import { createBrowserConversationLifecycleService } from '../lib/voice/conversation-lifecycle';

test('loadConversationSummaryLlmConfig uses GOOGLE_* only (not scraper GEMINI_*)', () => {
  assert.equal(loadConversationSummaryLlmConfig({}), null);

  assert.deepEqual(
    loadConversationSummaryLlmConfig({
      GOOGLE_API_KEY: ' google-key ',
      GOOGLE_MODEL: 'gemini-2.5-flash',
    }),
    {
      apiKey: 'google-key',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      model: 'gemini-2.5-flash',
    },
  );

  assert.equal(
    loadConversationSummaryLlmConfig({
      GEMINI_API_KEY: 'gemini-key',
      GEMINI_MODEL: 'gemini-flash-latest',
    }),
    null,
  );
});

test('formatTranscriptForSummary labels speakers and skips blanks', () => {
  assert.equal(
    formatTranscriptForSummary([
      { content: '  Hello  ', role: 'user' },
      { content: '   ', role: 'assistant' },
      { content: 'Hi there', role: 'assistant' },
      { content: 'note', role: 'system' },
    ]),
    'Caller: Hello\nAgent: Hi there\nSystem: note',
  );
});

test('preferSummaryTranscript uses database messages when present', () => {
  assert.deepEqual(
    preferSummaryTranscript({
      databaseMessages: [{ content: 'from db', role: 'user' }],
      requestMessages: [{ content: 'from browser', role: 'user' }],
    }),
    [{ content: 'from db', role: 'user' }],
  );

  assert.deepEqual(
    preferSummaryTranscript({
      databaseMessages: [],
      requestMessages: [{ content: 'from browser', role: 'user' }],
    }),
    [{ content: 'from browser', role: 'user' }],
  );
});

test('resolveConversationSummaryUiState covers waiting generating empty and ready', async () => {
  const { resolveConversationSummaryUiState } = await import(
    '../lib/conversations/conversation-summary-state'
  );

  assert.equal(
    resolveConversationSummaryUiState({
      hasTranscript: true,
      status: 'active',
      summary: null,
    }),
    'waiting',
  );
  assert.equal(
    resolveConversationSummaryUiState({
      hasTranscript: false,
      status: 'completed',
      summary: null,
    }),
    'empty',
  );
  assert.equal(
    resolveConversationSummaryUiState({
      hasTranscript: true,
      status: 'completed',
      summary: 'Browser voice test completed with 1 user message.',
    }),
    'generating',
  );
  assert.equal(
    resolveConversationSummaryUiState({
      hasTranscript: true,
      status: 'completed',
      summary: 'The caller asked about a cleaning appointment.',
    }),
    'ready',
  );
});

test('normalizeSummaryTranscriptMessages drops invalid rows', () => {
  assert.deepEqual(
    normalizeSummaryTranscriptMessages([
      { content: 'Hi', role: 'user' },
      { content: '  ', role: 'assistant' },
      { content: 'Nope', role: 'tool' },
      { content: 'Ok', role: 'assistant' },
    ]),
    [
      { content: 'Hi', role: 'user' },
      { content: 'Ok', role: 'assistant' },
    ],
  );
});

test('buildConversationSummaryPrompts stay transcript-bound', () => {
  const prompts = buildConversationSummaryPrompts({
    endReason: 'user_disconnect',
    event: 'completed',
    transcriptMessages: [
      { content: 'What are your hours?', role: 'user' },
      { content: 'We open at 9.', role: 'assistant' },
    ],
  });

  assert.match(prompts.systemPrompt, /Do not invent business hours/);
  assert.match(prompts.userPrompt, /Caller: What are your hours\?/);
  assert.match(prompts.userPrompt, /Agent: We open at 9\./);
  assert.match(prompts.userPrompt, /End reason: user_disconnect/);
});

test('shouldReplaceConversationSummary targets empty and legacy templates', () => {
  assert.equal(shouldReplaceConversationSummary(null), true);
  assert.equal(shouldReplaceConversationSummary(''), true);
  assert.equal(
    shouldReplaceConversationSummary(
      'Browser voice test completed with 1 user message and 1 agent message.',
    ),
    true,
  );
  assert.equal(
    shouldReplaceConversationSummary(
      'Caller asked about cleaning and left a message.',
    ),
    false,
  );
});

test('generateConversationSummaryFromTranscript returns null without config or transcript', async () => {
  assert.equal(
    await generateConversationSummaryFromTranscript(
      {
        event: 'completed',
        transcriptMessages: [{ content: 'Hi', role: 'user' }],
      },
      { loadConfig: () => null },
    ),
    null,
  );

  assert.equal(
    await generateConversationSummaryFromTranscript(
      {
        event: 'completed',
        transcriptMessages: [],
      },
      {
        loadConfig: () => ({
          apiKey: 'key',
          baseURL: 'https://example.test',
          model: 'gemini-2.5-flash',
        }),
      },
    ),
    null,
  );
});

test('generateConversationSummaryFromTranscript uses injected complete and truncates', async () => {
  const summary = await generateConversationSummaryFromTranscript(
    {
      endReason: 'user_disconnect',
      event: 'completed',
      transcriptMessages: [
        { content: 'I need a cleaning.', role: 'user' },
        { content: 'I can help with that.', role: 'assistant' },
      ],
    },
    {
      complete: async () =>
        `  The caller asked about a cleaning and the agent offered to help.  ${'x'.repeat(1_200)}`,
      loadConfig: () => ({
        apiKey: 'key',
        baseURL: 'https://example.test',
        model: 'gemini-2.5-flash',
      }),
    },
  );

  assert.ok(summary);
  assert.equal(summary!.startsWith('The caller asked about a cleaning'), true);
  assert.equal(summary!.endsWith('...'), true);
  assert.ok(summary!.length <= 1_000);
});

test('generateConversationSummaryFromTranscript returns null when complete fails', async () => {
  assert.equal(
    await generateConversationSummaryFromTranscript(
      {
        event: 'failed',
        transcriptMessages: [{ content: 'Hi', role: 'user' }],
      },
      {
        complete: async () => {
          throw new Error('provider down');
        },
        loadConfig: () => ({
          apiKey: 'key',
          baseURL: 'https://example.test',
          model: 'gemini-2.5-flash',
        }),
      },
    ),
    null,
  );
});

test('lifecycle writes fallback immediately and Gemini summary in background', async () => {
  const updateCalls: unknown[] = [];
  let storedMessages: Array<{
    content: string;
    conversation_id: string;
    role: string;
    sequence_number: number;
    tenant_id: string;
  }> = [];

  const updateLifecycle = createBrowserConversationLifecycleService({
    createServerSupabaseAdminClient: async () =>
      ({
        from(table: string) {
          const filters = new Map<string, unknown>();

          if (table === 'conversation_messages') {
            return {
              upsert: async (value: unknown) => {
                storedMessages = Array.isArray(value)
                  ? (value as typeof storedMessages)
                  : [];
                return { error: null };
              },
              select() {
                return this;
              },
              eq(column: string, value: unknown) {
                filters.set(column, value);
                return this;
              },
              order: async () => ({
                data: storedMessages.map((message) => ({
                  content: message.content,
                  role: message.role,
                  sequence_number: message.sequence_number,
                })),
                error: null,
              }),
            };
          }

          return {
            select() {
              return this;
            },
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return this;
            },
            maybeSingle: async () => ({
              data: {
                end_reason: null,
                id: 'aaaaaaaa-5000-4000-8000-000000000001',
                outcome: null,
                runtime_snapshot: {},
                started_at: '2026-08-06T12:00:00.000Z',
                status: 'active',
                summary: null,
                tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
              },
              error: null,
            }),
            update(payload: unknown) {
              updateCalls.push(payload);
              return {
                eq() {
                  return this;
                },
                select() {
                  return this;
                },
                maybeSingle: async () => ({
                  data: {
                    end_reason: 'user_disconnect',
                    id: 'aaaaaaaa-5000-4000-8000-000000000001',
                    outcome: null,
                    runtime_snapshot: {},
                    started_at: '2026-08-06T12:00:00.000Z',
                    status: 'completed',
                    summary: null,
                    tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                  },
                  error: null,
                }),
              };
            },
          };
        },
      }) as never,
    generateConversationSummary: async () =>
      'The caller asked to book a cleaning and the agent offered to help.',
    getSupabaseAdminEnv: () => ({
      supabaseServiceRoleKey: 'service-role-key',
      supabaseUrl: 'https://example.supabase.co',
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
    now: () => new Date('2026-08-06T12:05:30.000Z'),
    scheduleBackgroundWork: async (task) => {
      await task();
    },
  });

  const result = await updateLifecycle({
    conversationId: 'aaaaaaaa-5000-4000-8000-000000000001',
    request: {
      endReason: 'user_disconnect',
      event: 'completed',
      transcriptMessages: [
        { content: 'I need to book a cleaning.', role: 'user' },
        { content: 'I can help with that request.', role: 'assistant' },
      ],
    },
  });

  assert.equal(result.status, 200);
  assert.equal(
    updateCalls.some(
      (call) =>
        call &&
        typeof call === 'object' &&
        typeof (call as { summary?: string }).summary === 'string' &&
        (call as { summary: string }).summary.startsWith('Browser voice test'),
    ),
    true,
  );
  assert.equal(
    updateCalls.some(
      (call) =>
        call &&
        typeof call === 'object' &&
        (call as { summary?: string }).summary ===
          'The caller asked to book a cleaning and the agent offered to help.',
    ),
    true,
  );
});
