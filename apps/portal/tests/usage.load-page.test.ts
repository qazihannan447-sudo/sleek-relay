import assert from 'node:assert/strict';
import test from 'node:test';

import { createUsagePageDataLoader } from '../lib/usage/load-usage-page';

type UsageConversationRow = {
  agent_id: string;
  duration_ms: number | null;
  ended_at: string | null;
  id: string;
  latency_metrics: unknown;
  outcome: string | null;
  started_at: string;
  status: string;
  usage_metrics: unknown;
};

type QueryCall = {
  filters: Array<{
    column: string;
    operator: 'eq' | 'gte' | 'lte';
    value: unknown;
  }>;
  range: { from: number; to: number } | null;
  selectColumns: string | null;
  table: string;
};

function createUsageSupabaseStub(args: {
  agentRows?: Array<{ id: string; name: string }>;
  conversationRows: UsageConversationRow[];
}) {
  const calls: QueryCall[] = [];

  function resolveQuery(call: QueryCall) {
    if (call.table === 'agents') {
      return {
        data: args.agentRows ?? [{ id: 'agent-a', name: 'Agent A' }],
        error: null,
      };
    }

    if (call.table !== 'conversations') {
      return { data: null, error: null };
    }

    const from = call.range?.from ?? 0;
    const to = call.range?.to ?? args.conversationRows.length - 1;

    return {
      data: args.conversationRows.slice(from, to + 1),
      error: null,
    };
  }

  return {
    calls,
    supabase: {
      from(table: string) {
        const call: QueryCall = {
          filters: [],
          range: null,
          selectColumns: null,
          table,
        };

        const query = {
          eq(column: string, value: unknown) {
            call.filters.push({ column, operator: 'eq', value });
            return query;
          },
          gte(column: string, value: string) {
            call.filters.push({ column, operator: 'gte', value });
            return query;
          },
          lte(column: string, value: string) {
            call.filters.push({ column, operator: 'lte', value });
            return query;
          },
          order() {
            return query;
          },
          range(from: number, to: number) {
            call.range = { from, to };
            return query;
          },
          select(columns: string) {
            call.selectColumns = columns;
            return query;
          },
          then<TResult1 = unknown, TResult2 = never>(
            onfulfilled?:
              | ((_value: {
                  data: unknown;
                  error: null;
                }) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?: ((_reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            calls.push({
              ...call,
              filters: [...call.filters],
              range: call.range ? { ...call.range } : null,
            });

            return Promise.resolve(resolveQuery(call)).then(onfulfilled, onrejected);
          },
        };

        return query;
      },
    },
  };
}

function createWorkspace() {
  return {
    canManageAgents: true,
    canManageBusinessConfiguration: true,
    canManageKnowledge: true,
    email: 'owner@example.com',
    kind: 'authenticated' as const,
    membershipRole: 'owner',
    tenantId: 'tenant-a',
    tenantName: 'Tenant A',
    tenantSlug: 'tenant-a',
  };
}

test('usage loader paginates past the first 1000 conversations for latency analytics', async () => {
  const rows: UsageConversationRow[] = Array.from({ length: 1001 }, (_, index) => ({
    agent_id: 'agent-a',
    duration_ms: 60_000,
    ended_at: `2026-08-08T10:${String(index % 60).padStart(2, '0')}:30.000Z`,
    id: `conversation-${index + 1}`,
    latency_metrics: {
      turns: [
        {
          turn_id: `turn-${index + 1}`,
          status: 'ok',
          metrics: {
            speech_stop_to_bot_speaking_ms: index === 1000 ? 9000 : 1000,
          },
        },
      ],
    },
    outcome: 'completed',
    started_at: `2026-08-08T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    status: 'completed',
    usage_metrics: null,
  }));

  const stub = createUsageSupabaseStub({ conversationRows: rows });
  const loadUsagePageData = createUsagePageDataLoader({
    createServerSupabaseClient: async () => stub.supabase as any,
    loadWorkspaceContext: async () => createWorkspace(),
    now: new Date('2026-08-08T23:59:59.000Z'),
  });

  const result = await loadUsagePageData('7d');

  assert.equal(result.kind, 'authenticated');
  if (result.kind !== 'authenticated') {
    return;
  }

  assert.equal(result.analytics.sessionCount, 1001);
  assert.equal(result.analytics.latency?.p95Seconds, 1);

  const conversationCalls = stub.calls.filter(
    (call) => call.table === 'conversations',
  );
  assert.equal(conversationCalls.length, 2);
  assert.deepEqual(
    conversationCalls.map((call) => call.range),
    [
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ],
  );
});
