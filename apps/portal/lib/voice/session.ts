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

  // Device warmup (initDevices) moves the transport to initializing /
  // initialized before any connect attempt. Those states are idle for the UI;
  // treating them as 'connecting' left the panel stuck on a loading spinner.
  if (
    state === 'disconnected' ||
    state === 'initializing' ||
    state === 'initialized'
  ) {
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

/** Marks the portal-owned bot playback element for post-Connect unlock. */
export const BOT_REMOTE_AUDIO_ELEMENT_ATTR = 'data-sleek-bot-audio';

export type EnsureBotRemoteAudioPlayingResult =
  | 'no_track'
  | 'play_failed'
  | 'playing';

type BotAudioPlaybackClient = {
  tracks: () => Tracks;
};

/**
 * Attach the Daily bot audio track and call play() after a user gesture.
 *
 * Muted Daily pre-join can attach the remote track before Connect. Browsers
 * often leave that <audio> paused under autoplay rules; transcript/RTVI text
 * still works. Kick playback after mic enable / session arm.
 */
export async function ensureBotRemoteAudioPlaying(args: {
  audioElement?: HTMLAudioElement | null;
  client: BotAudioPlaybackClient;
  createMediaStream?: (_track: MediaStreamTrack) => MediaStream;
  root?: ParentNode | null;
}): Promise<EnsureBotRemoteAudioPlayingResult> {
  const botTrack = args.client.tracks().bot?.audio ?? null;
  if (!botTrack) {
    return 'no_track';
  }

  const createMediaStream =
    args.createMediaStream ??
    ((track: MediaStreamTrack) => {
      if (typeof MediaStream === 'undefined') {
        throw new Error('MediaStream is not available in this environment.');
      }
      return new MediaStream([track]);
    });

  let played = false;
  const dedicatedAudio =
    args.audioElement ??
    args.root?.querySelector<HTMLAudioElement>(
      `audio[${BOT_REMOTE_AUDIO_ELEMENT_ATTR}="true"]`,
    ) ??
    null;

  if (dedicatedAudio) {
    const existingStream = dedicatedAudio.srcObject as {
      getAudioTracks?: () => Array<Pick<MediaStreamTrack, 'id'>>;
    } | null;
    const existingTrack = existingStream?.getAudioTracks?.()[0];

    if (!existingTrack || existingTrack.id !== botTrack.id) {
      dedicatedAudio.srcObject = createMediaStream(botTrack);
    }

    dedicatedAudio.muted = false;
    dedicatedAudio.volume = 1;

    try {
      await dedicatedAudio.play();
      played = true;
    } catch {
      // Daily-owned elements below may still unlock after the gesture.
    }
  }

  const root =
    args.root === undefined
      ? typeof document !== 'undefined'
        ? document
        : null
      : args.root;

  if (root) {
    for (const element of Array.from(root.querySelectorAll('audio'))) {
      element.muted = false;
      try {
        await element.play();
        played = true;
      } catch {
        // Ignore per-element autoplay rejections.
      }
    }
  }

  return played ? 'playing' : 'play_failed';
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
  const parts: string[] = [];

  for (const part of message.parts) {
    const text = getConversationPartText(part).replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }

    // BotOutput can emit the same sentence as multiple parts when the client
    // briefly treats early greeting events as legacy RTVI protocol.
    if (parts.length > 0 && parts[parts.length - 1] === text) {
      continue;
    }

    parts.push(text);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export type TranscriptMessageLike = {
  role: string;
  text: string;
};

/**
 * Collapse consecutive identical role+text rows so a single spoken greeting
 * cannot appear (or be persisted) as many duplicate transcript bubbles.
 */
export function dedupeConsecutiveTranscriptMessages<
  T extends TranscriptMessageLike,
>(messages: T[]): T[] {
  const deduped: T[] = [];

  for (const message of messages) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.role === message.role &&
      previous.text === message.text
    ) {
      continue;
    }

    deduped.push(message);
  }

  return deduped;
}
