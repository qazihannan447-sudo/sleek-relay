'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const REFRESH_DEBOUNCE_MS = 750;
const REFRESH_INTERVAL_MS = 5000;

/**
 * Soft-nav / open Notifications after a voice test can show a stale list.
 * Refresh on mount, when the tab becomes visible, and lightly while focused.
 */
export function NotificationsListRefresh() {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    function refreshNotificationsList() {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const now = Date.now();
      if (now - lastRefreshAtRef.current < REFRESH_DEBOUNCE_MS) {
        return;
      }

      lastRefreshAtRef.current = now;
      router.refresh();
    }

    refreshNotificationsList();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshNotificationsList();
      }
    }

    const intervalId = window.setInterval(() => {
      refreshNotificationsList();
    }, REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router]);

  return null;
}
