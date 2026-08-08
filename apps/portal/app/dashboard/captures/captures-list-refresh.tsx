'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const REFRESH_DEBOUNCE_MS = 750;
const REFRESH_INTERVAL_MS = 5000;

/**
 * Soft-nav / open Captures after a voice test can show a stale list.
 * Captures are written during the session; refresh on mount, when the tab
 * becomes visible, and lightly while focused so new rows appear quickly.
 */
export function CapturesListRefresh() {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    function refreshCapturesList() {
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

    refreshCapturesList();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshCapturesList();
      }
    }

    const intervalId = window.setInterval(() => {
      refreshCapturesList();
    }, REFRESH_INTERVAL_MS);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router]);

  return null;
}
