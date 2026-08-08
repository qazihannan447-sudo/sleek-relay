'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { PlayIcon, SaveIcon } from '../../../components/icons';

type AgentHeaderActionsProps = {
  agentId: string | null;
  canEdit: boolean;
  formId: string;
  isActive: boolean;
  saveLabel: string;
};

/**
 * Save + Test actions for the agent detail header. When this row scrolls
 * out of view, the same two actions reappear as a floating icon cluster
 * pinned to the bottom-right so they stay reachable without scrolling back up.
 */
export function AgentHeaderActions({
  agentId,
  canEdit,
  formId,
  isActive,
  saveLabel,
}: AgentHeaderActionsProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [isAnchorVisible, setIsAnchorVisible] = useState(true);

  useEffect(() => {
    const node = anchorRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setIsAnchorVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const showTest = isActive && Boolean(agentId);
  const testHref = agentId ? `/dashboard/agents/${agentId}?test=true` : '';

  return (
    <>
      <div className="page-header-actions" ref={anchorRef}>
        {canEdit ? (
          <button className="button" form={formId} type="submit">
            {saveLabel}
          </button>
        ) : null}
        {showTest ? (
          <Link className="button-secondary" href={testHref} prefetch={true}>
            Test agent
          </Link>
        ) : null}
      </div>

      {!isAnchorVisible && (canEdit || showTest) ? (
        <div aria-label="Agent actions" className="agent-fab-cluster" role="group">
          {canEdit ? (
            <button
              aria-label={saveLabel}
              className="agent-fab-button agent-fab-button-accent"
              form={formId}
              title={saveLabel}
              type="submit"
            >
              <span className="agent-fab-button-icon">
                <SaveIcon />
              </span>
              <span aria-hidden="true" className="agent-fab-button-label">
                {saveLabel}
              </span>
            </button>
          ) : null}
          {showTest ? (
            <Link
              aria-label="Test agent"
              className="agent-fab-button"
              href={testHref}
              prefetch={true}
              title="Test agent"
            >
              <span className="agent-fab-button-icon">
                <PlayIcon />
              </span>
              <span aria-hidden="true" className="agent-fab-button-label">
                Test agent
              </span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
