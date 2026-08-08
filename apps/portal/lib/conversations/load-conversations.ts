import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import { resolveDisplayTimezone } from '../format-timestamp';
import {
  buildConversationPagination,
  CONVERSATION_PAGE_SIZE,
  conversationListStatuses,
  formatConversationSourceLabel,
  formatConversationStatusLabel,
  hasActiveConversationFilters,
  normalizeConversationFilters,
  selectConversationEmptyState,
  type ConversationAgentOption,
  type ConversationEmptyState,
  type ConversationFilterInput,
  type ConversationPagination,
  type ConversationStatus,
} from './helpers';
import { reconcileStaleConversations } from './reconcile-stale-conversations';
import {
  buildConversationUsageCostEstimate,
  formatCadAmount,
} from './usage-cost';

type ConversationAgentRow = {
  id: string;
  name: string;
};

type BusinessTimezoneRow = {
  timezone: string | null;
};

type ConversationRow = {
  agent_id: string;
  duration_ms: number | null;
  end_reason: string | null;
  ended_at: string | null;
  id: string;
  outcome: string | null;
  source: string;
  started_at: string;
  status: ConversationStatus;
};

type ConversationsPageLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  reconcileStaleConversations: typeof reconcileStaleConversations;
};

export type ConversationListItem = {
  agentId: string;
  agentName: string;
  durationMs: number | null;
  endReason: string | null;
  endedAt: string | null;
  estimatedCostLabel: string;
  id: string;
  outcome: string | null;
  source: string;
  sourceLabel: string;
  startedAt: string;
  status: ConversationStatus;
  statusLabel: string;
};

export type ConversationsPageData =
  | {
      agents: ConversationAgentOption[];
      conversations: ConversationListItem[];
      email: string;
      emptyState: ConversationEmptyState;
      filters: ReturnType<typeof normalizeConversationFilters>;
      kind: 'authenticated';
      membershipRole: string;
      pagination: ConversationPagination;
      tenantName: string;
      tenantSlug: string;
      timezone: string;
      totalConversationCount: number;
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      kind: 'unauthenticated';
    };

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load tenant conversations right now. Please try again.';
}

function formatAgentName(agentId: string, agentMap: Map<string, string>): string {
  return agentMap.get(agentId) ?? 'Unavailable agent';
}

function applyConversationFilters<TQuery>(
  query: TQuery,
  filters: ReturnType<typeof normalizeConversationFilters>,
) {
  let filteredQuery = query as TQuery & {
    eq: (_column: string, _value: unknown) => typeof filteredQuery;
    gte: (_column: string, _value: string) => typeof filteredQuery;
    in: (_column: string, _value: readonly string[]) => typeof filteredQuery;
    lt: (_column: string, _value: string) => typeof filteredQuery;
  };

  // Conversations tab only lists finished sessions.
  if (filters.status) {
    filteredQuery = filteredQuery.eq('status', filters.status);
  } else {
    filteredQuery = filteredQuery.in('status', conversationListStatuses);
  }

  if (filters.agentId) {
    filteredQuery = filteredQuery.eq('agent_id', filters.agentId);
  }

  if (filters.source) {
    filteredQuery = filteredQuery.eq('source', filters.source);
  }

  if (filters.fromTimestamp) {
    filteredQuery = filteredQuery.gte('started_at', filters.fromTimestamp);
  }

  if (filters.toExclusiveTimestamp) {
    filteredQuery = filteredQuery.lt('started_at', filters.toExclusiveTimestamp);
  }

  return filteredQuery;
}

export function createConversationsPageDataLoader(
  deps: ConversationsPageLoaderDeps,
) {
  return async function loadConversationsPageData(
    input: ConversationFilterInput,
  ): Promise<ConversationsPageData> {
    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind !== 'authenticated') {
        return workspace;
      }

      await deps.reconcileStaleConversations({
        tenantId: workspace.tenantId,
      });

      const supabase = await deps.createServerSupabaseClient();
      const [agentsResult, businessResult] = await Promise.all([
        supabase
          .from('agents')
          .select('id, name')
          .eq('tenant_id', workspace.tenantId)
          .order('name', { ascending: true }),
        supabase
          .from('business_configurations')
          .select('timezone')
          .eq('tenant_id', workspace.tenantId),
      ]);

      if (agentsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant agents for the conversation filters.',
        };
      }

      const agents = ((agentsResult.data ?? []) as ConversationAgentRow[]).map(
        (agent) => ({
          id: agent.id,
          name: agent.name,
        }),
      );
      const businessRows = (businessResult.data ?? []) as BusinessTimezoneRow[];
      const timezone = resolveDisplayTimezone(businessRows[0]?.timezone);
      const filters = normalizeConversationFilters(input, agents);
      const hasFilters = hasActiveConversationFilters(filters);

      const filteredCountResult = await applyConversationFilters(
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId),
        filters,
      );

      if (filteredCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant conversations through row-level security.',
        };
      }

      const filteredConversationCount = filteredCountResult.count ?? 0;
      const pagination = buildConversationPagination({
        page: filters.page,
        pageSize: CONVERSATION_PAGE_SIZE,
        totalCount: filteredConversationCount,
      });

      let conversations: ConversationListItem[] = [];

      if (pagination.totalCount > 0) {
        const filteredRowsQuery = applyConversationFilters(
          supabase
            .from('conversations')
            .select(
              'id, agent_id, source, status, started_at, ended_at, duration_ms, outcome, end_reason',
            )
            .eq('tenant_id', workspace.tenantId),
          filters,
        );
        const { data: rowsData, error: rowsError } = await filteredRowsQuery
          .order('started_at', { ascending: false })
          .range(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize - 1,
          );

        if (rowsError) {
          return {
            email: workspace.email,
            kind: 'error',
            message: 'Unable to load the filtered conversation page.',
          };
        }

        const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));

        conversations = ((rowsData ?? []) as ConversationRow[]).map((row) => {
          const usageCost = buildConversationUsageCostEstimate({
            durationMs: row.duration_ms,
            endedAt: row.ended_at,
            startedAt: row.started_at,
          });
          return {
            agentId: row.agent_id,
            agentName: formatAgentName(row.agent_id, agentMap),
            durationMs: row.duration_ms,
            endReason: row.end_reason,
            endedAt: row.ended_at,
            estimatedCostLabel: formatCadAmount(usageCost.estimatedTotalCad),
            id: row.id,
            outcome: row.outcome,
            source: row.source,
            sourceLabel: formatConversationSourceLabel(row.source),
            startedAt: row.started_at,
            status: row.status,
            statusLabel: formatConversationStatusLabel(row.status),
          };
        });
      }

      let totalConversationCount = filteredConversationCount;

      if (hasFilters && filteredConversationCount === 0) {
        const { count, error } = await supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId)
          .in('status', conversationListStatuses);

        if (error) {
          return {
            email: workspace.email,
            kind: 'error',
            message: 'Unable to load tenant conversations through row-level security.',
          };
        }

        totalConversationCount = count ?? 0;
      }

      return {
        agents,
        conversations,
        email: workspace.email,
        emptyState: selectConversationEmptyState({
          hasActiveFilters: hasFilters,
          totalConversationCount,
          visibleConversationCount: conversations.length,
        }),
        filters: {
          ...filters,
          page: pagination.page,
        },
        kind: 'authenticated',
        membershipRole: workspace.membershipRole,
        pagination,
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        timezone,
        totalConversationCount,
      };
    } catch (error) {
      return {
        email: null,
        kind: 'error',
        message: buildFailureMessage(error),
      };
    }
  };
}

export const loadConversationsPageData = createConversationsPageDataLoader({
  createServerSupabaseClient,
  loadWorkspaceContext,
  reconcileStaleConversations,
});
