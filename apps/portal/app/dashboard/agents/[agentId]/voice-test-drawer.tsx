'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useCallback, useRef } from 'react';

import { VoiceTestPanel } from './test/voice-test-panel';

type VoiceTestDrawerProps = {
  agentId: string;
  agentLanguage: string;
  agentName: string;
  agentRole: string;
  agentVoiceId: string;
  isOpen: boolean;
};

export function VoiceTestDrawer({
  agentId,
  agentLanguage,
  agentName,
  agentRole,
  agentVoiceId,
  isOpen,
}: VoiceTestDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drawerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('testOpen');
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        handleClose();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        isOpen &&
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
  }, [isOpen, handleClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="conversation-drawer-overlay" onClick={handleClose}>
      <div className="conversation-drawer-backdrop" />
      <aside
        aria-modal="true"
        className="conversation-drawer"
        onClick={(e) => e.stopPropagation()}
        ref={drawerRef}
        role="dialog"
      >
        <div className="conversation-drawer-header">
          <div>
            <span className="eyebrow">Voice Test</span>
            <h2 className="conversation-drawer-title">Test {agentName}</h2>
          </div>
          <button
            aria-label="Close panel"
            className="conversation-drawer-close"
            onClick={handleClose}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="vt-drawer-body">
          <VoiceTestPanel
            agentId={agentId}
            agentLanguage={agentLanguage}
            agentName={agentName}
            agentRole={agentRole}
            agentVoiceId={agentVoiceId}
          />
        </div>
      </aside>
    </div>
  );
}
