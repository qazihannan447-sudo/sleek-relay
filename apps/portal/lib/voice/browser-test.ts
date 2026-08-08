import { isConversationUuid } from '../conversations/helpers';

const browserConversationSource = 'browser_test' as const;
const browserStartupTimingOrder = [
  'connect_clicked',
  'conversation_creation_finished',
  'session_token_finished',
  'daily_prejoin_started',
  'daily_prejoin_connected',
  'transport_connect_started',
  'webrtc_connected',
  'worker_client_ready',
  'session_arm_started',
  'session_armed',
] as const;

/** Client→worker RTVI message that allows the opening greeting after Daily pre-join. */
export const VOICE_SESSION_ARMED_MESSAGE_TYPE = 'session_armed';

/** Must stay below the worker client no-show timeout (120s). */
export const VOICE_SESSION_PREJOIN_MAX_AGE_MS = 60 * 1000;

type BrowserTestFetch = typeof fetch;
type BrowserConversationLifecycleEvent = 'completed' | 'connected' | 'failed';
type BrowserConversationTranscriptMessage = {
  content: string;
  role: 'assistant' | 'system' | 'user';
};
type BrowserConversationRuntimeSnapshot = Partial<{
  agent_name: string;
  language: string;
  role: string;
  voice_id: string;
}>;

type VoiceBootstrapErrorBody = {
  error?: string;
};

type BrowserConversationLifecycleSuccessBody = {
  conversationId: string;
  endReason: string | null;
  finalized: boolean;
  status: 'active' | 'cancelled' | 'completed' | 'failed' | 'starting';
};
export type BrowserStartupTimingName =
  (typeof browserStartupTimingOrder)[number];

/** JSON values accepted by Pipecat `requestData` / `Serializable`. */
export type VoiceSessionJson =
  | string
  | number
  | boolean
  | null
  | VoiceSessionJson[]
  | { [key: string]: VoiceSessionJson };

export type VoiceSessionRuntimeConfigPayload = {
  conversationId: string;
  runtimePackage: { [key: string]: VoiceSessionJson };
};

export type VoiceSessionRequestBody = {
  conversationId?: string;
  enableCam: false;
  enableMic: true;
  metadata: {
    voiceSessionToken: string;
  };
  runtimePackage?: { [key: string]: VoiceSessionJson };
  voiceSessionToken: string;
};

export type VoiceSessionRequestData = {
  // Pipecat's /start stores only `body` in the session and later passes it as
  // runner_args.body. Tokens outside `body` never reach the voice worker.
  body: VoiceSessionRequestBody;
  createDailyRoom: true;
  transport: 'daily';
};

export type VoiceDailyConnectParams = {
  token: string;
  url: string;
};

export type VoiceOfferConnectParams = {
  iceConfig?: VoiceSessionJson;
  webrtcRequestParams: {
    endpoint: string;
    requestData: VoiceSessionRequestBody;
  };
};

/** Narrow request data to Pipecat's Serializable-compatible shape for startBotAndConnect. */
export function asPipecatRequestData(
  requestData: VoiceSessionRequestData | VoiceSessionRequestBody,
): { [key: string]: VoiceSessionJson } {
  return requestData as unknown as { [key: string]: VoiceSessionJson };
}

export function readVoiceStartSessionId(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('The local voice runner did not return a session id.');
  }

  const record = response as { sessionId?: unknown; session_id?: unknown };
  const sessionId =
    typeof record.sessionId === 'string'
      ? record.sessionId.trim()
      : typeof record.session_id === 'string'
        ? record.session_id.trim()
        : '';

  if (!sessionId) {
    throw new Error('The local voice runner did not return a session id.');
  }

  return sessionId;
}

/**
 * Map Pipecat Daily `/start` response fields onto DailyTransport connect params.
 * The runner returns `dailyRoom` / `dailyToken`; the client expects `url` / `token`.
 */
export function buildDailyVoiceConnectParams(
  startResponse: unknown,
): VoiceDailyConnectParams {
  if (!startResponse || typeof startResponse !== 'object') {
    throw new Error('The voice runner did not return Daily room credentials.');
  }

  const record = startResponse as {
    dailyRoom?: unknown;
    dailyToken?: unknown;
    token?: unknown;
    url?: unknown;
  };

  const url =
    typeof record.url === 'string' && record.url.trim()
      ? record.url.trim()
      : typeof record.dailyRoom === 'string' && record.dailyRoom.trim()
        ? record.dailyRoom.trim()
        : '';
  const token =
    typeof record.token === 'string' && record.token.trim()
      ? record.token.trim()
      : typeof record.dailyToken === 'string' && record.dailyToken.trim()
        ? record.dailyToken.trim()
        : '';

  if (!url) {
    throw new Error('The voice runner did not return a Daily room URL.');
  }

  if (!token) {
    throw new Error('The voice runner did not return a Daily room token.');
  }

  return { token, url };
}

/**
 * Build SmallWebRTC connect params that attach the portal session payload to the
 * WebRTC offer. Relying only on Pipecat's in-memory /start session store is
 * fragile; forwarding the body on offer requestData makes the worker reliably
 * receive the voice session token and embedded runtime package.
 */
export function buildVoiceOfferConnectParams(args: {
  runnerBaseUrl: string;
  sessionBody: VoiceSessionRequestBody;
  sessionId: string;
  startResponse?: unknown;
}): VoiceOfferConnectParams {
  // Match Pipecat's session offer URL shape (unencoded UUID path segments).
  const offerUrl = new URL(
    `/sessions/${args.sessionId}/api/offer`,
    `${args.runnerBaseUrl.replace(/\/$/, '')}/`,
  ).toString();

  const connectParams: VoiceOfferConnectParams = {
    webrtcRequestParams: {
      endpoint: offerUrl,
      requestData: args.sessionBody,
    },
  };

  if (
    args.startResponse &&
    typeof args.startResponse === 'object' &&
    'iceConfig' in args.startResponse &&
    (args.startResponse as { iceConfig?: unknown }).iceConfig != null
  ) {
    connectParams.iceConfig = (args.startResponse as { iceConfig: VoiceSessionJson })
      .iceConfig;
  }

  return connectParams;
}

/**
 * Build the Pipecat `connect()` params used after `startBot()`.
 * Attaches the portal session body on offer requestData so the worker receives
 * the token + runtime package even if the /start session store is empty.
 */
export function buildVoiceSessionConnectParams(args: {
  runnerBaseUrl: string;
  requestData: VoiceSessionRequestData;
  startResponse: unknown;
}): {
  iceConfig?: VoiceSessionJson;
  sessionId: string;
  webrtcRequestParams: {
    endpoint: string;
    requestData: { [key: string]: VoiceSessionJson };
  };
} {
  const sessionId = readVoiceStartSessionId(args.startResponse);
  const offerConnectParams = buildVoiceOfferConnectParams({
    runnerBaseUrl: args.runnerBaseUrl,
    sessionBody: args.requestData.body,
    sessionId,
    startResponse: args.startResponse,
  });

  return {
    sessionId,
    ...(offerConnectParams.iceConfig != null
      ? { iceConfig: offerConnectParams.iceConfig }
      : {}),
    webrtcRequestParams: {
      endpoint: offerConnectParams.webrtcRequestParams.endpoint,
      requestData: asPipecatRequestData(
        offerConnectParams.webrtcRequestParams.requestData,
      ),
    },
  };
}

export type BrowserVoiceBootstrapResult = {
  conversationId: string;
  expiresAt: string;
  requestData: VoiceSessionRequestData;
  token: string;
};
export type BrowserStartupTimingTracker = {
  hasMark(_name: BrowserStartupTimingName): boolean;
  logSummary(_outcome?: 'failed' | 'success'): void;
  mark(_name: BrowserStartupTimingName): void;
};

export const browserConversationLifecycleEvents = {
  agentEndSession: 'agent_end_session',
  completed: 'completed' as const,
  connected: 'connected' as const,
  failed: 'failed' as const,
  userDisconnect: 'user_disconnect',
};

type StartConversationBody = {
  agentId: string;
  source: typeof browserConversationSource;
};

function readSafeErrorMessage(
  payload: unknown,
  fallbackMessage: string,
): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof (payload as VoiceBootstrapErrorBody).error === 'string' &&
    (payload as VoiceBootstrapErrorBody).error?.trim()
  ) {
    return (payload as VoiceBootstrapErrorBody).error!.trim();
  }

  return fallbackMessage;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildBootstrapFailureMessage(): string {
  return 'Unable to bootstrap the browser voice session right now.';
}

function buildLifecycleFailureMessage(): string {
  return 'Unable to update the browser voice conversation lifecycle right now.';
}

function buildDiscardFailureMessage(): string {
  return 'Unable to discard the unused browser voice conversation right now.';
}

function validateBootstrapSuccessBody(
  payload: unknown,
): {
  conversationId: string;
  expiresAt: string;
  runtimePackage: { [key: string]: VoiceSessionJson };
  token: string;
} {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as { conversationId?: unknown }).conversationId !==
      'string' ||
    !isConversationUuid(
      (payload as { conversationId: string }).conversationId,
    ) ||
    typeof (payload as { token?: unknown }).token !== 'string' ||
    !(payload as { token: string }).token.trim() ||
    (payload as { tokenType?: unknown }).tokenType !== 'Bearer' ||
    typeof (payload as { expiresAt?: unknown }).expiresAt !== 'string' ||
    (payload as { status?: unknown }).status !== 'starting' ||
    !(payload as { runtimePackage?: unknown }).runtimePackage ||
    typeof (payload as { runtimePackage?: unknown }).runtimePackage !==
      'object' ||
    Array.isArray((payload as { runtimePackage?: unknown }).runtimePackage)
  ) {
    throw new Error(buildBootstrapFailureMessage());
  }

  return {
    conversationId: (payload as { conversationId: string }).conversationId,
    expiresAt: (payload as { expiresAt: string }).expiresAt,
    runtimePackage: (payload as { runtimePackage: { [key: string]: VoiceSessionJson } })
      .runtimePackage,
    token: (payload as { token: string }).token,
  };
}

function validateLifecycleSuccessBody(
  payload: unknown,
  conversationId: string,
): BrowserConversationLifecycleSuccessBody {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as BrowserConversationLifecycleSuccessBody).conversationId !==
    'string' ||
    (payload as BrowserConversationLifecycleSuccessBody).conversationId !==
    conversationId ||
    typeof (payload as BrowserConversationLifecycleSuccessBody).finalized !==
    'boolean' ||
    typeof (payload as BrowserConversationLifecycleSuccessBody).status !==
    'string'
  ) {
    throw new Error(buildLifecycleFailureMessage());
  }

  return payload as BrowserConversationLifecycleSuccessBody;
}

export function buildVoiceSessionRequestData(
  token: string,
  runtimeConfig?: VoiceSessionRuntimeConfigPayload,
): VoiceSessionRequestData {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new Error(buildBootstrapFailureMessage());
  }

  return {
    body: {
      enableCam: false,
      enableMic: true,
      metadata: {
        voiceSessionToken: normalizedToken,
      },
      voiceSessionToken: normalizedToken,
      ...(runtimeConfig
        ? {
            conversationId: runtimeConfig.conversationId,
            runtimePackage: runtimeConfig.runtimePackage,
          }
        : {}),
    },
    createDailyRoom: true,
    transport: 'daily',
  };
}

export function createBrowserStartupTimingTracker(args?: {
  logger?: Pick<Console, 'info'>;
  monotonicNow?: () => number;
}): BrowserStartupTimingTracker {
  const logger = args?.logger ?? console;
  const monotonicNow = args?.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const marks = new Map<BrowserStartupTimingName, number>();
  let summaryLogged = false;

  function readElapsedMs(name: BrowserStartupTimingName): number | null {
    const markedAt = marks.get(name);
    if (markedAt === undefined) {
      return null;
    }

    return Math.round(markedAt - startedAt);
  }

  return {
    hasMark(name) {
      return marks.has(name);
    },
    logSummary(outcome = 'success') {
      if (summaryLogged) {
        return;
      }

      summaryLogged = true;
      logger.info(
        [
          `browser voice startup: outcome=${outcome}`,
          ...browserStartupTimingOrder.map(
            (name) => `${name}_ms=${readElapsedMs(name) ?? 'n/a'}`,
          ),
        ].join(' '),
      );
    },
    mark(name) {
      if (marks.has(name)) {
        return;
      }

      marks.set(name, monotonicNow());
    },
  };
}

export function createBrowserVoiceBootstrap(deps: {
  fetch: BrowserTestFetch;
}) {
  return async function bootstrapBrowserVoiceConversation(args: {
    agentId: string;
    onTimingEvent?: (_name: BrowserStartupTimingName) => void;
  }): Promise<BrowserVoiceBootstrapResult> {
    const startBody: StartConversationBody = {
      agentId: args.agentId,
      source: browserConversationSource,
    };

    const bootstrapResponse = await deps.fetch(
      '/api/voice/browser-test/bootstrap',
      {
        body: JSON.stringify(startBody),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    );

    const bootstrapPayload = await readJsonSafely(bootstrapResponse);

    if (!bootstrapResponse.ok) {
      throw new Error(
        readSafeErrorMessage(
          bootstrapPayload,
          buildBootstrapFailureMessage(),
        ),
      );
    }

    const bootstrap = validateBootstrapSuccessBody(bootstrapPayload);
    // Preserve existing timing mark names so Connect logs stay comparable.
    args.onTimingEvent?.('conversation_creation_finished');
    args.onTimingEvent?.('session_token_finished');

    return {
      conversationId: bootstrap.conversationId,
      expiresAt: bootstrap.expiresAt,
      requestData: buildVoiceSessionRequestData(bootstrap.token, {
        conversationId: bootstrap.conversationId,
        runtimePackage: bootstrap.runtimePackage,
      }),
      token: bootstrap.token,
    };
  };
}

export function createBrowserVoiceConversationLifecycle(deps: {
  fetch: BrowserTestFetch;
}) {
  return async function updateBrowserVoiceConversationLifecycle(args: {
    conversationId: string;
    endReason?: string;
    errorMessage?: string;
    event: BrowserConversationLifecycleEvent;
    keepalive?: boolean;
    runtimeSnapshot?: BrowserConversationRuntimeSnapshot;
    transcriptMessages?: BrowserConversationTranscriptMessage[];
  }): Promise<BrowserConversationLifecycleSuccessBody> {
    const response = await deps.fetch(
      `/api/voice/conversations/${args.conversationId}/lifecycle`,
      {
        body: JSON.stringify({
          endReason: args.endReason,
          errorMessage: args.errorMessage,
          event: args.event,
          runtimeSnapshot: args.runtimeSnapshot,
          transcriptMessages: args.transcriptMessages,
        }),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        keepalive: args.keepalive === true,
        method: 'PATCH',
      },
    );

    const payload = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(
        readSafeErrorMessage(payload, buildLifecycleFailureMessage()),
      );
    }

    return validateLifecycleSuccessBody(payload, args.conversationId);
  };
}

export function createBrowserVoiceConversationDiscard(deps: {
  fetch: BrowserTestFetch;
}) {
  return async function discardUnusedBrowserVoiceConversation(args: {
    conversationId: string;
    keepalive?: boolean;
  }): Promise<{ conversationId: string; discarded: true }> {
    const response = await deps.fetch(
      `/api/voice/conversations/${args.conversationId}`,
      {
        cache: 'no-store',
        keepalive: args.keepalive === true,
        method: 'DELETE',
      },
    );

    const payload = await readJsonSafely(response);

    if (!response.ok) {
      throw new Error(
        readSafeErrorMessage(payload, buildDiscardFailureMessage()),
      );
    }

    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as { discarded?: unknown }).discarded !== true ||
      (payload as { conversationId?: unknown }).conversationId !==
        args.conversationId
    ) {
      throw new Error(buildDiscardFailureMessage());
    }

    return {
      conversationId: args.conversationId,
      discarded: true,
    };
  };
}
