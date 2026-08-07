'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { VoiceTestPanel } from './[agentId]/test/voice-test-panel';

type AgentTestDrawerProps = {
  agent: {
    fallbackMessage: string;
    greeting: string;
    id: string;
    language: string;
    name: string;
    role: string;
    specialInstructions: string;
    status?: string;
    voiceId: string;
  };
};

export function AgentTestDrawer({ agent }: AgentTestDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const drawerRef = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('test');
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        handleClose();
      }
    }

    function handlePointerDown(event: PointerEvent) {
      if (
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
  }, [handleClose]);

  const isInactive = agent.status && agent.status !== 'active';

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
            <span className="eyebrow">Voice Test</span>
            <h2 className="conversation-drawer-title">{agent.name}</h2>
          </div>
          <button
            className="conversation-drawer-close"
            onClick={handleClose}
            type="button"
            aria-label="Close test panel"
          >
            ✕
          </button>
        </div>
        <div className="conversation-drawer-body">
          {isInactive ? (
            <div className="notice notice-danger" style={{ margin: '24px' }}>
              This agent is currently <strong>{agent.status}</strong>. Change the status to <strong>Active</strong> and save your changes before running browser test sessions.
            </div>
          ) : (
            <VoiceTestPanel
              agentFallbackMessage={agent.fallbackMessage}
              agentGreeting={agent.greeting}
              agentId={agent.id}
              agentLanguage={agent.language}
              agentName={agent.name}
              agentRole={agent.role}
              agentSpecialInstructions={agent.specialInstructions}
              agentVoiceId={agent.voiceId}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
