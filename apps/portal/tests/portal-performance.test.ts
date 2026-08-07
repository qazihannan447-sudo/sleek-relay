import assert from 'node:assert/strict';
import test from 'node:test';

import { createConversationsPageDataLoader } from '../lib/conversations/load-conversations';

type QueryCall = {
  filters: Array<{ column: string; operator: 'eq' | 'gte' | 'lt'; value: unknown }>;
  range: { from: number; to: number } | null;
  selectColumns: string | null;
  selectOptions: { count?: 'exact'; head?: boolean } | undefined;
  table: string;
};

function createConversationsSupabaseStub(args: {
  agentRows?: Array<{ id: string; name: string }>;
  baseCount?: number;
  filteredCount: number;
  rows?: Array<{
    agent_id: string;
    duration_ms: number | null;
    end_reason: string | null;
    id: string;
    outcome: string | null;
    source: string;
    started_at: string;
    status: 'active' | 'cancelled' | 'completed' | 'failed' | 'starting';
  }>;
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

    if (call.selectOptions?.head) {
      const hasNonTenantFilter = call.filters.some(
        (filter) => filter.column !== 'tenant_id',
      );

      return {
        count: hasNonTenantFilter ? args.filteredCount : (args.baseCount ?? args.filteredCount),
        data: null,
        error: null,
      };
    }

    return {
      data: args.rows ?? [],
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
          selectOptions: undefined,
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
          lt(column: string, value: string) {
            call.filters.push({ column, operator: 'lt', value });
            return query;
          },
          order() {
            return query;
          },
          range(from: number, to: number) {
            call.range = { from, to };
            return query;
          },
          select(columns: string, options?: { count?: 'exact'; head?: boolean }) {
            call.selectColumns = columns;
            call.selectOptions = options;
            return query;
          },
          then<TResult1 = unknown, TResult2 = never>(
            onfulfilled?:
              | ((_value: {
                  count?: number;
                  data: unknown;
                  error: null;
                }) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?: ((_reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            calls.push({
              ...call,
              filters: [...call.filters],
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

test('conversations loader avoids the unfiltered fallback count when filtered results exist', async () => {
  const stub = createConversationsSupabaseStub({
    filteredCount: 2,
    rows: [
      {
        agent_id: 'agent-a',
        duration_ms: 1200,
        end_reason: 'completed',
        id: 'conversation-a',
        outcome: 'captured',
        source: 'browser_test',
        started_at: '2026-08-06T12:00:00.000Z',
        status: 'completed',
      },
    ],
  });

  const loadConversationsPageData = createConversationsPageDataLoader({
    createServerSupabaseClient: async () => stub.supabase as any,
    loadWorkspaceContext: async () => createWorkspace(),
  });

  const result = await loadConversationsPageData({
    status: 'completed',
  });

  assert.equal(result.kind, 'authenticated');
  if (result.kind === 'authenticated') {
    assert.equal(result.conversations.length, 1);
    assert.equal(result.filters.status, 'completed');
  }

  const conversationCalls = stub.calls.filter((call) => call.table === 'conversations');
  assert.equal(
    conversationCalls.every((call) =>
      call.filters.some(
        (filter) => filter.column === 'status' && filter.value === 'completed',
      ),
    ),
    true,
  );
  assert.equal(
    stub.calls.filter(
      (call) => call.table === 'conversations' && call.selectOptions?.head,
    ).length,
    1,
  );
  assert.equal(
    stub.calls.filter(
      (call) => call.table === 'conversations' && !call.selectOptions?.head,
    ).length,
    1,
  );
});

test('conversations loader falls back to one unfiltered count only for filtered-empty states', async () => {
  const stub = createConversationsSupabaseStub({
    baseCount: 9,
    filteredCount: 0,
  });

  const loadConversationsPageData = createConversationsPageDataLoader({
    createServerSupabaseClient: async () => stub.supabase as any,
    loadWorkspaceContext: async () => createWorkspace(),
  });

  const result = await loadConversationsPageData({
    status: 'failed',
  });

  assert.equal(result.kind, 'authenticated');

  if (result.kind === 'authenticated') {
    assert.equal(result.emptyState, 'filtered-empty');
  }

  assert.equal(
    stub.calls.filter(
      (call) => call.table === 'conversations' && call.selectOptions?.head,
    ).length,
    2,
  );
  assert.equal(
    stub.calls.filter(
      (call) => call.table === 'conversations' && !call.selectOptions?.head,
    ).length,
    0,
  );
});
