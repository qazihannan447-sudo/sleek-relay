'use client';

import {
  PipecatClientAudio,
  PipecatClientProvider,
  usePipecatConversation,
  usePipecatClientTransportState,
  useRTVIClientEvent,
} from '@pipecat-ai/client-react';
import {
  DeviceError,
  PipecatClient,
  RTVIEvent,
  type RTVIMessage,
} from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  browserConversationLifecycleEvents,
  createBrowserVoiceBootstrap,
  createBrowserVoiceConversationLifecycle,
} from '../../../../../lib/voice/browser-test';
import {
  getConversationMessageText,
  mapTransportStateToStatus,
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
  stopLocalMicrophoneTracks,
} from '../../../../../lib/voice/session';

type VoiceTestPanelProps = {
  agentId: string;
  agentLanguage: string;
  agentName: string;
  agentRole: string;
  agentVoiceId: string;
};

type VoiceTranscriptItem = {
  id: string;
  role: 'assistant' | 'system' | 'user';
  text: string;
};

function createVoiceClient() {
  return new PipecatClient({
    disconnectOnBotDisconnect: true,
    enableCam: false,
    enableMic: true,
    transport: new SmallWebRTCTransport(),
  });
}

function formatVoiceError(error: unknown): string {
  if (error instanceof DeviceError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'error' in error &&
    typeof error.error === 'string'
  ) {
    return error.error;
  }

  return 'The local voice session failed unexpectedly.';
}

function formatRtviMessageError(message: RTVIMessage): string {
  if (typeof message.data === 'string') {
    return message.data;
  }

  if (
    message.data &&
    typeof message.data === 'object' &&
    'error' in message.data &&
    typeof message.data.error === 'string'
  ) {
    return message.data.error;
  }

  return `${message.label}: ${message.type}`;
}

function VoiceTestPanelInner({
  agentId,
  agentLanguage,
  agentName,
  agentRole,
  agentVoiceId,
  client,
  configMessage,
  runnerStartUrl,
}: VoiceTestPanelProps & {
  client: PipecatClient;
  configMessage: string | null;
  runnerStartUrl: string | null;
}) {
  const transportState = usePipecatClientTransportState();
  const { messages } = usePipecatConversation();
  const [errorMessage, setErrorMessage] = useState<string | null>(configMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const cleanupInFlightRef = useRef<Promise<void> | null>(null);
  const hasHandledDisconnectRef = useRef(false);
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const visibleErrorMessageRef = useRef<string | null>(configMessage);
  const bootstrapBrowserVoiceConversation = useMemo(
    () =>
      createBrowserVoiceBootstrap({
        fetch: window.fetch.bind(window),
      }),
    [],
  );
  const updateBrowserVoiceConversationLifecycle = useMemo(
    () =>
      createBrowserVoiceConversationLifecycle({
        fetch: window.fetch.bind(window),
      }),
    [],
  );

  useEffect(() => {
    setErrorMessage(configMessage);
    visibleErrorMessageRef.current = configMessage;
  }, [configMessage]);

  function updateVisibleErrorMessage(nextMessage: string) {
    const resolvedMessage = resolveVisibleVoiceErrorMessage({
      currentMessage: visibleErrorMessageRef.current,
      nextMessage,
    });

    visibleErrorMessageRef.current = resolvedMessage;
    setErrorMessage(resolvedMessage);
  }

  useRTVIClientEvent(RTVIEvent.UserStartedSpeaking, () => {
    setUserSpeaking(true);
  });

  useRTVIClientEvent(RTVIEvent.UserStoppedSpeaking, () => {
    setUserSpeaking(false);
  });

  useRTVIClientEvent(RTVIEvent.BotStartedSpeaking, () => {
    setAgentSpeaking(true);
  });

  useRTVIClientEvent(RTVIEvent.BotStoppedSpeaking, () => {
    setAgentSpeaking(false);
  });

  useRTVIClientEvent(RTVIEvent.Error, (message) => {
    updateVisibleErrorMessage(formatRtviMessageError(message));
  });

  useRTVIClientEvent(RTVIEvent.MessageError, (message) => {
    updateVisibleErrorMessage(formatRtviMessageError(message));
  });

  useRTVIClientEvent(RTVIEvent.DeviceError, (error) => {
    updateVisibleErrorMessage(formatVoiceError(error));
  });

  useRTVIClientEvent(RTVIEvent.Disconnected, () => {
    if (!activeConversationIdRef.current || hasHandledDisconnectRef.current) {
      return;
    }

    void finalizeConversation({
      disconnectClient: false,
      endReason: browserConversationLifecycleEvents.agentEndSession,
      event: browserConversationLifecycleEvents.completed,
    });
  });

  const transcriptItems = useMemo<VoiceTranscriptItem[]>(() => {
    return messages
      .map((message, index) => {
        const text = getConversationMessageText(message);

        if (!text) {
          return null;
        }

        return {
          id: `${message.role}-${message.createdAt}-${index}`,
          role: message.role,
          text,
        };
      })
      .filter((message): message is VoiceTranscriptItem => message !== null);
  }, [messages]);

  const status = mapTransportStateToStatus(transportState);
  const canConnect = runnerStartUrl !== null && !isSubmitting && status !== 'ready';
  const canDisconnect = !isSubmitting && status !== 'disconnected';

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const isConnected = status === 'ready';
  const isLoading = isSubmitting || status === 'connecting';
  const isIdle = !isConnected && !isLoading;

  useEffect(() => {
    if (isConnected) {
      transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcriptItems, isConnected]);

  async function finalizeConversation(args: {
    disconnectClient: boolean;
    endReason?: string;
    errorMessage?: string;
    event: 'completed' | 'failed';
  }) {
    if (cleanupInFlightRef.current) {
      await cleanupInFlightRef.current;
      return;
    }

    const cleanupPromise = (async () => {
      const conversationId = activeConversationIdRef.current;

      hasHandledDisconnectRef.current = true;

      try {
        if (conversationId) {
          await updateBrowserVoiceConversationLifecycle({
            conversationId,
            endReason: args.endReason,
            errorMessage: args.errorMessage,
            event: args.event,
            runtimeSnapshot: {
              agent_name: agentName,
              language: agentLanguage,
              role: agentRole,
              voice_id: agentVoiceId,
            },
            transcriptMessages: transcriptItems.map((message) => ({
              content: message.text,
              role: message.role,
            })),
          });
        }
      } catch (error) {
        if (!args.errorMessage) {
          updateVisibleErrorMessage(formatVoiceError(error));
        }
      } finally {
        stopLocalMicrophoneTracks(client.tracks());

        if (args.disconnectClient) {
          try {
            await client.disconnect();
          } catch (error) {
            updateVisibleErrorMessage(formatVoiceError(error));
          }
        }

        activeConversationIdRef.current = null;
        setUserSpeaking(false);
        setAgentSpeaking(false);
        setIsSubmitting(false);
      }
    })();

    cleanupInFlightRef.current = cleanupPromise;

    try {
      await cleanupPromise;
    } finally {
      cleanupInFlightRef.current = null;
    }
  }

  async function handleConnect() {
    if (connectInFlightRef.current) {
      return;
    }

    if (!runnerStartUrl) {
      setErrorMessage(
        'The local runner URL is unavailable. Check NEXT_PUBLIC_VOICE_RUNNER_URL.',
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    visibleErrorMessageRef.current = null;

    const connectPromise = (async () => {
      try {
        const bootstrap = await bootstrapBrowserVoiceConversation({
          agentId,
        });

        activeConversationIdRef.current = bootstrap.conversationId;
        hasHandledDisconnectRef.current = false;

        client.enableCam(false);
        client.enableMic(true);
        await client.initDevices();
        await client.startBotAndConnect({
          endpoint: runnerStartUrl,
          requestData: bootstrap.requestData,
        });
        await updateBrowserVoiceConversationLifecycle({
          conversationId: bootstrap.conversationId,
          event: browserConversationLifecycleEvents.connected,
        });
      } catch (error) {
        const message = formatVoiceError(error);
        updateVisibleErrorMessage(message);
        await finalizeConversation({
          disconnectClient: true,
          errorMessage: message,
          event: browserConversationLifecycleEvents.failed,
        });
      } finally {
        connectInFlightRef.current = null;
        if (!cleanupInFlightRef.current) {
          setIsSubmitting(false);
        }
      }
    })();

    connectInFlightRef.current = connectPromise;
    await connectPromise;
  }

  async function handleDisconnect() {
    setIsSubmitting(true);
    await finalizeConversation({
      disconnectClient: true,
      endReason: browserConversationLifecycleEvents.userDisconnect,
      event: browserConversationLifecycleEvents.completed,
    });
  }

  return (
    <div className="agent-test-drawer-content">
      <PipecatClientAudio />

      {errorMessage && (
        <div className="notice notice-danger voice-error-block" style={{ marginBottom: '16px' }}>
          {errorMessage}
        </div>
      )}

      {/* STATE A: INITIAL IDLE (Drawer Just Opened) */}
      {isIdle && (
        <div className="agent-test-idle-container">
          <div className="agent-test-mic-circle">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </div>
          <button
            className="button button-lg agent-test-connect-btn"
            disabled={!canConnect}
            onClick={handleConnect}
            type="button"
          >
            Connect
          </button>
          <p className="agent-test-hint">Click to start voice session</p>
        </div>
      )}

      {/* STATE B: CONNECTING / LOADING */}
      {isLoading && (
        <div className="agent-test-loading-container">
          <div className="agent-test-spinner" />
          <p className="agent-test-loading-text">
            {isSubmitting ? 'Establishing connection...' : 'Initializing local runner...'}
          </p>
        </div>
      )}

      {/* STATE C: CONNECTED / ACTIVE SESSION */}
      {isConnected && (
        <div className="agent-test-active-container">
          {/* Top Status Bar */}
          <div className="agent-test-status-bar">
            <div className="agent-test-live-indicator">
              <span className="status-dot" style={{ backgroundColor: '#16a34a' }} />
              Connected
            </div>
            <div className="voice-speaker-state">
              <span className={`voice-speaker-pill${userSpeaking ? ' is-active' : ''}`}>
                User {userSpeaking ? 'speaking' : 'idle'}
              </span>
              <span className={`voice-speaker-pill${agentSpeaking ? ' is-active' : ''}`}>
                Agent {agentSpeaking ? 'speaking' : 'idle'}
              </span>
            </div>
          </div>

          {/* Live Transcript Box (Fills Vertical Room) */}
          <div className="agent-test-transcript-box">
            {transcriptItems.length > 0 ? (
              <div className="voice-transcript-list">
                {transcriptItems.map((message) => (
                  <article
                    className={`voice-transcript-item voice-transcript-item-${message.role}`}
                    key={message.id}
                  >
                    <div className="voice-transcript-meta">
                      {message.role === 'user'
                        ? 'You'
                        : message.role === 'assistant'
                          ? 'Agent'
                          : 'System'}
                    </div>
                    <p className="voice-transcript-text">{message.text}</p>
                  </article>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            ) : (
              <div className="empty-state" style={{ margin: 'auto' }}>
                <div className="notice">
                  Speak to your agent to see live user and agent transcript messages here.
                </div>
              </div>
            )}
          </div>

          {/* Bottom Fixed Disconnect Button */}
          <div className="agent-test-disconnect-footer">
            <button
              className="button-secondary button-danger-outline agent-test-disconnect-btn"
              disabled={!canDisconnect}
              onClick={handleDisconnect}
              type="button"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VoiceTestPanel(props: VoiceTestPanelProps) {
  const [client, setClient] = useState<PipecatClient | null>(null);

  const config = useMemo(
    () =>
      resolveVoiceRunnerConfig(process.env.NEXT_PUBLIC_VOICE_RUNNER_URL),
    [],
  );

  useEffect(() => {
    const nextClient = createVoiceClient();

    setClient(nextClient);

    return () => {
      stopLocalMicrophoneTracks(nextClient.tracks());
      void nextClient.disconnect();
    };
  }, []);

  if (!client) {
    return (
      <div className="agent-test-loading-container">
        <div className="agent-test-spinner" />
        <p className="agent-test-loading-text">Preparing voice client...</p>
      </div>
    );
  }

  return (
    <PipecatClientProvider client={client}>
      <VoiceTestPanelInner
        {...props}
        client={client}
        configMessage={config.kind === 'invalid' ? config.message : null}
        runnerStartUrl={config.kind === 'valid' ? config.startUrl : null}
      />
    </PipecatClientProvider>
  );
}
