import type { SupabaseClient } from '@supabase/supabase-js';

import {
  generateConversationSummaryFromTranscript,
  shouldReplaceConversationSummary,
  type ConversationSummaryMessage,
} from './generate-conversation-summary';
import { browserConversationSource } from '../voice/start-conversation';

type SummaryTranscriptRole = ConversationSummaryMessage['role'];

function isSummaryTranscriptRole(value: string): value is SummaryTranscriptRole {
  return value === 'assistant' || value === 'system' || value === 'user';
}

export function normalizeSummaryTranscriptMessages(
  messages: Array<{ content?: string | null; role?: string | null }>,
): ConversationSummaryMessage[] {
  const normalized: ConversationSummaryMessage[] = [];

  for (const message of messages) {
    const role =
      typeof message.role === 'string' && isSummaryTranscriptRole(message.role)
        ? message.role
        : null;
    const content = message.content?.trim();

    if (!role || !content) {
      continue;
    }

    normalized.push({ content, role });
  }

  return normalized;
}

export async function loadConversationSummaryTranscript(args: {
  conversationId: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<ConversationSummaryMessage[]> {
  const { data, error } = await args.supabase
    .from('conversation_messages')
    .select('role, content, sequence_number')
    .eq('tenant_id', args.tenantId)
    .eq('conversation_id', args.conversationId)
    .order('sequence_number', { ascending: true });

  if (error || !data) {
    return [];
  }

  return normalizeSummaryTranscriptMessages(data);
}

export function preferSummaryTranscript(args: {
  databaseMessages: ConversationSummaryMessage[];
  requestMessages: ConversationSummaryMessage[];
}): ConversationSummaryMessage[] {
  if (args.databaseMessages.length > 0) {
    return args.databaseMessages;
  }

  return args.requestMessages;
}

export async function writeConversationSummary(args: {
  conversationId: string;
  source?: string;
  summary: string;
  supabase: SupabaseClient;
  tenantId: string;
}): Promise<boolean> {
  const { error } = await args.supabase
    .from('conversations')
    .update({ summary: args.summary })
    .eq('tenant_id', args.tenantId)
    .eq('id', args.conversationId)
    .eq('source', args.source ?? browserConversationSource);

  return !error;
}

export async function generateAndPersistConversationSummary(args: {
  conversationId: string;
  endReason?: string | null;
  event: 'completed' | 'failed';
  existingSummary?: string | null;
  generateConversationSummary?: typeof generateConversationSummaryFromTranscript;
  source?: string;
  supabase: SupabaseClient;
  tenantId: string;
  transcriptMessages: ConversationSummaryMessage[];
}): Promise<string | null> {
  if (
    !shouldReplaceConversationSummary(args.existingSummary) ||
    args.transcriptMessages.length === 0
  ) {
    return null;
  }

  const generate =
    args.generateConversationSummary ?? generateConversationSummaryFromTranscript;
  const generatedSummary = await generate({
    endReason: args.endReason ?? undefined,
    event: args.event,
    transcriptMessages: args.transcriptMessages,
  });

  if (!generatedSummary) {
    return null;
  }

  const wrote = await writeConversationSummary({
    conversationId: args.conversationId,
    source: args.source,
    summary: generatedSummary,
    supabase: args.supabase,
    tenantId: args.tenantId,
  });

  return wrote ? generatedSummary : null;
}
