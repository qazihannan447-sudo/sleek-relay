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

import { createBrowserVoiceBootstrap } from '../../../../../lib/voice/browser-test';
import {
  getConversationMessageText,
  mapTransportStateToStatus,
  resolveVisibleVoiceErrorMessage,
  resolveVoiceRunnerConfig,
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
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const visibleErrorMessageRef = useRef<string | null>(configMessage);
  const bootstrapBrowserVoiceConversation = useMemo(
    () =>
      createBrowserVoiceBootstrap({
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

        client.enableCam(false);
        client.enableMic(true);
        await client.initDevices();
        await client.startBotAndConnect({
          endpoint: runnerStartUrl,
          requestData: bootstrap.requestData,
        });
      } catch (error) {
        updateVisibleErrorMessage(formatVoiceError(error));
      } finally {
        connectInFlightRef.current = null;
        setIsSubmitting(false);
      }
    })();

    connectInFlightRef.current = connectPromise;
    await connectPromise;
  }

  async function handleDisconnect() {
    setIsSubmitting(true);

    try {
      await client.disconnect();
    } catch (error) {
      updateVisibleErrorMessage(formatVoiceError(error));
    } finally {
      setUserSpeaking(false);
      setAgentSpeaking(false);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="voice-test-layout">
      <PipecatClientAudio />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Local voice session</h2>
            <p className="panel-subtitle">
              Connect this agent to the existing SmallWebRTC runner at your
              local Pipecat worker.
            </p>
          </div>
          <div className="table-actions">
            <button
              className="button"
              disabled={!canConnect}
              onClick={handleConnect}
              type="button"
            >
              {isSubmitting && status !== 'ready' ? 'Connecting...' : 'Connect'}
            </button>
            <button
              className="button-secondary"
              disabled={!canDisconnect}
              onClick={handleDisconnect}
              type="button"
            >
              Disconnect
            </button>
          </div>
        </div>

        <div className="voice-test-grid">
          <div className="voice-summary-card">
            <span className={`status-pill status-pill-${status}`}>
              <span className="status-dot" />
              {status}
            </span>
            <div className="muted-copy">
              Raw Pipecat transport state: <strong>{transportState}</strong>
            </div>
          </div>

          <div className="voice-summary-card">
            <div className="voice-speaker-state">
              <span className={`voice-speaker-pill${userSpeaking ? ' is-active' : ''}`}>
                User {userSpeaking ? 'speaking' : 'idle'}
              </span>
              <span className={`voice-speaker-pill${agentSpeaking ? ' is-active' : ''}`}>
                Agent {agentSpeaking ? 'speaking' : 'idle'}
              </span>
            </div>
          </div>
        </div>

        <div className="kv-list">
          <div className="kv-row">
            <span className="kv-label">Agent</span>
            <span className="kv-value">{agentName}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Role</span>
            <span className="kv-value">{agentRole}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Language</span>
            <span className="kv-value">{agentLanguage.toUpperCase()}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Configured voice</span>
            <span className="kv-value">{agentVoiceId || 'Not configured'}</span>
          </div>
          <div className="kv-row">
            <span className="kv-label">Runner</span>
            <span className="kv-value">
              {runnerStartUrl ?? 'Missing NEXT_PUBLIC_VOICE_RUNNER_URL'}
            </span>
          </div>
        </div>

        {errorMessage ? (
          <div className="notice notice-danger voice-error-block">{errorMessage}</div>
        ) : (
          <div className="notice voice-error-block">
            On connect, the portal first creates a tenant-scoped browser test
            conversation and issues a short-lived voice session token before the
            local SmallWebRTC runner is contacted. Camera and video stay
            disabled for this local validation flow.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">Live transcript</h2>
            <p className="panel-subtitle">
              Transcript messages stream from the active Pipecat session only in
              this local browser test. Nothing is persisted yet.
            </p>
          </div>
        </div>

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
          </div>
        ) : (
          <div className="empty-state">
            <div className="notice">
              Connect to the local runner and start speaking to see live user
              and agent transcript messages here.
            </div>
          </div>
        )}
      </section>
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
      void nextClient.disconnect();
    };
  }, []);

  if (!client) {
    return (
      <div className="voice-test-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">Local voice session</h2>
              <p className="panel-subtitle">
                Preparing the browser voice client for the local SmallWebRTC
                runner.
              </p>
            </div>
          </div>

          <div className="notice">
            The voice test controls will finish loading after this page hydrates
            in the browser.
          </div>
        </section>
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
