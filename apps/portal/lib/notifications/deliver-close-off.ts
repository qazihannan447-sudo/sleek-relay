import type { SupabaseClient } from '@supabase/supabase-js';

export type CloseOffNotificationChannel = 'inbox';
export type CloseOffNotificationStatus = 'logged';

type ConversationNotificationContext = {
  agent_id: string;
  outcome: string | null;
  summary: string | null;
};

export type DeliverCloseOffNotificationArgs = {
  agentId?: string;
  conversationId: string;
  outcome?: string | null;
  portalBaseUrl?: string;
  summary?: string | null;
  supabase: SupabaseClient;
  tenantId: string;
};

export type DeliverCloseOffNotificationResult =
  | {
      created: false;
      reason: 'already_exists' | 'missing_conversation';
    }
  | {
      channel: CloseOffNotificationChannel;
      created: true;
      destination: string;
      id: string;
      status: CloseOffNotificationStatus;
    };

const INBOX_DESTINATION = 'Business inbox';

function resolvePortalBaseUrl(explicit?: string): string {
  const configured =
    explicit?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost) {
    return `https://${vercelHost.replace(/\/$/, '')}`;
  }

  return 'https://sleek-relay.vercel.app';
}

export function buildCloseOffNotificationBody(args: {
  conversationId: string;
  outcome?: string | null;
  portalBaseUrl?: string;
  summary?: string | null;
}): string {
  const lines = [
    'Sleek Relay — post-call notification',
    '',
    `Outcome: ${args.outcome?.trim() || 'Unavailable'}`,
    '',
    `Summary: ${args.summary?.trim() || 'Summary is not available yet.'}`,
    '',
    `Review: ${resolvePortalBaseUrl(args.portalBaseUrl)}/dashboard/conversations?conversationId=${args.conversationId}`,
  ];

  return lines.join('\n');
}

export async function deliverCloseOffNotification(
  args: DeliverCloseOffNotificationArgs,
): Promise<DeliverCloseOffNotificationResult> {
  const { data: existing, error: existingError } = await args.supabase
    .from('conversation_notifications')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .maybeSingle();

  if (existingError) {
    throw new Error('Unable to check existing close-off notifications.');
  }

  if (existing) {
    return {
      created: false,
      reason: 'already_exists',
    };
  }

  let agentId = args.agentId;
  let outcome = args.outcome;
  let summary = args.summary;

  if (!agentId || outcome === undefined || summary === undefined) {
    const { data: conversation, error: conversationError } = await args.supabase
      .from('conversations')
      .select('agent_id, outcome, summary')
      .eq('tenant_id', args.tenantId)
      .eq('id', args.conversationId)
      .maybeSingle();

    if (conversationError || !conversation) {
      return {
        created: false,
        reason: 'missing_conversation',
      };
    }

    const row = conversation as ConversationNotificationContext;
    agentId = agentId ?? row.agent_id;
    outcome = outcome === undefined ? row.outcome : outcome;
    summary = summary === undefined ? row.summary : summary;
  }

  if (!agentId) {
    return {
      created: false,
      reason: 'missing_conversation',
    };
  }

  const body = buildCloseOffNotificationBody({
    conversationId: args.conversationId,
    outcome,
    portalBaseUrl: args.portalBaseUrl,
    summary,
  });

  const { data: inserted, error: insertError } = await args.supabase
    .from('conversation_notifications')
    .insert({
      agent_id: agentId,
      body,
      channel: 'inbox',
      conversation_id: args.conversationId,
      destination: INBOX_DESTINATION,
      error_message: null,
      kind: 'close_off',
      provider: 'demo_log',
      provider_message_id: null,
      status: 'logged',
      subject: null,
      tenant_id: args.tenantId,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    if (insertError.code === '23505') {
      return {
        created: false,
        reason: 'already_exists',
      };
    }
    throw new Error('Unable to persist the close-off notification.');
  }

  if (!inserted?.id) {
    throw new Error('Unable to persist the close-off notification.');
  }

  return {
    channel: 'inbox',
    created: true,
    destination: INBOX_DESTINATION,
    id: inserted.id as string,
    status: 'logged',
  };
}
