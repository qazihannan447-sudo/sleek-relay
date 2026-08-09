import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import {
  buildUsageAnalytics,
  DEFAULT_TENANT_CONNECTED_MINUTE_CAP,
  type UsageAgentInput,
  type UsageConversationInput,
} from './build-analytics';
import { resolveUsagePeriodBounds } from './period-bounds';
import type { UsageAnalyticsView, UsagePeriodId } from './types';

const USAGE_CONVERSATION_FETCH_PAGE_SIZE = 1000;

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

type UsageAgentRow = {
  id: string;
  name: string;
};

type UsagePageLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now?: Date;
};

export type UsagePageData =
  | {
      analytics: UsageAnalyticsView;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      tenantName: string;
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

export function createUsagePageDataLoader(deps: UsagePageLoaderDeps) {
  return async function loadUsagePageData(
    periodId: UsagePeriodId,
  ): Promise<UsagePageData> {
    const workspace = await deps.loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    try {
      const supabase = await deps.createServerSupabaseClient();
      const now = deps.now ?? new Date();
      const bounds = resolveUsagePeriodBounds(periodId, now);

      const [agentsResult, conversationsResult] = await Promise.all([
        supabase
          .from('agents')
          .select('id, name')
          .eq('tenant_id', workspace.tenantId)
          .order('name', { ascending: true }),
        fetchUsageConversationRows({
          bounds,
          supabase,
          tenantId: workspace.tenantId,
        }),
      ]);

      if (agentsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant agents for usage analytics.',
        };
      }

      if (conversationsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load tenant conversations for usage analytics.',
        };
      }

      const agents: UsageAgentInput[] = (
        (agentsResult.data ?? []) as UsageAgentRow[]
      ).map((agent) => ({
        id: agent.id,
        name: agent.name,
      }));

      const conversations: UsageConversationInput[] = (
        (conversationsResult.data ?? []) as UsageConversationRow[]
      ).map((row) => ({
        agentId: row.agent_id,
        durationMs: row.duration_ms,
        endedAt: row.ended_at,
        id: row.id,
        latencyMetrics: row.latency_metrics,
        outcome: row.outcome,
        startedAt: row.started_at,
        status: row.status,
        usageMetrics: row.usage_metrics,
      }));

      return {
        analytics: buildUsageAnalytics({
          agents,
          capMinutes: DEFAULT_TENANT_CONNECTED_MINUTE_CAP,
          conversations,
          now,
          periodId,
        }),
        email: workspace.email,
        kind: 'authenticated',
        membershipRole: workspace.membershipRole,
        tenantName: workspace.tenantName,
      };
    } catch {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load usage analytics right now. Please try again.',
      };
    }
  };
}

async function fetchUsageConversationRows(args: {
  bounds: { end: Date; start: Date };
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  tenantId: string;
}): Promise<{ data: UsageConversationRow[] | null; error: unknown | null }> {
  const rows: UsageConversationRow[] = [];

  for (let offset = 0; ; offset += USAGE_CONVERSATION_FETCH_PAGE_SIZE) {
    const page = await args.supabase
      .from('conversations')
      .select(
        'id, agent_id, status, started_at, ended_at, duration_ms, outcome, latency_metrics, usage_metrics',
      )
      .eq('tenant_id', args.tenantId)
      .gte('started_at', args.bounds.start.toISOString())
      .lte('started_at', args.bounds.end.toISOString())
      .order('started_at', { ascending: true })
      .range(offset, offset + USAGE_CONVERSATION_FETCH_PAGE_SIZE - 1);

    if (page.error) {
      return { data: null, error: page.error };
    }

    const pageRows = (page.data ?? []) as UsageConversationRow[];
    rows.push(...pageRows);

    if (pageRows.length < USAGE_CONVERSATION_FETCH_PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

export const loadUsagePageData = createUsagePageDataLoader({
  createServerSupabaseClient,
  loadWorkspaceContext,
});
