import type { SupabaseClient } from '@supabase/supabase-js';

import {
  formatCapturePayloadFields,
  formatCaptureStatusLabel,
  formatCaptureTypeLabel,
} from '../captures/helpers';
import {
  loadResendConfigFromEnv,
  sendResendEmail,
  type ResendConfig,
} from './resend';

export type CloseOffNotificationChannel = 'email';
export type CloseOffNotificationStatus = 'sent' | 'failed';

export type CloseOffCaptureDigestItem = {
  capture_type: string;
  payload: unknown;
  status: string;
};

type ConversationNotificationContext = {
  agent_id: string;
  outcome: string | null;
  summary: string | null;
};

export type DeliverCloseOffNotificationArgs = {
  agentId?: string;
  conversationId: string;
  outcome?: string | null;
  resendConfig?: ResendConfig | null;
  sendEmail?: typeof sendResendEmail;
  summary?: string | null;
  supabase: SupabaseClient;
  tenantId: string;
};

export type DeliverCloseOffNotificationResult =
  | {
      created: false;
      reason:
        | 'already_exists'
        | 'missing_conversation'
        | 'missing_destination'
        | 'persist_failed';
    }
  | {
      channel: CloseOffNotificationChannel;
      created: true;
      destination: string;
      id: string;
      status: CloseOffNotificationStatus;
    };

const EMAIL_SUBJECT = 'Sleek Relay — post-call notification';

export function formatCloseOffCapturesSection(
  captures: CloseOffCaptureDigestItem[],
): string {
  if (captures.length === 0) {
    return ['Captures:', 'None recorded for this conversation.'].join('\n');
  }

  const blocks = captures.map((capture, index) => {
    const typeLabel = formatCaptureTypeLabel(capture.capture_type);
    const statusLabel = formatCaptureStatusLabel(capture.status);
    const fields = formatCapturePayloadFields(capture.payload);
    const fieldLines =
      fields.length > 0
        ? fields.map((field) => `  ${field.label}: ${field.value}`)
        : ['  No details recorded.'];

    return [`${index + 1}. ${typeLabel} (${statusLabel})`, ...fieldLines].join(
      '\n',
    );
  });

  return ['Captures:', ...blocks].join('\n');
}

export function buildCloseOffNotificationBody(args: {
  captures?: CloseOffCaptureDigestItem[];
  outcome?: string | null;
  summary?: string | null;
}): string {
  const lines = [
    'Sleek Relay — post-call notification',
    '',
    `Outcome: ${args.outcome?.trim() || 'Unavailable'}`,
    '',
    `Summary: ${args.summary?.trim() || 'Summary is not available yet.'}`,
    '',
    formatCloseOffCapturesSection(args.captures ?? []),
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

async function loadConversationCapturesForCloseOff(args: {
  conversationId: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<CloseOffCaptureDigestItem[]> {
  const { data, error } = await args.supabase
    .from('conversation_captures')
    .select('capture_type, status, payload')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return (data as CloseOffCaptureDigestItem[]).map((row) => ({
    capture_type: row.capture_type,
    payload: row.payload,
    status: row.status,
  }));
}

async function insertNotificationRow(args: {
  agentId: string;
  body: string;
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
      channel: 'email',
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
  const { data: existingEmail, error: existingError } = await args.supabase
    .from('conversation_notifications')
    .select('id')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .eq('channel', 'email')
    .maybeSingle();

  if (existingError) {
    return {
      created: false,
      reason: 'persist_failed',
    };
  }

  if (existingEmail) {
    return {
      created: false,
      reason: 'already_exists',
    };
  }

  // Remove legacy inbox close-off rows so email delivery is not blocked by
  // older unique indexes that allowed only one close-off per conversation.
  await args.supabase
    .from('conversation_notifications')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .eq('channel', 'inbox');

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

  const { data: businessConfig, error: businessConfigError } =
    await args.supabase
      .from('business_configurations')
      .select('notification_email')
      .eq('tenant_id', args.tenantId)
      .maybeSingle();

  if (businessConfigError) {
    return {
      created: false,
      reason: 'missing_destination',
    };
  }

  const notificationEmail =
    typeof businessConfig?.notification_email === 'string'
      ? businessConfig.notification_email.trim()
      : '';

  if (!notificationEmail) {
    return {
      created: false,
      reason: 'missing_destination',
    };
  }

  const captures = await loadConversationCapturesForCloseOff({
    conversationId: args.conversationId,
    supabase: args.supabase,
    tenantId: args.tenantId,
  });

  const body = buildCloseOffNotificationBody({
    captures,
    outcome,
    summary,
  });

  const resendConfig =
    args.resendConfig === undefined
      ? loadResendConfigFromEnv()
      : args.resendConfig;

  let emailStatus: CloseOffNotificationStatus = 'sent';
  let providerMessageId: string | null = null;
  let errorMessage: string | null = null;

  if (!resendConfig) {
    emailStatus = 'failed';
    errorMessage = 'Resend is not configured for this environment.';
  } else {
    const sendEmail = args.sendEmail ?? sendResendEmail;

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
  }

  try {
    const emailInsert = await insertNotificationRow({
      agentId,
      body,
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

    if (!emailInsert || 'duplicate' in emailInsert) {
      return {
        created: false,
        reason: 'already_exists',
      };
    }

    return {
      channel: 'email',
      created: true,
      destination: notificationEmail,
      id: emailInsert.id,
      status: emailStatus,
    };
  } catch {
    // Persistence failures must not fail conversation finalization.
    return {
      created: false,
      reason: 'persist_failed',
    };
  }
}
