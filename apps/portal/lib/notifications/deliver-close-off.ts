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
export type CloseOffNotificationStatus = 'sent' | 'failed' | 'logged';

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
  notificationId?: string | null;
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
const MISSING_DESTINATION_LABEL = 'Not configured';

export function resolveCloseOffNotificationDestination(args: {
  contactEmail?: string | null;
  notificationEmail?: string | null;
}): string | null {
  const notificationEmail =
    typeof args.notificationEmail === 'string'
      ? args.notificationEmail.trim()
      : '';
  if (notificationEmail) {
    return notificationEmail;
  }

  const contactEmail =
    typeof args.contactEmail === 'string' ? args.contactEmail.trim() : '';
  return contactEmail || null;
}

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

async function resolveConversationContext(args: {
  agentId?: string;
  conversationId: string;
  outcome?: string | null;
  summary?: string | null;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<
  | { agentId: string; outcome: string | null; summary: string | null }
  | { reason: 'missing_conversation' }
> {
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
      return { reason: 'missing_conversation' };
    }

    const row = conversation as ConversationNotificationContext;
    agentId = agentId ?? row.agent_id;
    outcome = outcome === undefined ? row.outcome : outcome;
    summary = summary === undefined ? row.summary : summary;
  }

  if (!agentId) {
    return { reason: 'missing_conversation' };
  }

  return {
    agentId,
    outcome: outcome ?? null,
    summary: summary ?? null,
  };
}

async function resolveDestination(args: {
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<string | null | { reason: 'persist_failed' }> {
  const { data: businessConfig, error: businessConfigError } =
    await args.supabase
      .from('business_configurations')
      .select('notification_email, contact_email')
      .eq('tenant_id', args.tenantId)
      .maybeSingle();

  if (businessConfigError) {
    return { reason: 'persist_failed' };
  }

  return resolveCloseOffNotificationDestination({
    contactEmail:
      typeof businessConfig?.contact_email === 'string'
        ? businessConfig.contact_email
        : null,
    notificationEmail:
      typeof businessConfig?.notification_email === 'string'
        ? businessConfig.notification_email
        : null,
  });
}

async function insertNotificationRow(args: {
  agentId: string;
  body: string;
  conversationId: string;
  destination: string | null;
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

async function updateNotificationDelivery(args: {
  body?: string;
  errorMessage?: string | null;
  id: string;
  providerMessageId?: string | null;
  status: CloseOffNotificationStatus;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<void> {
  const patch: {
    body?: string;
    error_message: string | null;
    provider_message_id: string | null;
    status: CloseOffNotificationStatus;
  } = {
    error_message: args.errorMessage ?? null,
    provider_message_id: args.providerMessageId ?? null,
    status: args.status,
  };

  if (args.body !== undefined) {
    patch.body = args.body;
  }

  await args.supabase
    .from('conversation_notifications')
    .update(patch)
    .eq('tenant_id', args.tenantId)
    .eq('id', args.id);
}

async function findExistingEmailNotification(args: {
  conversationId: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<
  | { id: string; status: CloseOffNotificationStatus }
  | null
  | { reason: 'persist_failed' }
> {
  const { data: existingEmail, error: existingError } = await args.supabase
    .from('conversation_notifications')
    .select('id, status')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .eq('channel', 'email')
    .maybeSingle();

  if (existingError) {
    return { reason: 'persist_failed' };
  }

  if (!existingEmail?.id) {
    return null;
  }

  return {
    id: existingEmail.id as string,
    status: existingEmail.status as CloseOffNotificationStatus,
  };
}

/**
 * Insert the Notifications row immediately (status Sending) so the tab can
 * update before Gemini summary / Resend finish.
 */
export async function queueCloseOffNotification(
  args: DeliverCloseOffNotificationArgs,
): Promise<DeliverCloseOffNotificationResult> {
  const existing = await findExistingEmailNotification(args);
  if (existing && 'reason' in existing) {
    return { created: false, reason: existing.reason };
  }
  if (existing) {
    if (existing.status === 'logged') {
      return {
        channel: 'email',
        created: true,
        destination: '',
        id: existing.id,
        status: 'logged',
      };
    }

    return {
      created: false,
      reason: 'already_exists',
    };
  }

  await args.supabase
    .from('conversation_notifications')
    .delete()
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .eq('kind', 'close_off')
    .eq('channel', 'inbox');

  const context = await resolveConversationContext(args);
  if ('reason' in context) {
    return { created: false, reason: context.reason };
  }

  const destination = await resolveDestination(args);
  if (destination && typeof destination === 'object' && 'reason' in destination) {
    return { created: false, reason: destination.reason };
  }

  const captures = await loadConversationCapturesForCloseOff({
    conversationId: args.conversationId,
    supabase: args.supabase,
    tenantId: args.tenantId,
  });

  const body = buildCloseOffNotificationBody({
    captures,
    outcome: context.outcome,
    summary: context.summary,
  });

  if (!destination) {
    try {
      const missingInsert = await insertNotificationRow({
        agentId: context.agentId,
        body,
        conversationId: args.conversationId,
        destination: MISSING_DESTINATION_LABEL,
        errorMessage:
          'Set Notification email (or Contact email) in Business configuration.',
        provider: 'resend',
        status: 'failed',
        subject: EMAIL_SUBJECT,
        supabase: args.supabase,
        tenantId: args.tenantId,
      });

      if (!missingInsert || 'duplicate' in missingInsert) {
        return { created: false, reason: 'already_exists' };
      }

      return {
        channel: 'email',
        created: true,
        destination: MISSING_DESTINATION_LABEL,
        id: missingInsert.id,
        status: 'failed',
      };
    } catch {
      return { created: false, reason: 'persist_failed' };
    }
  }

  try {
    const queuedInsert = await insertNotificationRow({
      agentId: context.agentId,
      body,
      conversationId: args.conversationId,
      destination,
      errorMessage: null,
      provider: 'resend',
      status: 'logged',
      subject: EMAIL_SUBJECT,
      supabase: args.supabase,
      tenantId: args.tenantId,
    });

    if (!queuedInsert || 'duplicate' in queuedInsert) {
      return { created: false, reason: 'already_exists' };
    }

    return {
      channel: 'email',
      created: true,
      destination,
      id: queuedInsert.id,
      status: 'logged',
    };
  } catch {
    return { created: false, reason: 'persist_failed' };
  }
}

/**
 * Rebuild the notification body with the final (Gemini) summary and send via Resend.
 */
export async function finalizeCloseOffNotification(
  args: DeliverCloseOffNotificationArgs,
): Promise<DeliverCloseOffNotificationResult> {
  let notificationId = args.notificationId?.trim() || null;

  if (!notificationId) {
    const existing = await findExistingEmailNotification(args);
    if (existing && 'reason' in existing) {
      return { created: false, reason: existing.reason };
    }
    if (existing) {
      notificationId = existing.id;
    }
  }

  if (!notificationId) {
    const queued = await queueCloseOffNotification(args);
    if (!queued.created) {
      return queued;
    }
    if (queued.status === 'failed') {
      return queued;
    }
    notificationId = queued.id;
  }

  const { data: existingRow, error: existingRowError } = await args.supabase
    .from('conversation_notifications')
    .select('id, destination, status')
    .eq('tenant_id', args.tenantId)
    .eq('id', notificationId)
    .maybeSingle();

  if (existingRowError || !existingRow) {
    return { created: false, reason: 'persist_failed' };
  }

  if (existingRow.status === 'sent' || existingRow.status === 'failed') {
    return {
      channel: 'email',
      created: true,
      destination:
        typeof existingRow.destination === 'string' &&
        existingRow.destination.trim()
          ? existingRow.destination
          : MISSING_DESTINATION_LABEL,
      id: notificationId,
      status: existingRow.status as CloseOffNotificationStatus,
    };
  }

  const context = await resolveConversationContext(args);
  if ('reason' in context) {
    return { created: false, reason: context.reason };
  }

  const destination =
    typeof existingRow.destination === 'string' &&
    existingRow.destination.trim() &&
    existingRow.destination !== MISSING_DESTINATION_LABEL
      ? existingRow.destination.trim()
      : await resolveDestination(args);

  if (destination && typeof destination === 'object' && 'reason' in destination) {
    return { created: false, reason: destination.reason };
  }

  const captures = await loadConversationCapturesForCloseOff({
    conversationId: args.conversationId,
    supabase: args.supabase,
    tenantId: args.tenantId,
  });

  const body = buildCloseOffNotificationBody({
    captures,
    outcome: context.outcome,
    summary: context.summary,
  });

  if (!destination) {
    try {
      await updateNotificationDelivery({
        body,
        errorMessage:
          'Set Notification email (or Contact email) in Business configuration.',
        id: notificationId,
        status: 'failed',
        supabase: args.supabase,
        tenantId: args.tenantId,
      });
    } catch {
      return { created: false, reason: 'persist_failed' };
    }

    return {
      channel: 'email',
      created: true,
      destination: MISSING_DESTINATION_LABEL,
      id: notificationId,
      status: 'failed',
    };
  }

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
        to: destination,
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
    await updateNotificationDelivery({
      body,
      errorMessage,
      id: notificationId,
      providerMessageId,
      status: emailStatus,
      supabase: args.supabase,
      tenantId: args.tenantId,
    });
  } catch {
    // Row already exists; delivery status update is best-effort.
  }

  return {
    channel: 'email',
    created: true,
    destination,
    id: notificationId,
    status: emailStatus,
  };
}

export async function deliverCloseOffNotification(
  args: DeliverCloseOffNotificationArgs,
): Promise<DeliverCloseOffNotificationResult> {
  if (args.notificationId) {
    return finalizeCloseOffNotification(args);
  }

  const queued = await queueCloseOffNotification(args);
  if (!queued.created) {
    return queued;
  }

  if (queued.status === 'failed') {
    return queued;
  }

  return finalizeCloseOffNotification({
    ...args,
    notificationId: queued.id,
  });
}
