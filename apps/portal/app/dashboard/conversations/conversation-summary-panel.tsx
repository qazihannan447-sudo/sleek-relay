'use client';

import { useEffect, useRef, useState } from 'react';

import type { ConversationSummaryUiState } from '../../../lib/conversations/conversation-summary-state';

type ConversationSummaryPanelProps = {
  conversationId: string;
  initialState: ConversationSummaryUiState;
  initialSummary: string;
};

type SummaryStatusResponse = {
  error?: string;
  state?: ConversationSummaryUiState;
  summary?: string | null;
};

const POLL_INTERVAL_MS = 1_500;
const POLL_TIMEOUT_MS = 45_000;

function formatSummaryCopy(args: {
  errorMessage: string | null;
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(initialState === 'generating');

  useEffect(() => {
    setState(initialState);
    setSummary(initialSummary);
    setErrorMessage(null);
    setIsPolling(initialState === 'generating');
  }, [conversationId, initialState, initialSummary]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();

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
          setErrorMessage(
            payload.error?.trim() ||
              'Unable to refresh the conversation summary right now.',
          );
        } else {
          if (typeof payload.summary === 'string' && payload.summary.trim()) {
            setSummary(payload.summary.trim());
          }

          if (
            payload.state === 'ready' ||
            payload.state === 'empty' ||
            payload.state === 'waiting' ||
            payload.state === 'generating'
          ) {
            setState(payload.state);
          }

          if (payload.state === 'ready' || payload.state === 'empty') {
            setErrorMessage(null);
            setIsPolling(false);
            return;
          }
        }
      } catch {
        if (!cancelled) {
          setErrorMessage('Unable to refresh the conversation summary right now.');
        }
      }

      if (cancelled) {
        return;
      }

      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setState((current) => (current === 'generating' ? 'ready' : current));
        setErrorMessage(
          'Summary generation is taking longer than expected. Showing the current draft summary.',
        );
        setIsPolling(false);
        return;
      }

      timeoutId = setTimeout(() => {
        void pollSummary();
      }, POLL_INTERVAL_MS);
    }

    void pollSummary();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [conversationId, isPolling]);

  const copy = formatSummaryCopy({
    errorMessage,
    state,
    summary,
  });

  return (
    <section className="drawer-section">
      <h3 className="drawer-section-title">Summary</h3>
      {state === 'generating' && !errorMessage ? (
        <p className="muted-copy" style={{ marginBottom: '8px' }}>
          Generating summary from the transcript...
        </p>
      ) : null}
      {errorMessage ? (
        <p className="muted-copy" style={{ marginBottom: '8px' }}>
          {errorMessage}
        </p>
      ) : null}
      <p className="detail-block-copy">{copy}</p>
    </section>
  );
}
