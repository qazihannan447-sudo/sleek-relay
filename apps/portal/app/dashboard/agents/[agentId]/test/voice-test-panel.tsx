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
  StartBotError,
  TransportStartError,
  type RTVIMessage,
} from '@pipecat-ai/client-js';
import { DailyTransport } from '@pipecat-ai/daily-transport';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  asPipecatRequestData,
  browserConversationLifecycleEvents,
  buildDailyVoiceConnectParams,
  createBrowserStartupTimingTracker,
  createBrowserVoiceConversationLifecycle,
  type BrowserStartupTimingTracker,
} from '../../../../../lib/voice/browser-test';
import {
  getConversationMessageText,
  mapTransportStateToStatus,
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
  stopLocalMicrophoneTracks,
} from '../../../../../lib/voice/session';
import { takeBrowserVoicePrebootstrap } from '../../../../../lib/voice/warm-connect';

type VoiceTestPanelProps = {
  agentFallbackMessage: string;
  agentGreeting: string;
  agentId: string;
  agentLanguage: string;
  agentName: string;
  agentRole: string;
  agentSpecialInstructions: string;
  agentTone: string;
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
    transport: new DailyTransport({
      bufferLocalAudioUntilBotReady: true,
    }),
  });
}

/**
 * A hosted runner that spun down after idle can take tens of seconds to wake.
 * Surface that instead of a silent spinner, and never hang forever.
 */
const RUNNER_START_SLOW_NOTICE_MS = 4_000;
const RUNNER_START_TIMEOUT_MS = 90_000;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function formatVoiceError(error: unknown): string {
  if (error instanceof DeviceError) {
    return error.message;
  }

  if (error instanceof StartBotError) {
    return error.message
      ? `Voice runner start failed: ${error.message}`
      : 'Voice runner /start failed. Check Render logs and DAILY_API_KEY.';
  }

  if (
    error instanceof TransportStartError ||
    (error instanceof Error &&
      error.message === 'Unable to connect to transport')
  ) {
    return (
      'Unable to join the Daily room. Check the browser console for ' +
      '"Failed to join room", confirm DAILY_API_KEY on Render, and check ' +
      'Render logs right after Connect for bot crashes.'
    );
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

  return 'The voice session failed unexpectedly.';
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
  agentFallbackMessage,
  agentGreeting,
  agentId,
  agentLanguage,
  agentName,
  agentRole,
  agentSpecialInstructions,
  agentTone,
  agentVoiceId,
  client,
  configMessage,
  runnerBaseUrl,
  runnerStartUrl,
}: VoiceTestPanelProps & {
  client: PipecatClient;
  configMessage: string | null;
  runnerBaseUrl: string | null;
  runnerStartUrl: string | null;
}) {
  const transportState = usePipecatClientTransportState();
  const { messages } = usePipecatConversation();
  const [errorMessage, setErrorMessage] = useState<string | null>(configMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectProgressMessage, setConnectProgressMessage] = useState<
    string | null
  >(null);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const cleanupInFlightRef = useRef<Promise<void> | null>(null);
  const hasHandledDisconnectRef = useRef(false);
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const connectTimingRef = useRef<BrowserStartupTimingTracker | null>(null);
  const visibleErrorMessageRef = useRef<string | null>(configMessage);
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

  // Keep mic devices warm when the drawer opens; page-level prebootstrap may
  // already be in flight for this agentId.
  useEffect(() => {
    let cancelled = false;

    async function warmDevices() {
      try {
        client.enableCam(false);
        client.enableMic(true);
        await client.initDevices();
      } catch {
        // Permission denial or device errors surface again on Connect.
      }

      if (cancelled) {
        return;
      }
    }

    void warmDevices();

    return () => {
      cancelled = true;
    };
  }, [client]);

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

  useRTVIClientEvent(RTVIEvent.Connected, () => {
    connectTimingRef.current?.mark('webrtc_connected');
  });

  useRTVIClientEvent(RTVIEvent.BotReady, () => {
    connectTimingRef.current?.mark('worker_client_ready');
    connectTimingRef.current?.logSummary('success');
    connectTimingRef.current = null;
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
  const canConnect =
    runnerStartUrl !== null &&
    runnerBaseUrl !== null &&
    !isSubmitting &&
    status !== 'ready';
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

  useEffect(() => {
    if (
      status === 'ready' &&
      connectTimingRef.current &&
      !connectTimingRef.current.hasMark('worker_client_ready')
    ) {
      connectTimingRef.current.mark('worker_client_ready');
      connectTimingRef.current.logSummary('success');
      connectTimingRef.current = null;
    }
  }, [status]);

  async function finalizeConversation(args: {
    disconnectClient: boolean;
    endReason?: string;
    errorMessage?: string;
    event: 'completed' | 'failed';
    keepalive?: boolean;
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
            keepalive: args.keepalive,
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

  const finalizeConversationRef = useRef(finalizeConversation);
  finalizeConversationRef.current = finalizeConversation;

  useEffect(() => {
    function handlePageHide() {
      if (!activeConversationIdRef.current || hasHandledDisconnectRef.current) {
        return;
      }

      void finalizeConversationRef.current({
        disconnectClient: true,
        endReason: browserConversationLifecycleEvents.userDisconnect,
        event: browserConversationLifecycleEvents.completed,
        keepalive: true,
      });
    }

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);

      if (!activeConversationIdRef.current || hasHandledDisconnectRef.current) {
        return;
      }

      void finalizeConversationRef.current({
        disconnectClient: true,
        endReason: browserConversationLifecycleEvents.userDisconnect,
        event: browserConversationLifecycleEvents.completed,
        keepalive: true,
      });
    };
  }, []);

  async function handleConnect() {
    if (connectInFlightRef.current) {
      return;
    }

    if (!runnerStartUrl || !runnerBaseUrl) {
      setErrorMessage(
        'The local runner URL is unavailable. Check NEXT_PUBLIC_VOICE_RUNNER_URL.',
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    visibleErrorMessageRef.current = null;
    setConnectProgressMessage(null);
    connectTimingRef.current = createBrowserStartupTimingTracker();
    connectTimingRef.current.mark('connect_clicked');

    const connectPromise = (async () => {
      let slowStartNoticeTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        // Prefer page-level prebootstrap (conversation/token/runtime already
        // prepared). Mic init overlaps that wait when prepare is still running.
        const [bootstrap] = await Promise.all([
          takeBrowserVoicePrebootstrap({
            agentId,
            fetch: window.fetch.bind(window),
            onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
            runnerBaseUrlHint: runnerBaseUrl,
          }),
          (async () => {
            client.enableCam(false);
            client.enableMic(true);
            await client.initDevices();
          })(),
        ]);

        activeConversationIdRef.current = bootstrap.conversationId;
        hasHandledDisconnectRef.current = false;

        connectTimingRef.current?.mark('transport_connect_started');
        slowStartNoticeTimer = setTimeout(() => {
          setConnectProgressMessage(
            'Waking the voice service... the first connect after it has been idle can take up to a minute.',
          );
        }, RUNNER_START_SLOW_NOTICE_MS);
        // Daily: /start creates the room + spawns the bot; connect joins Daily
        // with url/token (mapped from Pipecat's dailyRoom/dailyToken fields).
        const startResponse = await withTimeout(
          client.startBot({
            endpoint: runnerStartUrl,
            requestData: asPipecatRequestData(bootstrap.requestData),
          }),
          RUNNER_START_TIMEOUT_MS,
          'The voice service did not respond in time. It may still be waking up; please try again in a moment.',
        );
        clearTimeout(slowStartNoticeTimer);
        setConnectProgressMessage(null);
        const dailyConnectParams = buildDailyVoiceConnectParams(startResponse);
        console.info('[voice] Daily start ok', {
          hasToken: Boolean(dailyConnectParams.token),
          url: dailyConnectParams.url,
        });
        await client.connect(dailyConnectParams);
        connectTimingRef.current?.mark('webrtc_connected');
        await updateBrowserVoiceConversationLifecycle({
          conversationId: bootstrap.conversationId,
          event: browserConversationLifecycleEvents.connected,
        });
      } catch (error) {
        const message = formatVoiceError(error);
        updateVisibleErrorMessage(message);
        connectTimingRef.current?.logSummary('failed');
        connectTimingRef.current = null;
        await finalizeConversation({
          disconnectClient: true,
          errorMessage: message,
          event: browserConversationLifecycleEvents.failed,
        });
      } finally {
        clearTimeout(slowStartNoticeTimer);
        setConnectProgressMessage(null);
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

          <div className="agent-test-config-preview">
            <p className="agent-test-config-preview-title">
              Saved behavior used on Connect
            </p>
            <p className="agent-test-config-preview-note">
              Unsaved form edits are ignored. Save the agent first, then connect.
            </p>
            <dl className="agent-test-config-list">
              <div>
                <dt>Greeting</dt>
                <dd>{agentGreeting.trim() || 'Default: Hello, how can I help you today?'}</dd>
              </div>
              <div>
                <dt>Tone</dt>
                <dd>{agentTone.trim() || 'Friendly'}</dd>
              </div>
              <div>
                <dt>Special instructions</dt>
                <dd>{agentSpecialInstructions.trim() || 'None saved'}</dd>
              </div>
              <div>
                <dt>Fallback message</dt>
                <dd>{agentFallbackMessage.trim() || 'None saved'}</dd>
              </div>
            </dl>
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
            {connectProgressMessage ??
              (isSubmitting
                ? 'Establishing connection...'
                : 'Waiting for the agent to join...')}
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
        runnerBaseUrl={config.kind === 'valid' ? config.baseUrl : null}
        runnerStartUrl={config.kind === 'valid' ? config.startUrl : null}
      />
    </PipecatClientProvider>
  );
}
