'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useCallback, useRef } from 'react';

import { formatConversationDuration } from '../../../lib/conversations/helpers';
import { formatTimestamp } from '../../../lib/format-timestamp';
import type { ConversationDetailPageData } from '../../../lib/conversations/load-conversation-detail';

type ConversationDetailDrawerProps = {
  detailData: ConversationDetailPageData | null;
};

function formatValue(value: string | null | undefined): string {
  return value?.trim() ? value : 'Not set';
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

  const { conversation, messages, transcriptState } = detailData;

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
          {/* Status & Overview */}
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
              <div className="kv-row">
                <span className="kv-label">End reason</span>
                <span className="kv-value">{formatValue(conversation.endReason)}</span>
              </div>
            </div>
          </section>

          {/* Summary & Outcome */}
          <section className="drawer-section">
            <h3 className="drawer-section-title">Summary & Outcome</h3>
            <div className="conversation-detail-stack">
              <div className="detail-block">
                <h4 className="detail-block-title">Summary</h4>
                <p className="detail-block-copy">{formatValue(conversation.summary)}</p>
              </div>
              <div className="detail-block">
                <h4 className="detail-block-title">Outcome</h4>
                <p className="detail-block-copy">{formatValue(conversation.outcome)}</p>
              </div>
              <div className="detail-block">
                <h4 className="detail-block-title">End reason</h4>
                <p className="detail-block-copy">{formatValue(conversation.endReason)}</p>
              </div>
            </div>
          </section>

          {/* Failure details if failed */}
          {conversation.status === 'failed' ? (
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
                    <p className="detail-block-copy">{conversation.errorMessage ?? 'No stored error message.'}</p>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {/* Transcript */}
          <section className="drawer-section">
            <h3 className="drawer-section-title">Transcript</h3>
            {transcriptState === 'results' ? (
              <div className="voice-transcript-list">
                {messages.map((message) => (
                  <article
                    className={`voice-transcript-item voice-transcript-item-${message.role} conversation-message-card`}
                    key={message.id}
                  >
                    <div className="voice-transcript-meta conversation-message-meta">
                      <span>#{message.sequenceNumber}</span>
                      <span>{message.roleLabel}</span>
                      <span>{message.stateLabel}</span>
                      {message.interruptedLabel ? (
                        <span className="conversation-message-flag">
                          {message.interruptedLabel}
                        </span>
                      ) : null}
                      <span>{formatTimestamp(message.timestamp)}</span>
                    </div>
                    <p className="voice-transcript-text">{message.content}</p>
                  </article>
                ))}
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
