'use client';

import {
  PipecatClientAudio,
  PipecatClientProvider,
  usePipecatConversation,
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
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
  stopLocalMicrophoneTracks,
} from '../../../../../lib/voice/session';
import {
  abandonVoiceSessionPrestart,
  isVoiceSessionPrestartFresh,
  prepareVoiceSessionPrestart,
  retainVoiceSessionPrestart,
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
 * Connect can wait on a cold runner; never hang forever.
 */
const RUNNER_START_TIMEOUT_MS = 90_000;

const CONNECT_PROGRESS_STAGE_ORDER = [
  {
    id: 'preparingSession',
    label: 'Preparing session…',
  },
  {
    id: 'startingSpeechServices',
    label: 'Starting speech recognition and voice…',
  },
  {
    id: 'joiningCall',
    label: 'Joining audio call…',
  },
  {
    id: 'enablingMicrophone',
    label: 'Enabling microphone…',
  },
  {
    id: 'startingAgent',
    label: 'Starting agent…',
  },
] as const;

type ConnectProgressStageId = (typeof CONNECT_PROGRESS_STAGE_ORDER)[number]['id'];

const connectProgressStages = Object.fromEntries(
  CONNECT_PROGRESS_STAGE_ORDER.map((stage) => [stage.id, stage.label]),
) as Record<ConnectProgressStageId, string>;

function resolveConnectProgressStageIndex(message: string | null): number {
  if (!message) {
    return 0;
  }

  const index = CONNECT_PROGRESS_STAGE_ORDER.findIndex(
    (stage) => stage.label === message,
  );
  return index >= 0 ? index : 0;
}

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
  // After Daily join, initDevices() → startCamera() is illegal. enableMic
  // maps to setLocalAudio on the live call object.
  args.client.enableMic(true);
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
  const connectGenerationRef = useRef(0);
  const prejoinedSessionRef = useRef<PrejoinedVoiceSession | null>(null);
  const prejoinInFlightRef = useRef<Promise<void> | null>(null);
  /** Settles when PipecatClient.connect() resolves (Daily + BotReady). */
  const prejoinBotReadyRef = useRef<Promise<void> | null>(null);
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
    const releasePrestart = retainVoiceSessionPrestart(agentId);
    return () => {
      prejoinedSessionRef.current = null;
      prejoinBotReadyRef.current = null;
      releasePrestart();
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
      prejoinBotReadyRef.current = null;
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

  // Prestart + muted Daily join while the drawer is idle so Connect only arms.
  // Do NOT depend on transportStatus: our own connect() flips it off
  // "disconnected", which would cancel/reconnect in a loop and hang Connect.
  //
  // PipecatClient.connect() resolves on BotReady (after WebRTC). Remounts
  // (React Strict Mode) must not disconnect a successful join — that forced a
  // full second Daily+BotReady cycle before Connect could finish.
  useEffect(() => {
    if (sessionArmed || !runnerStartUrl) {
      return;
    }

    if (prejoinedSessionRef.current) {
      return;
    }

    let cancelled = false;
    const prejoinPromise = (async () => {
      // Strict Mode remount: wait for the previous attempt to finish.
      const prior = prejoinInFlightRef.current;
      if (prior) {
        try {
          await prior;
        } catch {
          // Prior failure is fine; this attempt continues.
        }
      }
      if (cancelled || prejoinedSessionRef.current || sessionArmedRef.current) {
        return;
      }

      try {
        const prepared = await prepareVoiceSessionPrestart({
          agentId,
          fetch: window.fetch.bind(window),
          runnerBaseUrlHint: runnerBaseUrl,
          startUrl: runnerStartUrl,
        });

        if (!prepared || sessionArmedRef.current) {
          return;
        }

        if (prejoinedSessionRef.current) {
          return;
        }

        if (client.connected || client.state === 'ready') {
          prejoinedSessionRef.current = {
            bootstrap: prepared.bootstrap,
            startResponse: prepared.startResponse,
            startedAtMs: prepared.startedAtMs,
          };
          return;
        }

        if (client.state === 'connecting') {
          // Prior attempt owns the in-flight join; wait for BotReady, then cache.
          const pendingBotReady = prejoinBotReadyRef.current;
          if (pendingBotReady) {
            await withTimeout(
              pendingBotReady,
              RUNNER_START_TIMEOUT_MS,
              'Daily pre-join timed out while waking the voice service.',
            );
            if (!sessionArmedRef.current) {
              prejoinedSessionRef.current = {
                bootstrap: prepared.bootstrap,
                startResponse: prepared.startResponse,
                startedAtMs: prepared.startedAtMs,
              };
            }
            return;
          }

          // Connecting without an owned BotReady promise — reset and join ourselves
          // instead of caching a "ready" prejoin that is still mid-handshake.
          try {
            await client.disconnect();
          } catch {
            // Continue to a fresh connect below.
          }
          if (cancelled || sessionArmedRef.current) {
            return;
          }
        }

        if (cancelled) {
          // Remount successor will reuse the module-level prestart and join.
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
        const prejoinTiming = createBrowserStartupTimingTracker();
        prejoinTiming.mark('daily_prejoin_started');
        connectTimingRef.current?.mark('daily_prejoin_started');

        const connectPromise = client.connect(dailyConnectParams);
        prejoinBotReadyRef.current = connectPromise.then(
          () => undefined,
          () => undefined,
        );

        await withTimeout(
          connectPromise,
          RUNNER_START_TIMEOUT_MS,
          'Daily pre-join timed out while waking the voice service.',
        );

        if (sessionArmedRef.current) {
          return;
        }

        // Cache even when this effect instance was cancelled: remounts must
        // reclaim the live Daily session instead of disconnecting and retrying.
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
        prejoinBotReadyRef.current = null;
        try {
          await client.disconnect();
        } catch {
          // Best-effort reset after a failed prejoin.
        }
      }
    })();

    prejoinInFlightRef.current = prejoinPromise;
    void prejoinPromise.finally(() => {
      if (prejoinInFlightRef.current === prejoinPromise) {
        prejoinInFlightRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      // Do not disconnect here. Panel unmount owns teardown; remounts reclaim.
    };
  }, [agentId, client, runnerBaseUrl, runnerStartUrl, sessionArmed]);

  const canConnect =
    runnerStartUrl !== null &&
    runnerBaseUrl !== null &&
    !isSubmitting &&
    !sessionArmed;
  const canDisconnect = !isSubmitting && sessionArmed;

  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const isConnected = sessionArmed;
  const isLoading = isSubmitting && !sessionArmed;
  const isIdle = !sessionArmed && !isSubmitting;
  const connectProgressIndex = resolveConnectProgressStageIndex(
    connectProgressMessage,
  );
  const connectProgressLabel =
    connectProgressMessage ?? connectProgressStages.preparingSession;

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

      // Unlock UI before any network/teardown awaits so Connect/Disconnect cannot
      // stick on a hung lifecycle request.
      stopLocalMicrophoneTracks(client.tracks());
      activeConversationIdRef.current = null;
      prejoinedSessionRef.current = null;
      prejoinBotReadyRef.current = null;
      sessionArmedRef.current = false;
      setSessionArmed(false);
      setUserSpeaking(false);
      setAgentSpeaking(false);
      setIsSubmitting(false);
      setConnectProgressMessage(null);

      try {
        if (conversationId) {
          await withTimeout(
            updateBrowserVoiceConversationLifecycle({
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
            }),
            15_000,
            'Timed out while saving the conversation.',
          );
        }
      } catch (error) {
        if (!args.errorMessage) {
          updateVisibleErrorMessage(formatVoiceError(error));
        }
      }

      if (args.disconnectClient) {
        try {
          await client.disconnect();
        } catch (error) {
          updateVisibleErrorMessage(formatVoiceError(error));
        }
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

    const generation = ++connectGenerationRef.current;
    setIsSubmitting(true);
    setErrorMessage(null);
    visibleErrorMessageRef.current = null;
    setConnectProgressMessage(connectProgressStages.preparingSession);
    connectTimingRef.current = createBrowserStartupTimingTracker();
    connectTimingRef.current.mark('connect_clicked');

    const connectPromise = (async () => {
      const isCurrentAttempt = () =>
        generation === connectGenerationRef.current;

      try {
        // Prefer a muted Daily pre-join started while the drawer was open.
        if (prejoinInFlightRef.current) {
          setConnectProgressMessage(connectProgressStages.joiningCall);
          await withTimeout(
            prejoinInFlightRef.current,
            RUNNER_START_TIMEOUT_MS,
            'The voice service did not respond in time. Please try again in a moment.',
          );
        }
        if (!isCurrentAttempt()) {
          return;
        }
        if (prejoinBotReadyRef.current) {
          setConnectProgressMessage(connectProgressStages.startingAgent);
          await withTimeout(
            prejoinBotReadyRef.current,
            RUNNER_START_TIMEOUT_MS,
            'The voice service did not respond in time. Please try again in a moment.',
          );
        }
        if (!isCurrentAttempt()) {
          return;
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
          if (!isCurrentAttempt()) {
            return;
          }
          connectTimingRef.current?.mark('conversation_creation_finished');
          connectTimingRef.current?.mark('session_token_finished');
          connectTimingRef.current?.mark('daily_prejoin_started');
          connectTimingRef.current?.mark('daily_prejoin_connected');
          connectTimingRef.current?.mark('webrtc_connected');
          connectTimingRef.current?.mark('worker_client_ready');

          activeConversationIdRef.current = existingPrejoin.bootstrap.conversationId;
          hasHandledDisconnectRef.current = false;

          setConnectProgressMessage(connectProgressStages.enablingMicrophone);
          await armSessionAfterConnect({
            client,
            onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
          });
          if (!isCurrentAttempt()) {
            return;
          }
          sessionArmedRef.current = true;
          setSessionArmed(true);
          // Unlock Disconnect immediately; lifecycle persistence must not gate UI.
          setIsSubmitting(false);
          setConnectProgressMessage(null);
          connectTimingRef.current?.logSummary('success');
          connectTimingRef.current = null;
          prejoinedSessionRef.current = null;
          prejoinBotReadyRef.current = null;
          try {
            await updateBrowserVoiceConversationLifecycle({
              conversationId: existingPrejoin.bootstrap.conversationId,
              event: browserConversationLifecycleEvents.connected,
            });
          } catch (error) {
            updateVisibleErrorMessage(formatVoiceError(error));
          }
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
        } else if (
          client.connected ||
          (client.state !== 'disconnected' &&
            client.state !== 'initialized' &&
            client.state !== 'initializing')
        ) {
          // Prejoin aborted mid-connect without caching a session — reset
          // before the cold path tries to join again.
          try {
            await client.disconnect();
          } catch {
            // Continue with cold start.
          }
        }

        if (!isCurrentAttempt()) {
          return;
        }

        // Cold path: bootstrap + /start + Daily join on Connect.
        setConnectProgressMessage(connectProgressStages.startingSpeechServices);
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
              setConnectProgressMessage(
                connectProgressStages.startingSpeechServices,
              );
              const startResponse = await client.startBot({
                endpoint: runnerStartUrl,
                requestData: asPipecatRequestData(bootstrap.requestData),
              });
              return { bootstrap, startResponse };
            })(),
            RUNNER_START_TIMEOUT_MS,
            'The voice service did not respond in time. Please try again in a moment.',
          ),
          (async () => {
            client.enableCam(false);
            client.enableMic(true);
            await client.initDevices();
          })(),
        ]);

        if (!isCurrentAttempt()) {
          return;
        }

        activeConversationIdRef.current = startSession.bootstrap.conversationId;
        hasHandledDisconnectRef.current = false;

        setConnectProgressMessage(connectProgressStages.joiningCall);
        connectTimingRef.current?.mark('transport_connect_started');
        const dailyConnectParams = buildDailyVoiceConnectParams(
          startSession.startResponse,
        );
        console.info('[voice] Daily start ok', {
          hasToken: Boolean(dailyConnectParams.token),
          url: dailyConnectParams.url,
        });
        await withTimeout(
          client.connect(dailyConnectParams),
          RUNNER_START_TIMEOUT_MS,
          'Unable to join the Daily room in time. Please try again.',
        );
        if (!isCurrentAttempt()) {
          return;
        }
        connectTimingRef.current?.mark('webrtc_connected');
        connectTimingRef.current?.mark('worker_client_ready');

        setConnectProgressMessage(connectProgressStages.enablingMicrophone);
        await armSessionAfterConnect({
          client,
          onTimingEvent: (_name) => connectTimingRef.current?.mark(_name),
        });
        if (!isCurrentAttempt()) {
          return;
        }
        sessionArmedRef.current = true;
        setSessionArmed(true);
        setIsSubmitting(false);
        setConnectProgressMessage(null);
        connectTimingRef.current?.logSummary('success');
        connectTimingRef.current = null;
        try {
          await updateBrowserVoiceConversationLifecycle({
            conversationId: startSession.bootstrap.conversationId,
            event: browserConversationLifecycleEvents.connected,
          });
        } catch (error) {
          updateVisibleErrorMessage(formatVoiceError(error));
        }
      } catch (error) {
        if (!isCurrentAttempt()) {
          return;
        }
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
        if (connectInFlightRef.current === connectPromise) {
          connectInFlightRef.current = null;
        }
        if (isCurrentAttempt()) {
          setConnectProgressMessage(null);
          if (!sessionArmedRef.current && !cleanupInFlightRef.current) {
            setIsSubmitting(false);
          }
        }
      }
    })();

    connectInFlightRef.current = connectPromise;
    await connectPromise;
  }

  async function handleCancelConnect() {
    if (!isSubmitting || sessionArmedRef.current) {
      return;
    }

    connectGenerationRef.current += 1;
    connectTimingRef.current?.logSummary('failed');
    connectTimingRef.current = null;
    setConnectProgressMessage(null);

    try {
      await client.disconnect();
    } catch {
      // Best-effort; finalize still resets UI.
    }

    await finalizeConversation({
      disconnectClient: true,
      endReason: browserConversationLifecycleEvents.userDisconnect,
      errorMessage: 'Connection cancelled.',
      event: browserConversationLifecycleEvents.failed,
    });
  }

  async function handleDisconnect() {
    connectGenerationRef.current += 1;
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
        <div
          aria-busy="true"
          aria-live="polite"
          className="agent-test-loading-container"
        >
          <div className="agent-test-loading-visual" aria-hidden="true">
            <span className="agent-test-loading-ring" />
            <span className="agent-test-loading-ring agent-test-loading-ring-delayed" />
            <span className="agent-test-loading-core" />
          </div>

          <div className="agent-test-loading-copy">
            <p
              className="agent-test-loading-text"
              key={connectProgressLabel}
            >
              {connectProgressLabel}
            </p>
            <ol className="agent-test-loading-steps">
              {CONNECT_PROGRESS_STAGE_ORDER.map((stage, index) => {
                const isComplete = index < connectProgressIndex;
                const isCurrent = index === connectProgressIndex;

                return (
                  <li
                    className={
                      isComplete
                        ? 'agent-test-loading-step is-complete'
                        : isCurrent
                          ? 'agent-test-loading-step is-current'
                          : 'agent-test-loading-step'
                    }
                    key={stage.id}
                  >
                    <span className="agent-test-loading-step-dot" />
                    <span className="agent-test-loading-step-label">
                      {stage.label.replace(/…$/, '')}
                    </span>
                  </li>
                );
              })}
            </ol>
            <button
              className="button-secondary agent-test-cancel-connect-btn"
              onClick={handleCancelConnect}
              type="button"
            >
              Cancel
            </button>
          </div>
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
