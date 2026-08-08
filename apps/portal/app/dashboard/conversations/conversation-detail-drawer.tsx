'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useCallback, useRef, useState } from 'react';

import { formatConversationDuration } from '../../../lib/conversations/helpers';
import { formatTimestamp } from '../../../lib/format-timestamp';
import type { ConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';
import {
  buildConversationTimelineItems,
  formatFailureStageLabel,
  formatSessionEventTimestamp,
  formatStageDetailLabel,
  formatTurnChipSummary,
  type ConversationTurnDiagnostics,
  type ConversationMessageChipSide,
} from '../../../lib/conversations/conversation-timeline';
import { ConversationSummaryPanel } from './conversation-summary-panel';

type ConversationDetailDrawerProps = {
  detailData: ConversationDetailPageData | null;
};

function formatValue(value: string | null | undefined): string {
  return value?.trim() ? value : 'Not set';
}

function TurnDiagnosticsDetails({ turn }: { turn: ConversationTurnDiagnostics }) {
  if (turn.stages.length === 0) {
    return (
      <p className="turn-chip-details-empty">No stage details were stored for this turn.</p>
    );
  }

  return (
    <ul className="turn-chip-details-list">
      {turn.stages.map((stage, index) => (
        <li key={`${turn.turnId}-${stage.stage}-${stage.label ?? stage.status}-${index}`}>
          <strong>{formatStageDetailLabel(stage)}</strong>
          <span>{stage.status}</span>
          {stage.durationMs != null ? <span>{stage.durationMs} ms</span> : null}
          {stage.provider ? <span>{stage.provider}</span> : null}
          {stage.retryCount != null ? <span>retries {stage.retryCount}</span> : null}
          {stage.errorCode ? <span>{stage.errorCode}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function TurnChip({
  turn,
  side,
}: {
  turn: ConversationTurnDiagnostics;
  side: ConversationMessageChipSide;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = formatTurnChipSummary(turn, side);

  return (
    <div className={`turn-chip turn-chip-${turn.status}`}>
      <button
        className="turn-chip-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>{summary}</span>
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded ? <TurnDiagnosticsDetails turn={turn} /> : null}
    </div>
  );
}

export function ConversationDetailDrawer({
  detailData,
}: ConversationDetailDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drawerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('conversationId');
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && detailData) {
        handleClose();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        detailData &&
        drawerRef.current &&
        !drawerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [detailData, handleClose]);

  if (!detailData || detailData.kind !== 'authenticated') {
    if (detailData && (detailData.kind === 'error' || detailData.kind === 'not-found')) {
      return (
        <div className="conversation-drawer-overlay" onClick={handleClose}>
          <div className="conversation-drawer-backdrop" />
          <aside
            className="conversation-drawer"
            onClick={(e) => e.stopPropagation()}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
          >
            <div className="conversation-drawer-header">
              <h2>Conversation unavailable</h2>
              <button
                className="conversation-drawer-close"
                onClick={handleClose}
                type="button"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
            <div className="conversation-drawer-body">
              <div className="notice notice-danger">
                {detailData.kind === 'error' ? detailData.message : 'The requested conversation is unavailable.'}
              </div>
            </div>
          </aside>
        </div>
      );
    }

    return null;
  }

  const { conversation, diagnostics, messages, transcriptState, latencyMetrics } =
    detailData;
  const timelineItems = buildConversationTimelineItems({
    diagnostics,
    messages,
  });
  const failure =
    conversation.status === 'failed' ? conversation.failure : null;
  const showLegacyLatencyNotice = diagnostics.isLegacyFallback;

  return (
    <div className="conversation-drawer-overlay" onClick={handleClose}>
      <div className="conversation-drawer-backdrop" />
      <aside
        className="conversation-drawer"
        onClick={(e) => e.stopPropagation()}
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
      >
        <div className="conversation-drawer-header">
          <div>
            <span className="eyebrow">Conversation detail</span>
            <h2 className="conversation-drawer-title">{conversation.agentName}</h2>
          </div>
          <button
            className="conversation-drawer-close"
            onClick={handleClose}
            type="button"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        <div className="conversation-drawer-body">
          {failure ? (
            <section className="drawer-section">
              <div className="notice notice-danger conversation-failure-banner">
                <p className="conversation-failure-title">
                  Failed · {formatFailureStageLabel(failure.stage)}
                </p>
                <div className="kv-list">
                  {failure.turnId ? (
                    <div className="kv-row">
                      <span className="kv-label">Turn</span>
                      <span className="kv-value">{failure.turnId}</span>
                    </div>
                  ) : null}
                  {failure.at ? (
                    <div className="kv-row">
                      <span className="kv-label">When</span>
                      <span className="kv-value">{formatTimestamp(failure.at)}</span>
                    </div>
                  ) : null}
                  <div className="kv-row">
                    <span className="kv-label">Caller heard</span>
                    <span className="kv-value">
                      {formatValue(failure.callerHeard ?? conversation.errorMessage)}
                    </span>
                  </div>
                  <div className="kv-row">
                    <span className="kv-label">Error code</span>
                    <span className="kv-value">
                      {formatValue(failure.errorCode ?? conversation.errorCode)}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="drawer-section">
            <h3 className="drawer-section-title">Overview</h3>
            <div className="kv-list">
              <div className="kv-row">
                <span className="kv-label">Status</span>
                <span className="kv-value">
                  <span className={`status-pill status-pill-${conversation.status}`}>
                    <span className="status-dot" />
                    {conversation.statusLabel}
                  </span>
                </span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Agent</span>
                <span className="kv-value">{conversation.agentName}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Source</span>
                <span className="kv-value">{conversation.sourceLabel}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Started</span>
                <span className="kv-value">{formatTimestamp(conversation.startedAt)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Ended</span>
                <span className="kv-value">{formatTimestamp(conversation.endedAt)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Duration</span>
                <span className="kv-value">{formatConversationDuration(conversation.durationMs)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Outcome</span>
                <span className="kv-value">{formatValue(conversation.outcome)}</span>
              </div>
            </div>
          </section>

          <ConversationSummaryPanel
            conversationId={conversation.id}
            initialState={conversation.summaryState}
            initialSummary={conversation.summary}
          />

          <section className="drawer-section">
            <h3 className="drawer-section-title">Captures</h3>
            {detailData.captures.length > 0 ? (
              <div className="conversation-detail-stack">
                {detailData.captures.map((capture) => (
                  <div className="detail-block" key={capture.id}>
                    <h4 className="detail-block-title">
                      {capture.captureTypeLabel} · {capture.statusLabel}
                    </h4>
                    <p className="detail-block-copy muted-copy">
                      {formatTimestamp(capture.createdAt)}
                    </p>
                    {capture.payloadFields.length > 0 ? (
                      <div className="kv-list" style={{ marginTop: '10px' }}>
                        {capture.payloadFields.map((field) => (
                          <div className="kv-row" key={`${capture.id}-${field.label}`}>
                            <span className="kv-label">{field.label}</span>
                            <span className="kv-value">{field.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="detail-block-copy">No structured fields stored.</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-copy">
                No leads, messages, appointment requests, or handoffs were
                captured in this conversation.
              </p>
            )}
          </section>

          {latencyMetrics.length > 0 && diagnostics.turns.length === 0 ? (
            <section className="drawer-section">
              <h3 className="drawer-section-title">Session latency</h3>
              {showLegacyLatencyNotice ? (
                <p className="muted-copy conversation-legacy-metrics-note">
                  Per-turn chips are unavailable for this older call. Showing
                  session-level timing that was stored when the call ended.
                </p>
              ) : (
                <p className="muted-copy conversation-legacy-metrics-note">
                  No per-turn timings were recorded for this session. Showing
                  available session-level averages.
                </p>
              )}
              <div className="kv-list">
                {latencyMetrics.map((metric) => (
                  <div className="kv-row" key={metric.key}>
                    <span className="kv-label">{metric.label}</span>
                    <span className="kv-value">{metric.valueLabel}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : showLegacyLatencyNotice && latencyMetrics.length === 0 ? (
            <section className="drawer-section">
              <h3 className="drawer-section-title">Call path note</h3>
              <p className="muted-copy conversation-legacy-metrics-note">
                This conversation was saved before per-turn diagnostics. Session
                start/end rails may still appear below from stored timestamps.
              </p>
            </section>
          ) : null}

          {conversation.status === 'failed' && !failure ? (
            <section className="drawer-section">
              <h3 className="drawer-section-title">Failure details</h3>
              <div className="notice notice-danger conversation-error-card">
                <div className="conversation-detail-stack">
                  <div className="detail-block">
                    <h4 className="detail-block-title">Error code</h4>
                    <p className="detail-block-copy">{conversation.errorCode ?? 'Not set'}</p>
                  </div>
                  <div className="detail-block">
                    <h4 className="detail-block-title">Error message</h4>
                    <p className="detail-block-copy">
                      {conversation.errorMessage ?? 'No stored error message.'}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="drawer-section">
            <h3 className="drawer-section-title">Transcript / call path</h3>
            {transcriptState === 'results' || timelineItems.length > 0 ? (
              <div className="voice-transcript-list conversation-timeline-list">
                {timelineItems.map((item, index) => {
                  if (item.kind === 'session') {
                    const timeLabel = formatSessionEventTimestamp(item.event.at);
                    return (
                      <div
                        className={`conversation-session-rail conversation-session-rail-${item.event.status}`}
                        key={item.event.id}
                      >
                        <span className="conversation-session-rail-label">
                          {item.event.label}
                        </span>
                        {timeLabel ? (
                          <span className="conversation-session-rail-time">{timeLabel}</span>
                        ) : null}
                      </div>
                    );
                  }

                  if (item.kind === 'orphan_turn') {
                    return (
                      <article
                        className="voice-transcript-item conversation-message-card conversation-orphan-turn"
                        key={`orphan-${item.turn.turnId}`}
                      >
                        <div className="voice-transcript-meta conversation-message-meta">
                          <span>Turn {item.turn.index}</span>
                          <span>No final transcript</span>
                        </div>
                        <TurnChip side="stt" turn={item.turn} />
                      </article>
                    );
                  }

                  const { message, turn, chipSide } = item;
                  return (
                    <article
                      className={`voice-transcript-item voice-transcript-item-${message.role} conversation-message-card`}
                      key={message.id || `${message.sequenceNumber}-${index}`}
                    >
                      <div className="voice-transcript-meta conversation-message-meta">
                        <span>#{message.sequenceNumber}</span>
                        <span>{message.roleLabel}</span>
                        {message.interruptedLabel ? (
                          <span className="conversation-message-flag">
                            {message.interruptedLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="voice-transcript-text">{message.content}</p>
                      {turn && chipSide ? <TurnChip side={chipSide} turn={turn} /> : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="notice">No transcript messages were stored for this conversation.</div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
