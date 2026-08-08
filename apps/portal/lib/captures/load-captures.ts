import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import { resolveDisplayTimezone } from '../format-timestamp';
import type { ConversationAgentOption } from '../conversations/helpers';
import {
  buildCapturePagination,
  CAPTURE_PAGE_SIZE,
  formatCaptureStatusLabel,
  formatCaptureTypeLabel,
  hasActiveCaptureFilters,
  normalizeCaptureFilters,
  selectCaptureEmptyState,
  summarizeCapturePayload,
  type CaptureFilterInput,
  type NormalizedCaptureFilters,
} from './helpers';
import type { ConversationEmptyState, ConversationPagination } from '../conversations/helpers';

type CaptureAgentRow = {
  id: string;
  name: string;
};

type BusinessTimezoneRow = {
  timezone: string | null;
};

type CaptureRow = {
  agent_id: string;
  capture_type: string;
  conversation_id: string;
  created_at: string;
  id: string;
  payload: unknown;
  status: string;
};

type CapturesPageLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
};

export type CaptureListItem = {
  agentId: string;
  agentName: string;
  captureType: string;
  captureTypeLabel: string;
  contactSummary: string;
  conversationId: string;
  createdAt: string;
  id: string;
  primarySummary: string;
  status: string;
  statusLabel: string;
};

export type CapturesPageData =
  | {
      agents: ConversationAgentOption[];
      captures: CaptureListItem[];
      email: string;
      emptyState: ConversationEmptyState;
      filters: NormalizedCaptureFilters;
      kind: 'authenticated';
      membershipRole: string;
      pagination: ConversationPagination;
      tenantName: string;
      timezone: string;
      totalCaptureCount: number;
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

function formatAgentName(agentId: string, agentMap: Map<string, string>): string {
  return agentMap.get(agentId) ?? 'Unavailable agent';
}

function applyCaptureFilters<TQuery>(
  query: TQuery,
  filters: NormalizedCaptureFilters,
) {
  let filteredQuery = query as TQuery & {
    eq: (_column: string, _value: unknown) => typeof filteredQuery;
    gte: (_column: string, _value: string) => typeof filteredQuery;
    lt: (_column: string, _value: string) => typeof filteredQuery;
  };

  if (filters.type) {
    filteredQuery = filteredQuery.eq('capture_type', filters.type);
  }

  if (filters.agentId) {
    filteredQuery = filteredQuery.eq('agent_id', filters.agentId);
  }

  if (filters.fromTimestamp) {
    filteredQuery = filteredQuery.gte('created_at', filters.fromTimestamp);
  }

  if (filters.toExclusiveTimestamp) {
    filteredQuery = filteredQuery.lt('created_at', filters.toExclusiveTimestamp);
  }

  return filteredQuery;
}

export function createCapturesPageDataLoader(deps: CapturesPageLoaderDeps) {
  return async function loadCapturesPageData(
    input: CaptureFilterInput = {},
  ): Promise<CapturesPageData> {
    const workspace = await deps.loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    try {
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
          message: 'Unable to load tenant agents for capture filters.',
        };
      }

      const agents = ((agentsResult.data ?? []) as CaptureAgentRow[]).map(
        (agent) => ({
          id: agent.id,
          name: agent.name,
        }),
      );
      const businessRows = (businessResult.data ?? []) as BusinessTimezoneRow[];
      const timezone = resolveDisplayTimezone(businessRows[0]?.timezone);
      const filters = normalizeCaptureFilters(input, agents);
      const hasFilters = hasActiveCaptureFilters(filters);

      const filteredCountResult = await applyCaptureFilters(
        supabase
          .from('conversation_captures')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId),
        filters,
      );

      if (filteredCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant captures through row-level security.',
        };
      }

      const filteredCaptureCount = filteredCountResult.count ?? 0;
      const pagination = buildCapturePagination({
        page: filters.page,
        pageSize: CAPTURE_PAGE_SIZE,
        totalCount: filteredCaptureCount,
      });

      let captures: CaptureListItem[] = [];

      if (pagination.totalCount > 0) {
        const filteredRowsQuery = applyCaptureFilters(
          supabase
            .from('conversation_captures')
            .select(
              'id, conversation_id, agent_id, capture_type, status, payload, created_at',
            )
            .eq('tenant_id', workspace.tenantId),
          filters,
        );
        const { data: rowsData, error: rowsError } = await filteredRowsQuery
          .order('created_at', { ascending: false })
          .range(
            (pagination.page - 1) * pagination.pageSize,
            pagination.page * pagination.pageSize - 1,
          );

        if (rowsError) {
          return {
            email: workspace.email,
            kind: 'error',
            message: 'Unable to load the filtered captures page.',
          };
        }

        const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));

        captures = ((rowsData ?? []) as CaptureRow[]).map((row) => {
          const summary = summarizeCapturePayload(row.payload);
          return {
            agentId: row.agent_id,
            agentName: formatAgentName(row.agent_id, agentMap),
            captureType: row.capture_type,
            captureTypeLabel: formatCaptureTypeLabel(row.capture_type),
            contactSummary: summary.contact,
            conversationId: row.conversation_id,
            createdAt: row.created_at,
            id: row.id,
            primarySummary: summary.primary,
            status: row.status,
            statusLabel: formatCaptureStatusLabel(row.status),
          };
        });
      }

      let totalCaptureCount = filteredCaptureCount;
      if (hasFilters && filteredCaptureCount === 0) {
        const { count, error } = await supabase
          .from('conversation_captures')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId);

        if (error) {
          return {
            email: workspace.email,
            kind: 'error',
            message: 'Unable to load tenant captures through row-level security.',
          };
        }
        totalCaptureCount = count ?? 0;
      }

      return {
        agents,
        captures,
        email: workspace.email,
        emptyState: selectCaptureEmptyState({
          hasActiveFilters: hasFilters,
          totalCount: totalCaptureCount,
          visibleCount: captures.length,
        }),
        filters: {
          ...filters,
          page: pagination.page,
        },
        kind: 'authenticated',
        membershipRole: workspace.membershipRole,
        pagination,
        tenantName: workspace.tenantName,
        timezone,
        totalCaptureCount,
      };
    } catch {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load captures right now. Please try again.',
      };
    }
  };
}

export const loadCapturesPageData = createCapturesPageDataLoader({
  createServerSupabaseClient,
  loadWorkspaceContext,
});
