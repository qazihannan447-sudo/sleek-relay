import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import type { ConversationAgentOption } from '../conversations/helpers';
import {
  buildNotificationPagination,
  formatNotificationChannelLabel,
  formatNotificationKindLabel,
  formatNotificationStatusLabel,
  hasActiveNotificationFilters,
  normalizeNotificationFilters,
  selectNotificationEmptyState,
  truncateNotificationBody,
  type NotificationFilterInput,
  type NormalizedNotificationFilters,
} from './helpers';
import type {
  ConversationEmptyState,
  ConversationPagination,
} from '../conversations/helpers';

type NotificationAgentRow = {
  id: string;
  name: string;
};

type NotificationRow = {
  agent_id: string;
  body: string;
  channel: string;
  conversation_id: string;
  created_at: string;
  destination: string | null;
  id: string;
  kind: string;
  status: string;
};

type NotificationsPageLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
};

export type NotificationListItem = {
  agentId: string;
  agentName: string;
  bodyPreview: string;
  channel: string;
  channelLabel: string;
  conversationId: string;
  createdAt: string;
  destination: string;
  id: string;
  kind: string;
  kindLabel: string;
  status: string;
  statusLabel: string;
};

export type NotificationsPageData =
  | {
      agents: ConversationAgentOption[];
      email: string;
      emptyState: ConversationEmptyState;
      filters: NormalizedNotificationFilters;
      kind: 'authenticated';
      membershipRole: string;
      notifications: NotificationListItem[];
      pagination: ConversationPagination;
      tenantName: string;
      totalNotificationCount: number;
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

function applyNotificationFilters<TQuery>(
  query: TQuery,
  filters: NormalizedNotificationFilters,
) {
  let filteredQuery = query as TQuery & {
    eq: (_column: string, _value: unknown) => typeof filteredQuery;
    gte: (_column: string, _value: string) => typeof filteredQuery;
    lt: (_column: string, _value: string) => typeof filteredQuery;
  };

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

export function createNotificationsPageDataLoader(
  deps: NotificationsPageLoaderDeps,
) {
  return async function loadNotificationsPageData(
    input: NotificationFilterInput = {},
  ): Promise<NotificationsPageData> {
    const workspace = await deps.loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    try {
      const supabase = await deps.createServerSupabaseClient();
      const { data: agentsData, error: agentsError } = await supabase
        .from('agents')
        .select('id, name')
        .eq('tenant_id', workspace.tenantId)
        .order('name', { ascending: true });

      if (agentsError) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant agents for notification filters.',
        };
      }

      const agents = ((agentsData ?? []) as NotificationAgentRow[]).map(
        (agent) => ({
          id: agent.id,
          name: agent.name,
        }),
      );
      const filters = normalizeNotificationFilters(input, agents);
      const hasFilters = hasActiveNotificationFilters(filters);

      const filteredCountResult = await applyNotificationFilters(
        supabase
          .from('conversation_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId),
        filters,
      );

      if (filteredCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load notification counts for your tenant.',
        };
      }

      const totalCountResult = hasFilters
        ? await supabase
            .from('conversation_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', workspace.tenantId)
        : filteredCountResult;

      if (totalCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load notification totals for your tenant.',
        };
      }

      const filteredCount = filteredCountResult.count ?? 0;
      const totalNotificationCount = totalCountResult.count ?? 0;
      const pagination = buildNotificationPagination({
        page: filters.page,
        totalCount: filteredCount,
      });

      const listResult = await applyNotificationFilters(
        supabase
          .from('conversation_notifications')
          .select(
            'id, agent_id, conversation_id, kind, channel, status, destination, body, created_at',
          )
          .eq('tenant_id', workspace.tenantId)
          .order('created_at', { ascending: false })
          .range(pagination.startIndex - 1, pagination.endIndex - 1),
        filters,
      );

      if (listResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load notifications for your tenant.',
        };
      }

      const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));
      const notifications = ((listResult.data ?? []) as NotificationRow[]).map(
        (row) => ({
          agentId: row.agent_id,
          agentName: formatAgentName(row.agent_id, agentMap),
          bodyPreview: truncateNotificationBody(row.body),
          channel: row.channel,
          channelLabel: formatNotificationChannelLabel(row.channel),
          conversationId: row.conversation_id,
          createdAt: row.created_at,
          destination: row.destination?.trim() || '—',
          id: row.id,
          kind: row.kind,
          kindLabel: formatNotificationKindLabel(row.kind),
          status: row.status,
          statusLabel: formatNotificationStatusLabel(row.status),
        }),
      );

      return {
        agents,
        email: workspace.email,
        emptyState: selectNotificationEmptyState({
          hasFilters,
          resultCount: notifications.length,
          totalCount: totalNotificationCount,
        }),
        filters,
        kind: 'authenticated',
        membershipRole: workspace.membershipRole,
        notifications,
        pagination,
        tenantName: workspace.tenantName,
        totalNotificationCount,
      };
    } catch {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load the notifications workspace right now.',
      };
    }
  };
}

export const loadNotificationsPageData = createNotificationsPageDataLoader({
  createServerSupabaseClient,
  loadWorkspaceContext,
});
