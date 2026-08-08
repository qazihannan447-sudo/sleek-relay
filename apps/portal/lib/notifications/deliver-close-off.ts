import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadGreenApiConfigFromEnv,
  normalizeWhatsAppChatId,
  sendGreenApiWhatsAppMessage,
  type GreenApiConfig,
} from './green-api';

export type CloseOffNotificationChannel = 'whatsapp' | 'email';
export type CloseOffNotificationStatus = 'sent' | 'failed' | 'logged';

type BusinessNotificationDestinations = {
  notification_email: string | null;
  notification_whatsapp: string | null;
};

type ConversationNotificationContext = {
  agent_id: string;
  outcome: string | null;
  summary: string | null;
};

export type DeliverCloseOffNotificationArgs = {
  agentId?: string;
  conversationId: string;
  fetchImpl?: typeof fetch;
  greenApiConfig?: GreenApiConfig | null;
  outcome?: string | null;
  portalBaseUrl?: string;
  summary?: string | null;
  supabase: SupabaseClient;
  tenantId: string;
};

export type DeliverCloseOffNotificationResult =
  | {
      created: false;
      reason: 'already_exists' | 'no_destination' | 'missing_conversation';
    }
  | {
      channel: CloseOffNotificationChannel;
      created: true;
      destination: string;
      id: string;
      status: CloseOffNotificationStatus;
    };

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

export function chooseCloseOffDestination(args: {
  notificationEmail: string | null | undefined;
  notificationWhatsapp: string | null | undefined;
}): {
  channel: CloseOffNotificationChannel;
  destination: string;
} | null {
  const whatsapp = args.notificationWhatsapp?.trim();
  if (whatsapp) {
    return {
      channel: 'whatsapp',
      destination: whatsapp,
    };
  }

  const email = args.notificationEmail?.trim();
  if (email) {
    return {
      channel: 'email',
      destination: email,
    };
  }

  return null;
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

  const { data: business, error: businessError } = await args.supabase
    .from('business_configurations')
    .select('notification_email, notification_whatsapp')
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (businessError) {
    throw new Error('Unable to load notification destinations.');
  }

  const destinations = (business ?? {
    notification_email: null,
    notification_whatsapp: null,
  }) as BusinessNotificationDestinations;

  const chosen = chooseCloseOffDestination({
    notificationEmail: destinations.notification_email,
    notificationWhatsapp: destinations.notification_whatsapp,
  });

  if (!chosen) {
    return {
      created: false,
      reason: 'no_destination',
    };
  }

  const body = buildCloseOffNotificationBody({
    conversationId: args.conversationId,
    outcome,
    portalBaseUrl: args.portalBaseUrl,
    summary,
  });

  let status: CloseOffNotificationStatus = 'logged';
  let provider: string | null = null;
  let providerMessageId: string | null = null;
  let errorMessage: string | null = null;

  if (chosen.channel === 'whatsapp') {
    const greenApiConfig =
      args.greenApiConfig === undefined
        ? loadGreenApiConfigFromEnv()
        : args.greenApiConfig;
    const chatId = normalizeWhatsAppChatId(chosen.destination);

    if (greenApiConfig && chatId) {
      provider = 'green_api';
      const sendResult = await sendGreenApiWhatsAppMessage({
        chatId,
        config: greenApiConfig,
        fetchImpl: args.fetchImpl,
        message: body,
      });

      if (sendResult.ok) {
        status = 'sent';
        providerMessageId = sendResult.messageId;
      } else {
        status = 'failed';
        errorMessage = sendResult.errorMessage;
      }
    } else if (greenApiConfig && !chatId) {
      provider = 'green_api';
      status = 'failed';
      errorMessage = 'WhatsApp destination is not a valid phone number.';
    } else {
      provider = 'demo_log';
      status = 'logged';
    }
  } else {
    // Email outbound is not wired in the demo (domain verification required).
    provider = 'demo_log';
    status = 'logged';
  }

  const { data: inserted, error: insertError } = await args.supabase
    .from('conversation_notifications')
    .insert({
      agent_id: agentId,
      body,
      channel: chosen.channel,
      conversation_id: args.conversationId,
      destination: chosen.destination,
      error_message: errorMessage,
      kind: 'close_off',
      provider,
      provider_message_id: providerMessageId,
      status,
      subject:
        chosen.channel === 'email'
          ? 'Sleek Relay post-call notification'
          : null,
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
    channel: chosen.channel,
    created: true,
    destination: chosen.destination,
    id: inserted.id as string,
    status,
  };
}
