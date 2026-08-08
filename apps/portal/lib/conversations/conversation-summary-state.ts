import {
  shouldReplaceConversationSummary,
} from './generate-conversation-summary';
import type { ConversationStatus } from './helpers';

export const conversationSummaryUiStates = [
  'ready',
  'generating',
  'empty',
  'waiting',
] as const;

export type ConversationSummaryUiState =
  (typeof conversationSummaryUiStates)[number];

export function resolveConversationSummaryUiState(args: {
  hasTranscript: boolean;
  status: ConversationStatus;
  summary: string | null | undefined;
}): ConversationSummaryUiState {
  if (args.status === 'starting' || args.status === 'active') {
    return 'waiting';
  }

  if (!args.hasTranscript) {
    return 'empty';
  }

  if (
    (args.status === 'completed' || args.status === 'failed') &&
    shouldReplaceConversationSummary(args.summary)
  ) {
    return 'generating';
  }

  if (args.summary?.trim()) {
    return 'ready';
  }

  return 'empty';
}

export function conversationSummaryNeedsGeneration(args: {
  hasTranscript: boolean;
  status: ConversationStatus;
  summary: string | null | undefined;
}): boolean {
  return resolveConversationSummaryUiState(args) === 'generating';
}
