import type { SupabaseClient } from '@supabase/supabase-js';

import {
  loadResendConfigFromEnv,
  sendResendEmail,
  type ResendConfig,
} from './resend';

export type CloseOffNotificationChannel = 'inbox' | 'email';
export type CloseOffNotificationStatus = 'logged' | 'sent' | 'failed';

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
  resendConfig?: ResendConfig | null;
  sendEmail?: typeof sendResendEmail;
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
      email?: {
        channel: 'email';
        destination: string;
        id: string;
        status: 'sent' | 'failed';
      };
      id: string;
      status: CloseOffNotificationStatus;
    };

const INBOX_DESTINATION = 'Business inbox';
const EMAIL_SUBJECT = 'Sleek Relay — post-call notification';

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

export function buildCloseOffNotificationHtml(body: string): string {
  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withBreaks = escaped.replace(/\n/g, '<br />');
  return `<p style="font-family: sans-serif; white-space: pre-wrap;">${withBreaks}</p>`;
}

async function insertNotificationRow(args: {
  agentId: string;
  body: string;
  channel: CloseOffNotificationChannel;
  conversationId: string;
  destination: string;
  errorMessage?: string | null;
  provider: string;
  providerMessageId?: string | null;
  status: CloseOffNotificationStatus;
  subject?: string | null;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<{ id: string } | { duplicate: true } | null> {
  const { data: inserted, error: insertError } = await args.supabase
    .from('conversation_notifications')
    .insert({
      agent_id: args.agentId,
      body: args.body,
      channel: args.channel,
      conversation_id: args.conversationId,
      destination: args.destination,
      error_message: args.errorMessage ?? null,
      kind: 'close_off',
      provider: args.provider,
      provider_message_id: args.providerMessageId ?? null,
      status: args.status,
      subject: args.subject ?? null,
      tenant_id: args.tenantId,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    if (insertError.code === '23505') {
      return { duplicate: true };
    }
    throw new Error('Unable to persist the close-off notification.');
  }

  if (!inserted?.id) {
    throw new Error('Unable to persist the close-off notification.');
  }

  return { id: inserted.id as string };
}

export async function deliverCloseOffNotification(
  args: DeliverCloseOffNotificationArgs,
): Promise<DeliverCloseOffNotificationResult> {
  const { data: existingInbox, error: existingError } = await args.supabase
    .from('conversation_notifications')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .eq('channel', 'inbox')
    .maybeSingle();

  if (existingError) {
    throw new Error('Unable to check existing close-off notifications.');
  }

  if (existingInbox) {
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

  const inboxInsert = await insertNotificationRow({
    agentId,
    body,
    channel: 'inbox',
    conversationId: args.conversationId,
    destination: INBOX_DESTINATION,
    provider: 'demo_log',
    status: 'logged',
    supabase: args.supabase,
    tenantId: args.tenantId,
  });

  if (!inboxInsert || 'duplicate' in inboxInsert) {
    return {
      created: false,
      reason: 'already_exists',
    };
  }

  const result: Extract<
    DeliverCloseOffNotificationResult,
    { created: true }
  > = {
    channel: 'inbox',
    created: true,
    destination: INBOX_DESTINATION,
    id: inboxInsert.id,
    status: 'logged',
  };

  const { data: businessConfig, error: businessConfigError } =
    await args.supabase
      .from('business_configurations')
      .select('notification_email')
      .eq('tenant_id', args.tenantId)
      .maybeSingle();

  if (businessConfigError) {
    return result;
  }

  const notificationEmail =
    typeof businessConfig?.notification_email === 'string'
      ? businessConfig.notification_email.trim()
      : '';

  if (!notificationEmail) {
    return result;
  }

  const resendConfig =
    args.resendConfig === undefined
      ? loadResendConfigFromEnv()
      : args.resendConfig;

  if (!resendConfig) {
    return result;
  }

  const sendEmail = args.sendEmail ?? sendResendEmail;
  let emailStatus: 'sent' | 'failed' = 'sent';
  let providerMessageId: string | null = null;
  let errorMessage: string | null = null;

  try {
    const sendResult = await sendEmail({
      config: resendConfig,
      html: buildCloseOffNotificationHtml(body),
      subject: EMAIL_SUBJECT,
      text: body,
      to: notificationEmail,
    });

    if (sendResult.ok) {
      providerMessageId = sendResult.messageId;
    } else {
      emailStatus = 'failed';
      errorMessage = sendResult.errorMessage;
    }
  } catch (error) {
    emailStatus = 'failed';
    errorMessage =
      error instanceof Error
        ? error.message
        : 'Unable to send the close-off email.';
  }

  try {
    const emailInsert = await insertNotificationRow({
      agentId,
      body,
      channel: 'email',
      conversationId: args.conversationId,
      destination: notificationEmail,
      errorMessage,
      provider: 'resend',
      providerMessageId,
      status: emailStatus,
      subject: EMAIL_SUBJECT,
      supabase: args.supabase,
      tenantId: args.tenantId,
    });

    if (emailInsert && !('duplicate' in emailInsert)) {
      result.email = {
        channel: 'email',
        destination: notificationEmail,
        id: emailInsert.id,
        status: emailStatus,
      };
    }
  } catch {
    // Email persistence failures must not fail conversation finalization.
  }

  return result;
}
