import { cache } from 'react';

import {
  formatCaptureTypeLabel,
  summarizeCapturePayload,
} from '../captures/helpers';
import {
  conversationListStatuses,
  formatConversationOutcomeLabel,
  formatConversationStatusLabel,
  type ConversationStatus,
} from '../conversations/helpers';
import { resolveDisplayTimezone } from '../format-timestamp';
import { createServerSupabaseClient } from '../supabase/server';
import { resolveUsagePeriodBounds } from '../usage/period-bounds';
import {
  buildOverviewReadiness,
  buildOverviewUsageSnapshot,
  pickPrimaryTestAgentId,
  type OverviewReadinessItem,
  type OverviewUsageSnapshot,
} from './overview-readiness';
import { loadWorkspaceContext } from './load-workspace-context';

const RECENT_ACTIVITY_LIMIT = 5;
const USAGE_CONVERSATION_FETCH_LIMIT = 1000;

export type OverviewAgent = {
  id: string;
  language: string;
  name: string;
  role: string;
  status: string;
};

export type OverviewRecentConversation = {
  agentName: string;
  href: string;
  id: string;
  outcomeLabel: string;
  startedAt: string;
  status: ConversationStatus;
  statusLabel: string;
};

export type OverviewRecentCapture = {
  agentName: string;
  captureTypeLabel: string;
  href: string;
  id: string;
  primarySummary: string;
  createdAt: string;
};

export type OverviewData =
  | {
      activeAgentCount: number;
      agents: OverviewAgent[];
      approvedKnowledgeCount: number;
      businessName: string | null;
      email: string;
      kind: 'authenticated';
      membershipRole: string;
      notificationCount: number;
      pausedAgentCount: number;
      primaryTestAgentId: string | null;
      readiness: {
        completedCount: number;
        items: OverviewReadinessItem[];
        status: 'ready' | 'incomplete' | 'missing';
        totalCount: number;
      };
      recentCaptures: OverviewRecentCapture[];
      recentConversations: OverviewRecentConversation[];
      tenantName: string;
      tenantSlug: string;
      timezone: string;
      usage: OverviewUsageSnapshot;
    }
  | {
      email: string;
      kind: 'missing-membership';
    }
  | {
      email: string | null;
      kind: 'error';
      message: string;
    }
  | {
      kind: 'unauthenticated';
    };

type AgentRow = {
  id: string;
  language: string;
  name: string;
  role: string;
  status: string;
};

type BusinessRow = {
  business_hours: unknown;
  business_name: string;
  business_phone: string | null;
  contact_email: string | null;
  timezone: string | null;
};

type ConversationRow = {
  agent_id: string;
  duration_ms: number | null;
  ended_at: string | null;
  id: string;
  outcome: string | null;
  started_at: string;
  status: ConversationStatus;
};

type CaptureRow = {
  agent_id: string;
  capture_type: string;
  conversation_id: string;
  created_at: string;
  id: string;
  payload: unknown;
};

type OverviewLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
  now?: Date;
};

function buildFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unable to load your workspace right now. Please try again.';
}

export function createOverviewDataLoader(deps: OverviewLoaderDeps) {
  return async function loadOverviewData(): Promise<OverviewData> {
    try {
      const workspace = await deps.loadWorkspaceContext();

      if (workspace.kind !== 'authenticated') {
        return workspace;
      }

      const supabase = await deps.createServerSupabaseClient();
      const now = deps.now ?? new Date();
      const monthBounds = resolveUsagePeriodBounds('month', now);

      const [
        businessResult,
        agentsResult,
        knowledgeCountResult,
        recentConversationsResult,
        recentCapturesResult,
        notificationCountResult,
        usageConversationsResult,
      ] = await Promise.all([
        supabase
          .from('business_configurations')
          .select(
            'business_name, business_phone, contact_email, business_hours, timezone',
          )
          .eq('tenant_id', workspace.tenantId)
          .maybeSingle(),
        supabase
          .from('agents')
          .select('id, name, role, language, status')
          .eq('tenant_id', workspace.tenantId)
          .order('name', { ascending: true }),
        supabase
          .from('business_knowledge')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId)
          .eq('status', 'approved'),
        supabase
          .from('conversations')
          .select('id, agent_id, status, started_at, ended_at, duration_ms, outcome')
          .eq('tenant_id', workspace.tenantId)
          .in('status', [...conversationListStatuses])
          .order('started_at', { ascending: false })
          .limit(RECENT_ACTIVITY_LIMIT),
        supabase
          .from('conversation_captures')
          .select(
            'id, agent_id, conversation_id, capture_type, payload, created_at',
          )
          .eq('tenant_id', workspace.tenantId)
          .order('created_at', { ascending: false })
          .limit(RECENT_ACTIVITY_LIMIT),
        supabase
          .from('conversation_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', workspace.tenantId),
        supabase
          .from('conversations')
          .select('id, status, started_at, ended_at, duration_ms')
          .eq('tenant_id', workspace.tenantId)
          .gte('started_at', monthBounds.start.toISOString())
          .lte('started_at', monthBounds.end.toISOString())
          .in('status', [...conversationListStatuses])
          .order('started_at', { ascending: true })
          .limit(USAGE_CONVERSATION_FETCH_LIMIT),
      ]);

      if (businessResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load the business configuration for your workspace.',
        };
      }

      if (agentsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load agents for your workspace.',
        };
      }

      if (knowledgeCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load approved knowledge for your workspace.',
        };
      }

      if (recentConversationsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load recent conversations.',
        };
      }

      if (recentCapturesResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load recent captures.',
        };
      }

      if (notificationCountResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load notifications for your workspace.',
        };
      }

      if (usageConversationsResult.error) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load usage totals for your workspace.',
        };
      }

      const business = businessResult.data as BusinessRow | null;
      const agents = (agentsResult.data ?? []) as AgentRow[];
      const agentNameById = new Map(
        agents.map((agent) => [agent.id, agent.name] as const),
      );

      // Resolve agent names for captures/conversations that may reference
      // agents outside the currently loaded set (should be rare).
      const missingAgentIds = new Set<string>();
      for (const row of (recentConversationsResult.data ??
        []) as ConversationRow[]) {
        if (!agentNameById.has(row.agent_id)) {
          missingAgentIds.add(row.agent_id);
        }
      }
      for (const row of (recentCapturesResult.data ?? []) as CaptureRow[]) {
        if (!agentNameById.has(row.agent_id)) {
          missingAgentIds.add(row.agent_id);
        }
      }

      if (missingAgentIds.size > 0) {
        const missingAgentsResult = await supabase
          .from('agents')
          .select('id, name')
          .eq('tenant_id', workspace.tenantId)
          .in('id', [...missingAgentIds]);

        if (!missingAgentsResult.error) {
          for (const agent of (missingAgentsResult.data ?? []) as Array<{
            id: string;
            name: string;
          }>) {
            agentNameById.set(agent.id, agent.name);
          }
        }
      }

      const activeAgentCount = agents.filter(
        (agent) => agent.status === 'active',
      ).length;
      const pausedAgentCount = agents.filter(
        (agent) => agent.status === 'paused',
      ).length;
      const approvedKnowledgeCount = knowledgeCountResult.count ?? 0;

      const readiness = buildOverviewReadiness({
        activeAgentCount,
        approvedKnowledgeCount,
        business: business
          ? {
              businessHours: business.business_hours,
              businessName: business.business_name,
              businessPhone: business.business_phone,
              contactEmail: business.contact_email,
            }
          : null,
      });

      const recentConversations: OverviewRecentConversation[] = (
        (recentConversationsResult.data ?? []) as ConversationRow[]
      ).map((row) => ({
        agentName: agentNameById.get(row.agent_id) ?? 'Unavailable agent',
        href: `/dashboard/conversations?conversationId=${row.id}`,
        id: row.id,
        outcomeLabel: formatConversationOutcomeLabel(row.outcome),
        startedAt: row.started_at,
        status: row.status,
        statusLabel: formatConversationStatusLabel(row.status),
      }));

      const recentCaptures: OverviewRecentCapture[] = (
        (recentCapturesResult.data ?? []) as CaptureRow[]
      ).map((row) => {
        const summary = summarizeCapturePayload(row.payload);
        return {
          agentName: agentNameById.get(row.agent_id) ?? 'Unavailable agent',
          captureTypeLabel: formatCaptureTypeLabel(row.capture_type),
          createdAt: row.created_at,
          href: `/dashboard/captures?conversationId=${row.conversation_id}`,
          id: row.id,
          primarySummary: summary.primary,
        };
      });

      const usage = buildOverviewUsageSnapshot(
        ((usageConversationsResult.data ?? []) as Array<{
          duration_ms: number | null;
          ended_at: string | null;
          started_at: string;
          status: string;
        }>).map((row) => ({
          durationMs: row.duration_ms,
          endedAt: row.ended_at,
          startedAt: row.started_at,
          status: row.status,
        })),
        { now },
      );

      return {
        activeAgentCount,
        agents,
        approvedKnowledgeCount,
        businessName: business?.business_name ?? null,
        email: workspace.email,
        kind: 'authenticated',
        membershipRole: workspace.membershipRole,
        notificationCount: notificationCountResult.count ?? 0,
        pausedAgentCount,
        primaryTestAgentId: pickPrimaryTestAgentId(agents),
        readiness,
        recentCaptures,
        recentConversations,
        tenantName: workspace.tenantName,
        tenantSlug: workspace.tenantSlug,
        timezone: resolveDisplayTimezone(business?.timezone),
        usage,
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

export const loadOverviewData = cache(
  createOverviewDataLoader({
    createServerSupabaseClient,
    loadWorkspaceContext,
  }),
);
