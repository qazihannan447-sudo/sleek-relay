import { isConversationUuid } from '../conversations/helpers';

const browserConversationSource = 'browser_test' as const;
const browserStartupTimingOrder = [
  'connect_clicked',
  'conversation_creation_finished',
  'session_token_finished',
  'smallwebrtc_connect_started',
  'webrtc_connected',
  'worker_client_ready',
] as const;

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

type StartConversationSuccessBody = {
  conversationId: string;
  startedAt: string;
  status: 'starting';
};

type SessionTokenSuccessBody = {
  conversationId: string;
  expiresAt: string;
  token: string;
  tokenType: 'Bearer';
};

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
  transport: 'webrtc';
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

type RuntimeConfigSuccessBody = {
  conversationId: string;
  runtimePackage: { [key: string]: VoiceSessionJson };
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

function buildBootstrapFailureMessage(
  step: 'runtime' | 'start' | 'token',
): string {
  if (step === 'start') {
    return 'Unable to start the browser voice conversation right now.';
  }

  if (step === 'runtime') {
    return 'Unable to load the agent runtime configuration right now.';
  }

  return 'Unable to issue a voice session token right now.';
}

function buildLifecycleFailureMessage(): string {
  return 'Unable to update the browser voice conversation lifecycle right now.';
}

function validateStartConversationSuccessBody(
  payload: unknown,
): StartConversationSuccessBody {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as StartConversationSuccessBody).conversationId !== 'string' ||
    !isConversationUuid((payload as StartConversationSuccessBody).conversationId) ||
    typeof (payload as StartConversationSuccessBody).startedAt !== 'string' ||
    (payload as StartConversationSuccessBody).status !== 'starting'
  ) {
    throw new Error(buildBootstrapFailureMessage('start'));
  }

  return payload as StartConversationSuccessBody;
}

function validateSessionTokenSuccessBody(
  payload: unknown,
  conversationId: string,
): SessionTokenSuccessBody {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as SessionTokenSuccessBody).conversationId !== 'string' ||
    (payload as SessionTokenSuccessBody).conversationId !== conversationId ||
    typeof (payload as SessionTokenSuccessBody).token !== 'string' ||
    !(payload as SessionTokenSuccessBody).token.trim() ||
    (payload as SessionTokenSuccessBody).tokenType !== 'Bearer' ||
    typeof (payload as SessionTokenSuccessBody).expiresAt !== 'string'
  ) {
    throw new Error(buildBootstrapFailureMessage('token'));
  }

  return payload as SessionTokenSuccessBody;
}

function validateRuntimeConfigSuccessBody(
  payload: unknown,
  conversationId: string,
): RuntimeConfigSuccessBody {
  if (
    !payload ||
    typeof payload !== 'object' ||
    typeof (payload as RuntimeConfigSuccessBody).conversationId !== 'string' ||
    (payload as RuntimeConfigSuccessBody).conversationId !== conversationId ||
    !(payload as RuntimeConfigSuccessBody).runtimePackage ||
    typeof (payload as RuntimeConfigSuccessBody).runtimePackage !== 'object' ||
    Array.isArray((payload as RuntimeConfigSuccessBody).runtimePackage)
  ) {
    throw new Error(buildBootstrapFailureMessage('runtime'));
  }

  return {
    conversationId: (payload as RuntimeConfigSuccessBody).conversationId,
    runtimePackage: (payload as RuntimeConfigSuccessBody)
      .runtimePackage as { [key: string]: VoiceSessionJson },
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
    throw new Error(buildBootstrapFailureMessage('token'));
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
    transport: 'webrtc',
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

    const startResponse = await deps.fetch('/api/voice/conversations', {
      body: JSON.stringify(startBody),
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    });

    const startPayload = await readJsonSafely(startResponse);

    if (!startResponse.ok) {
      throw new Error(
        readSafeErrorMessage(
          startPayload,
          buildBootstrapFailureMessage('start'),
        ),
      );
    }

    const startedConversation =
      validateStartConversationSuccessBody(startPayload);
    args.onTimingEvent?.('conversation_creation_finished');

    const sessionTokenResponse = await deps.fetch(
      `/api/voice/conversations/${startedConversation.conversationId}/session-token`,
      {
        cache: 'no-store',
        method: 'POST',
      },
    );

    const sessionTokenPayload = await readJsonSafely(sessionTokenResponse);

    if (!sessionTokenResponse.ok) {
      throw new Error(
        readSafeErrorMessage(
          sessionTokenPayload,
          buildBootstrapFailureMessage('token'),
        ),
      );
    }

    const sessionToken = validateSessionTokenSuccessBody(
      sessionTokenPayload,
      startedConversation.conversationId,
    );
    args.onTimingEvent?.('session_token_finished');

    const runtimeConfigResponse = await deps.fetch(
      '/api/voice/runtime-config',
      {
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${sessionToken.token}`,
        },
        method: 'POST',
      },
    );
    const runtimeConfigPayload = await readJsonSafely(runtimeConfigResponse);

    if (!runtimeConfigResponse.ok) {
      throw new Error(
        readSafeErrorMessage(
          runtimeConfigPayload,
          buildBootstrapFailureMessage('runtime'),
        ),
      );
    }

    const runtimeConfig = validateRuntimeConfigSuccessBody(
      runtimeConfigPayload,
      sessionToken.conversationId,
    );

    return {
      conversationId: sessionToken.conversationId,
      expiresAt: sessionToken.expiresAt,
      requestData: buildVoiceSessionRequestData(sessionToken.token, runtimeConfig),
      token: sessionToken.token,
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
