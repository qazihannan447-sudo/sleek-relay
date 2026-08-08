'use client';

import { useEffect, useState } from 'react';

import type { ConversationSummaryUiState } from '../../../lib/conversations/conversation-summary-state';

type ConversationSummaryPanelProps = {
  conversationId: string;
  initialState: ConversationSummaryUiState;
  initialSummary: string;
};

type SummaryStatusResponse = {
  error?: string;
  message?: string;
  state?: ConversationSummaryUiState;
  summary?: string | null;
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

function formatSummaryCopy(args: {
  state: ConversationSummaryUiState;
  summary: string;
}): string {
  if (args.state === 'waiting') {
    return 'Summary will appear after this session ends.';
  }

  if (args.state === 'empty') {
    return 'No transcript was stored, so a summary could not be generated.';
  }

  if (args.state === 'generating') {
    if (args.summary && args.summary !== 'Not set') {
      return args.summary;
    }

    return 'Generating summary from the transcript...';
  }

  return args.summary?.trim() ? args.summary : 'Not set';
}

export function ConversationSummaryPanel({
  conversationId,
  initialState,
  initialSummary,
}: ConversationSummaryPanelProps) {
  const [state, setState] = useState(initialState);
  const [summary, setSummary] = useState(initialSummary);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(initialState === 'generating');

  useEffect(() => {
    setState(initialState);
    setSummary(initialSummary);
    setStatusMessage(null);
    setIsPolling(initialState === 'generating');
  }, [conversationId, initialState, initialSummary]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    let cancelled = false;
    let pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const hardStopId = setTimeout(() => {
      if (cancelled) {
        return;
      }

      setState((current) => (current === 'generating' ? 'ready' : current));
      setStatusMessage(
        'Summary generation is taking longer than expected. Showing the current draft summary.',
      );
      setIsPolling(false);
    }, POLL_TIMEOUT_MS);

    async function pollSummary() {
      try {
        const response = await fetch(
          `/api/voice/conversations/${conversationId}/summary`,
          {
            cache: 'no-store',
            method: 'GET',
          },
        );
        const payload = (await response.json()) as SummaryStatusResponse;

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setStatusMessage(
            payload.error?.trim() ||
              'Unable to refresh the conversation summary right now.',
          );
          setState('ready');
          setIsPolling(false);
          return;
        }

        if (typeof payload.summary === 'string' && payload.summary.trim()) {
          setSummary(payload.summary.trim());
        }

        if (typeof payload.message === 'string' && payload.message.trim()) {
          setStatusMessage(payload.message.trim());
        }

        if (
          payload.state === 'ready' ||
          payload.state === 'empty' ||
          payload.state === 'waiting'
        ) {
          setState(payload.state);
          setIsPolling(false);
          return;
        }

        if (payload.state === 'generating') {
          setState('generating');
        }
      } catch {
        if (!cancelled) {
          setStatusMessage(
            'Unable to refresh the conversation summary right now.',
          );
          setState('ready');
          setIsPolling(false);
          return;
        }
      }

      if (cancelled) {
        return;
      }

      pollTimeoutId = setTimeout(() => {
        void pollSummary();
      }, POLL_INTERVAL_MS);
    }

    void pollSummary();

    return () => {
      cancelled = true;
      clearTimeout(hardStopId);
      if (pollTimeoutId) {
        clearTimeout(pollTimeoutId);
      }
    };
  }, [conversationId, isPolling]);

  const copy = formatSummaryCopy({
    state,
    summary,
  });

  return (
    <section className="drawer-section">
      <h3 className="drawer-section-title">Summary</h3>
      {state === 'generating' ? (
        <p className="muted-copy" style={{ marginBottom: '8px' }}>
          Generating summary from the transcript...
        </p>
      ) : null}
      {statusMessage ? (
        <p className="muted-copy" style={{ marginBottom: '8px' }}>
          {statusMessage}
        </p>
      ) : null}
      <p className="detail-block-copy">{copy}</p>
    </section>
  );
}
