import type { Tracks, TransportState } from '@pipecat-ai/client-js';
import type {
  BotOutputText,
  ConversationMessage,
  ConversationMessagePart,
} from '@pipecat-ai/client-react';

export type VoiceRunnerConfig =
  | {
      baseUrl: string;
      kind: 'valid';
      startUrl: string;
    }
  | {
      kind: 'invalid';
      message: string;
    };

export type VoiceTransportStatus =
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'ready';

export const GENERIC_FATAL_DISCONNECT_MESSAGE =
  'Fatal error reported. Disconnecting...';

type TranscriptTextValue =
  | string
  | {
      spoken?: string;
      unspoken?: string;
    };

export function resolveVoiceRunnerConfig(
  value: string | undefined,
): VoiceRunnerConfig {
  if (!value) {
    return {
      kind: 'invalid',
      message:
        'Set NEXT_PUBLIC_VOICE_RUNNER_URL to the local Pipecat runner base URL.',
    };
  }

  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        kind: 'invalid',
        message:
          'NEXT_PUBLIC_VOICE_RUNNER_URL must use an http or https URL.',
      };
    }

    const normalizedBaseUrl = url.toString().replace(/\/$/, '');

    return {
      baseUrl: normalizedBaseUrl,
      kind: 'valid',
      startUrl: new URL('/start', `${normalizedBaseUrl}/`).toString(),
    };
  } catch {
    return {
      kind: 'invalid',
      message:
        'NEXT_PUBLIC_VOICE_RUNNER_URL is not a valid absolute URL for the local Pipecat runner.',
    };
  }
}

export function mapTransportStateToStatus(
  state: TransportState,
): VoiceTransportStatus {
  if (state === 'error') {
    return 'error';
  }

  if (state === 'ready') {
    return 'ready';
  }

  if (state === 'disconnected') {
    return 'disconnected';
  }

  return 'connecting';
}

export function isTransientWebSocketError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('rejected websocket connection') ||
    (lower.includes('websocket') && lower.includes('400'))
  );
}

export function resolveVisibleVoiceErrorMessage(args: {
  currentMessage: string | null;
  nextMessage: string;
}): string | null {
  const normalizedNextMessage = args.nextMessage.trim();

  if (!normalizedNextMessage) {
    return args.currentMessage ?? normalizedNextMessage;
  }

  if (isTransientWebSocketError(normalizedNextMessage)) {
    return args.currentMessage;
  }

  if (
    normalizedNextMessage === GENERIC_FATAL_DISCONNECT_MESSAGE &&
    args.currentMessage
  ) {
    return args.currentMessage;
  }

  return normalizedNextMessage;
}

export function stopLocalMicrophoneTracks(tracks: Tracks): void {
  tracks.local.audio?.stop();
  tracks.local.screenAudio?.stop();
}

function readTranscriptTextValue(value: TranscriptTextValue): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  const spoken = typeof value.spoken === 'string' ? value.spoken : '';
  const unspoken = typeof value.unspoken === 'string' ? value.unspoken : '';

  return `${spoken}${unspoken}`.trim();
}

function isBotOutputText(value: unknown): value is BotOutputText {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'spoken' in value || 'unspoken' in value;
}

export function getConversationPartText(part: ConversationMessagePart): string {
  if (typeof part.text === 'string') {
    return readTranscriptTextValue(part.text);
  }

  if (isBotOutputText(part.text)) {
    return readTranscriptTextValue(part.text);
  }

  return '';
}

export function getConversationMessageText(
  message: ConversationMessage,
): string {
  return message.parts
    .map(getConversationPartText)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
