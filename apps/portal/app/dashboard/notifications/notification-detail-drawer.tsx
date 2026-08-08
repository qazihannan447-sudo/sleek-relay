'use client';

import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { formatTimestamp } from '../../../lib/format-timestamp';
import type { NotificationDetailPageData } from '../../../lib/notifications/load-notification-detail';

type NotificationDetailDrawerProps = {
  detailData: NotificationDetailPageData | null;
};

function formatValue(value: string | null | undefined): string {
  return value?.trim() ? value : 'Not set';
}

export function NotificationDetailDrawer({
  detailData,
}: NotificationDetailDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drawerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('notificationId');
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

  if (!detailData) {
    return null;
  }

  if (detailData.kind === 'error' || detailData.kind === 'not-found') {
    return (
      <div className="conversation-drawer-overlay" onClick={handleClose}>
        <div className="conversation-drawer-backdrop" />
        <aside
          aria-label="Notification details"
          className="conversation-drawer"
          onClick={(event) => event.stopPropagation()}
          ref={drawerRef}
        >
          <div className="conversation-drawer-header">
            <h2 className="conversation-drawer-title">Notification</h2>
            <button
              aria-label="Close notification details"
              className="conversation-drawer-close"
              onClick={handleClose}
              type="button"
            >
              ×
            </button>
          </div>
          <div className="conversation-drawer-body">
            <div className="notice notice-danger">
              {detailData.kind === 'error'
                ? detailData.message
                : 'This notification could not be found.'}
            </div>
          </div>
        </aside>
      </div>
    );
  }

  if (detailData.kind !== 'authenticated') {
    return null;
  }

  return (
    <div className="conversation-drawer-overlay" onClick={handleClose}>
      <div className="conversation-drawer-backdrop" />
      <aside
        aria-label="Notification details"
        className="conversation-drawer"
        onClick={(event) => event.stopPropagation()}
        ref={drawerRef}
      >
        <div className="conversation-drawer-header">
          <div>
            <h2 className="conversation-drawer-title">{detailData.kindLabel}</h2>
            <p className="muted-copy" style={{ margin: '4px 0 0' }}>
              {detailData.channelLabel} · {detailData.statusLabel}
            </p>
          </div>
          <button
            aria-label="Close notification details"
            className="conversation-drawer-close"
            onClick={handleClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="conversation-drawer-body">
          {detailData.errorMessage ? (
            <section className="drawer-section">
              <div className="notice notice-danger">{detailData.errorMessage}</div>
            </section>
          ) : null}

          <section className="drawer-section">
            <h3 className="drawer-section-title">Message</h3>
            <p className="notification-message-body">{detailData.body}</p>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Summary</h3>
            <p className="muted-copy" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
              {formatValue(detailData.summary)}
            </p>
          </section>

          <section className="drawer-section">
            <h3 className="drawer-section-title">Delivery</h3>
            <div className="kv-list">
              <div className="kv-row">
                <span className="kv-label">Destination</span>
                <span className="kv-value">{detailData.destination}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Channel</span>
                <span className="kv-value">{detailData.channelLabel}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Status</span>
                <span className="kv-value">{detailData.statusLabel}</span>
              </div>
              {detailData.subject ? (
                <div className="kv-row">
                  <span className="kv-label">Subject</span>
                  <span className="kv-value">{detailData.subject}</span>
                </div>
              ) : null}
              <div className="kv-row">
                <span className="kv-label">Outcome</span>
                <span className="kv-value">{formatValue(detailData.outcome)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Agent</span>
                <span className="kv-value">{detailData.agentName}</span>
              </div>
              <div className="kv-row">
                <span className="kv-label">Created</span>
                <span className="kv-value">
                  {formatTimestamp(detailData.createdAt)}
                </span>
              </div>
            </div>
          </section>
        </div>

        <div className="conversation-drawer-footer">
          <Link
            className="button-secondary"
            href={`/dashboard/conversations?conversationId=${detailData.conversationId}`}
          >
            Open conversation
          </Link>
          <button className="button-secondary" onClick={handleClose} type="button">
            Close
          </button>
        </div>
      </aside>
    </div>
  );
}
