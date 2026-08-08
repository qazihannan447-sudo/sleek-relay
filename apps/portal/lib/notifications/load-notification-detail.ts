import { createServerSupabaseClient } from '../supabase/server';
import { loadWorkspaceContext } from '../dashboard/load-workspace-context';
import { resolveDisplayTimezone } from '../format-timestamp';
import { isConversationUuid } from '../conversations/helpers';
import {
  formatNotificationChannelLabel,
  formatNotificationKindLabel,
  formatNotificationStatusLabel,
} from './helpers';

type NotificationDetailRow = {
  agent_id: string;
  body: string;
  channel: string;
  conversation_id: string;
  created_at: string;
  destination: string | null;
  error_message: string | null;
  id: string;
  kind: string;
  provider: string | null;
  status: string;
  subject: string | null;
};

type ConversationDetailFields = {
  outcome: string | null;
  summary: string | null;
};

type AgentNameRow = {
  name: string;
};

type BusinessTimezoneRow = {
  timezone: string | null;
};

type NotificationDetailLoaderDeps = {
  createServerSupabaseClient: typeof createServerSupabaseClient;
  loadWorkspaceContext: typeof loadWorkspaceContext;
};

export type NotificationDetailPageData =
  | {
      agentName: string;
      body: string;
      channel: string;
      channelLabel: string;
      conversationId: string;
      createdAt: string;
      destination: string;
      email: string;
      errorMessage: string | null;
      id: string;
      kind: 'authenticated';
      kindLabel: string;
      membershipRole: string;
      notificationKind: string;
      outcome: string | null;
      provider: string | null;
      status: string;
      statusLabel: string;
      subject: string | null;
      summary: string | null;
      tenantName: string;
      timezone: string;
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
      kind: 'not-found';
    }
  | {
      kind: 'unauthenticated';
    };

export function createNotificationDetailLoader(
  deps: NotificationDetailLoaderDeps,
) {
  return async function loadNotificationDetailPageData(
    notificationId: string,
  ): Promise<NotificationDetailPageData> {
    if (!isConversationUuid(notificationId)) {
      return { kind: 'not-found' };
    }

    const workspace = await deps.loadWorkspaceContext();

    if (workspace.kind !== 'authenticated') {
      return workspace;
    }

    try {
      const supabase = await deps.createServerSupabaseClient();
      const { data: notificationData, error: notificationError } = await supabase
        .from('conversation_notifications')
        .select(
          'id, agent_id, conversation_id, kind, channel, status, destination, subject, body, provider, error_message, created_at',
        )
        .eq('tenant_id', workspace.tenantId)
        .eq('id', notificationId)
        .maybeSingle();

      if (notificationError) {
        return {
          email: workspace.email,
          kind: 'error',
          message: 'Unable to load this notification right now.',
        };
      }

      if (!notificationData) {
        return { kind: 'not-found' };
      }

      const notification = notificationData as NotificationDetailRow;

      const [{ data: conversationData }, { data: agentData }, { data: businessData }] =
        await Promise.all([
          supabase
            .from('conversations')
            .select('outcome, summary')
            .eq('tenant_id', workspace.tenantId)
            .eq('id', notification.conversation_id)
            .maybeSingle(),
          supabase
            .from('agents')
            .select('name')
            .eq('tenant_id', workspace.tenantId)
            .eq('id', notification.agent_id)
            .maybeSingle(),
          supabase
            .from('business_configurations')
            .select('timezone')
            .eq('tenant_id', workspace.tenantId)
            .maybeSingle(),
        ]);

      const conversation = (conversationData ??
        null) as ConversationDetailFields | null;
      const agent = (agentData ?? null) as AgentNameRow | null;
      const business = (businessData ?? null) as BusinessTimezoneRow | null;
      const timezone = resolveDisplayTimezone(business?.timezone);

      return {
        agentName: agent?.name?.trim() || 'Unavailable agent',
        body: notification.body,
        channel: notification.channel,
        channelLabel: formatNotificationChannelLabel(notification.channel),
        conversationId: notification.conversation_id,
        createdAt: notification.created_at,
        destination: notification.destination?.trim() || '—',
        email: workspace.email,
        errorMessage: notification.error_message?.trim() || null,
        id: notification.id,
        kind: 'authenticated',
        kindLabel: formatNotificationKindLabel(notification.kind),
        membershipRole: workspace.membershipRole,
        notificationKind: notification.kind,
        outcome: conversation?.outcome?.trim() || null,
        provider: notification.provider,
        status: notification.status,
        statusLabel: formatNotificationStatusLabel(notification.status),
        subject: notification.subject?.trim() || null,
        summary: conversation?.summary?.trim() || null,
        tenantName: workspace.tenantName,
        timezone,
      };
    } catch {
      return {
        email: workspace.email,
        kind: 'error',
        message: 'Unable to load this notification right now.',
      };
    }
  };
}

export const loadNotificationDetailPageData = createNotificationDetailLoader({
  createServerSupabaseClient,
  loadWorkspaceContext,
});
