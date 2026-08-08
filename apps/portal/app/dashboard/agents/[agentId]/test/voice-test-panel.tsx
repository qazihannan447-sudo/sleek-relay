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
  VOICE_SESSION_ARMED_MESSAGE_TYPE,
  type BrowserStartupTimingTracker,
  type BrowserVoiceBootstrapResult,
} from '../../../../../lib/voice/browser-test';
import {
  dedupeConsecutiveTranscriptMessages,
  getConversationMessageText,
  mapTransportStateToStatus,
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
  stopLocalMicrophoneTracks,
} from '../../../../../lib/voice/session';
import {
  abandonVoiceSessionPrestart,
  isVoiceSessionPrestartFresh,
  prepareVoiceSessionPrestart,
  takeBrowserVoicePrebootstrap,
  takeVoiceSessionPrestart,
} from '../../../../../lib/voice/warm-connect';

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
    // Mic stays off until Connect so Daily pre-join does not capture audio.
    enableMic: false,
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

type PrejoinedVoiceSession = {
  bootstrap: BrowserVoiceBootstrapResult;
  startResponse: unknown;
  startedAtMs: number;
};

async function armSessionAfterConnect(args: {
  client: PipecatClient;
  onTimingEvent?: (_name: 'session_arm_started' | 'session_armed') => void;
}): Promise<void> {
  args.onTimingEvent?.('session_arm_started');
  args.client.enableCam(false);
  args.client.enableMic(true);
  await args.client.initDevices();
  args.client.sendClientMessage(VOICE_SESSION_ARMED_MESSAGE_TYPE, {});
  args.onTimingEvent?.('session_armed');
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
  const [sessionArmed, setSessionArmed] = useState(false);
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
  const prejoinedSessionRef = useRef<PrejoinedVoiceSession | null>(null);
  const prejoinInFlightRef = useRef<Promise<void> | null>(null);
  const sessionArmedRef = useRef(false);
  const finalizeConversationRef = useRef<
    (_args: {
      disconnectClient: boolean;
      endReason?: string;
      errorMessage?: string;
      event: 'completed' | 'failed';
      keepalive?: boolean;
    }) => Promise<void>
  >(async () => {});
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

  useEffect(() => {
    return () => {
      prejoinedSessionRef.current = null;
      void abandonVoiceSessionPrestart({ agentId });
    };
  }, [agentId]);

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
    if (!sessionArmedRef.current) {
      connectTimingRef.current?.mark('daily_prejoin_connected');
    }
  });

  useRTVIClientEvent(RTVIEvent.BotReady, () => {
    connectTimingRef.current?.mark('worker_client_ready');
  });

  useRTVIClientEvent(RTVIEvent.Disconnected, () => {
    if (!sessionArmedRef.current) {
      // Pre-join teardown or abandon — conversation is finalized separately.
      prejoinedSessionRef.current = null;
      return;
    }

    if (!activeConversationIdRef.current || hasHandledDisconnectRef.current) {
      return;
    }

    void finalizeConversationRef.current({
      disconnectClient: false,
      endReason: browserConversationLifecycleEvents.agentEndSession,
      event: browserConversationLifecycleEvents.completed,
    });
  });

  const transcriptItems = useMemo<VoiceTranscriptItem[]>(() => {
    const items = messages
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

    // Opening greeting can briefly arrive as many BotOutput bubbles before
    // RTVI protocol negotiation completes; keep a single spoken turn.
    return dedupeConsecutiveTranscriptMessages(items);
  }, [messages]);

  const transportStatus = mapTransportStateToStatus(transportState);

  // Prestart + muted Daily join while the drawer is idle so Connect only arms.
  useEffect(() => {
    if (sessionArmed || !runnerStartUrl || transportStatus === 'error') {
      return;
    }

    if (prejoinedSessionRef.current || prejoinInFlightRef.current) {
      return;
    }

    if (transportStatus !== 'disconnected') {
      return;
    }

    let cancelled = false;

    const prejoinPromise = (async () => {
      try {
        const prepared = await prepareVoiceSessionPrestart({
          agentId,
          fetch: window.fetch.bind(window),
          startUrl: runnerStartUrl,
        });

        if (cancelled || !prepared || sessionArmed) {
          return;
        }

        client.enableCam(false);
        client.enableMic(false);
        const dailyConnectParams = buildDailyVoiceConnectParams(
          prepared.startResponse,
        );
        console.info('[voice] Daily prejoin start', {
          hasToken: Boolean(dailyConnectParams.token),
          url: dailyConnectParams.url,
        });
        // Track prejoin stages on a short-lived tracker when Connect has not
        // started yet; Connect timing tracker will also mark these if present.
        const prejoinTiming = createBrowserStartupTimingTracker();
        prejoinTiming.mark('daily_prejoin_started');
        connectTimingRef.current?.mark('daily_prejoin_started');
        await client.connect(dailyConnectParams);
        if (cancelled) {
          try {
            await client.disconnect();
          } catch {
            // Ignore disconnect errors during cancelled prejoin.
          }
          return;
        }

        prejoinTiming.mark('daily_prejoin_connected');
        prejoinTiming.mark('webrtc_connected');
        prejoinTiming.mark('worker_client_ready');
        connectTimingRef.current?.mark('daily_prejoin_connected');
        connectTimingRef.current?.mark('webrtc_connected');
        connectTimingRef.current?.mark('worker_client_ready');
        prejoinedSessionRef.current = {
          bootstrap: prepared.bootstrap,
          startResponse: prepared.startResponse,
          startedAtMs: prepared.startedAtMs,
        };
      } catch (error) {
        console.warn('[voice] Daily prejoin failed; Connect will cold-start', error);
        prejoinedSessionRef.current = null;
      } finally {
        prejoinInFlightRef.current = null;
      }
    })();

    prejoinInFlightRef.current = prejoinPromise;

    return () => {
      cancelled = true;
    };
  }, [agentId, client, runnerStartUrl, sessionArmed, transportStatus]);

  const canConnect =
    runnerStartUrl !== null &&
    runnerBaseUrl !== null &&
    !isSubmitting &&
    !sessionArmed;
  const canDisconnect = !isSubmitting && sessionArmed;

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Session UI is gated on Connect arming, not transport pre-join readiness.
  const isConnected = sessionArmed;
  const isLoading = isSubmitting && !sessionArmed;
  const isIdle = !sessionArmed && !isSubmitting;

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
        prejoinedSessionRef.current = null;
        sessionArmedRef.current = false;
        setSessionArmed(false);
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

  finalizeConversationRef.current = finalizeConversation;
  sessionArmedRef.current = sessionArmed;

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
        slowStartNoticeTimer = setTimeout(() => {
          setConnectProgressMessage(
            'Waking the voice service... the first connect after it has been idle can take up to a minute.',
          );
        }, RUNNER_START_SLOW_NOTICE_MS);

        // Prefer a muted Daily pre-join started while the drawer was open.
        if (prejoinInFlightRef.current) {
          await prejoinInFlightRef.current;
        }
        const existingPrejoin = prejoinedSessionRef.current;
        if (
          existingPrejoin &&
          isVoiceSessionPrestartFresh(existingPrejoin.startedAtMs)
        ) {
          // Claim the cached prestart entry so abandon does not double-finalize.
          await takeVoiceSessionPrestart({
            agentId,
            fetch: window.fetch.bind(window),
            onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
          });
          connectTimingRef.current?.mark('conversation_creation_finished');
          connectTimingRef.current?.mark('session_token_finished');
          connectTimingRef.current?.mark('daily_prejoin_started');
          connectTimingRef.current?.mark('daily_prejoin_connected');
          connectTimingRef.current?.mark('webrtc_connected');
          connectTimingRef.current?.mark('worker_client_ready');

          activeConversationIdRef.current = existingPrejoin.bootstrap.conversationId;
          hasHandledDisconnectRef.current = false;
          clearTimeout(slowStartNoticeTimer);
          setConnectProgressMessage(null);

          await armSessionAfterConnect({
            client,
            onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
          });
          sessionArmedRef.current = true;
          setSessionArmed(true);
          await updateBrowserVoiceConversationLifecycle({
            conversationId: existingPrejoin.bootstrap.conversationId,
            event: browserConversationLifecycleEvents.connected,
          });
          connectTimingRef.current?.logSummary('success');
          connectTimingRef.current = null;
          prejoinedSessionRef.current = null;
          return;
        }

        if (existingPrejoin) {
          // Expired pre-join: leave the room and cold-start below.
          prejoinedSessionRef.current = null;
          try {
            await client.disconnect();
          } catch {
            // Continue with cold start.
          }
          void abandonVoiceSessionPrestart({ agentId });
        }

        // Cold path: bootstrap + /start + Daily join on Connect.
        const [startSession] = await Promise.all([
          withTimeout(
            (async () => {
              const prestart = await takeVoiceSessionPrestart({
                agentId,
                fetch: window.fetch.bind(window),
                onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
              });
              if (prestart) {
                return {
                  bootstrap: prestart.bootstrap,
                  startResponse: prestart.startResponse,
                };
              }

              const bootstrap = await takeBrowserVoicePrebootstrap({
                agentId,
                fetch: window.fetch.bind(window),
                onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
                runnerBaseUrlHint: runnerBaseUrl,
              });
              const startResponse = await client.startBot({
                endpoint: runnerStartUrl,
                requestData: asPipecatRequestData(bootstrap.requestData),
              });
              return { bootstrap, startResponse };
            })(),
            RUNNER_START_TIMEOUT_MS,
            'The voice service did not respond in time. It may still be waking up; please try again in a moment.',
          ),
          (async () => {
            client.enableCam(false);
            client.enableMic(true);
            await client.initDevices();
          })(),
        ]);

        activeConversationIdRef.current = startSession.bootstrap.conversationId;
        hasHandledDisconnectRef.current = false;

        clearTimeout(slowStartNoticeTimer);
        setConnectProgressMessage(null);
        connectTimingRef.current?.mark('transport_connect_started');
        const dailyConnectParams = buildDailyVoiceConnectParams(
          startSession.startResponse,
        );
        console.info('[voice] Daily start ok', {
          hasToken: Boolean(dailyConnectParams.token),
          url: dailyConnectParams.url,
        });
        await client.connect(dailyConnectParams);
        connectTimingRef.current?.mark('webrtc_connected');
        connectTimingRef.current?.mark('worker_client_ready');

        await armSessionAfterConnect({
          client,
          onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
        });
        sessionArmedRef.current = true;
        setSessionArmed(true);
        await updateBrowserVoiceConversationLifecycle({
          conversationId: startSession.bootstrap.conversationId,
          event: browserConversationLifecycleEvents.connected,
        });
        connectTimingRef.current?.logSummary('success');
        connectTimingRef.current = null;
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
