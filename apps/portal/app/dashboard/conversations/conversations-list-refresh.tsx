'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

const REFRESH_DEBOUNCE_MS = 750;

/**
 * Soft-nav back to Conversations can reuse a stale RSC payload. Refresh on
 * mount and when the tab becomes visible again after a voice test elsewhere.
 */
export function ConversationsListRefresh() {
  const router = useRouter();
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    function refreshConversationsList() {
      const now = Date.now();
      if (now - lastRefreshAtRef.current < REFRESH_DEBOUNCE_MS) {
        return;
      }

      lastRefreshAtRef.current = now;
      router.refresh();
    }

    refreshConversationsList();

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        refreshConversationsList();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [router]);

  return null;
}
