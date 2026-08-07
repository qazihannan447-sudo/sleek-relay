import { isConversationUuid } from '../conversations/helpers';

const browserConversationSource = 'browser_test' as const;

type BrowserTestFetch = typeof fetch;
type BrowserConversationLifecycleEvent = 'completed' | 'connected' | 'failed';

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

export type VoiceSessionRequestData = {
  enableCam: false;
  enableMic: true;
  metadata: {
    voiceSessionToken: string;
  };
  voiceSessionToken: string;
};

export type BrowserVoiceBootstrapResult = {
  conversationId: string;
  expiresAt: string;
  requestData: VoiceSessionRequestData;
  token: string;
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

function buildBootstrapFailureMessage(step: 'start' | 'token'): string {
  if (step === 'start') {
    return 'Unable to start the browser voice conversation right now.';
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
): VoiceSessionRequestData {
  const normalizedToken = token.trim();

  if (!normalizedToken) {
    throw new Error(buildBootstrapFailureMessage('token'));
  }

  return {
    enableCam: false,
    enableMic: true,
    metadata: {
      voiceSessionToken: normalizedToken,
    },
    voiceSessionToken: normalizedToken,
  };
}

export function createBrowserVoiceBootstrap(deps: {
  fetch: BrowserTestFetch;
}) {
  return async function bootstrapBrowserVoiceConversation(args: {
    agentId: string;
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

    return {
      conversationId: sessionToken.conversationId,
      expiresAt: sessionToken.expiresAt,
      requestData: buildVoiceSessionRequestData(sessionToken.token),
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
  }): Promise<BrowserConversationLifecycleSuccessBody> {
    const response = await deps.fetch(
      `/api/voice/conversations/${args.conversationId}/lifecycle`,
      {
        body: JSON.stringify({
          endReason: args.endReason,
          errorMessage: args.errorMessage,
          event: args.event,
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
