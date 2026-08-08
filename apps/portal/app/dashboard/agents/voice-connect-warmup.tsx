'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { resolveVoiceRunnerConfig } from '../../../lib/voice/session';
import {
  abandonBrowserVoicePrebootstrap,
  prepareBrowserVoicePrebootstrap,
  prepareVoiceSessionPrestart,
  retainVoiceSessionPrestart,
  startVoiceRunnerKeepAlive,
} from '../../../lib/voice/warm-connect';

type VoiceConnectWarmupProps = {
  agentId: string;
};

/**
 * Kick off runner /start as soon as the user shows intent to test (hover /
 * focus / press). Drawer open can then skip straight to Daily join.
 */
export function prepareVoiceSessionPrestartOnIntent(agentId: string): void {
  const trimmedAgentId = agentId.trim();
  if (!trimmedAgentId) {
    return;
  }

  const runnerConfig = resolveVoiceRunnerConfig(
    process.env.NEXT_PUBLIC_VOICE_RUNNER_URL,
  );
  if (runnerConfig.kind !== 'valid') {
    return;
  }

  void prepareVoiceSessionPrestart({
    agentId: trimmedAgentId,
    runnerBaseUrlHint: runnerConfig.baseUrl,
    startUrl: runnerConfig.startUrl,
  });
}

/**
 * Pre-bootstraps the browser voice session while the agent config page is open
 * (agentId is already in the URL). Connect can then reuse that session instead
 * of waiting on conversation/token/runtime round-trips. Also keeps the hosted
 * voice runner awake so Connect does not hit a cold instance.
 */
export function VoiceConnectWarmup({ agentId }: VoiceConnectWarmupProps) {
  useEffect(() => {
    const runnerConfig = process.env.NEXT_PUBLIC_VOICE_RUNNER_URL;
    const stopKeepAlive = startVoiceRunnerKeepAlive(runnerConfig);
    const releasePrestart = retainVoiceSessionPrestart(agentId);
    void prepareBrowserVoicePrebootstrap({
      agentId,
      runnerBaseUrlHint: runnerConfig,
    });

    return () => {
      stopKeepAlive();
      releasePrestart();
      void abandonBrowserVoicePrebootstrap({ agentId });
    };
  }, [agentId]);

  return null;
}

type TestAgentLinkProps = {
  agentId: string;
  children?: React.ReactNode;
  className?: string;
};

/**
 * Opens the voice test drawer and starts session prestart on first intent so
 * bot boot overlaps navigation / drawer open time.
 */
export function TestAgentLink({
  agentId,
  children = 'Test agent',
  className = 'button',
}: TestAgentLinkProps) {
  function handleIntent() {
    prepareVoiceSessionPrestartOnIntent(agentId);
  }

  return (
    <Link
      className={className}
      href={`/dashboard/agents/${agentId}?test=true`}
      onFocus={handleIntent}
      onMouseEnter={handleIntent}
      onPointerDown={handleIntent}
      prefetch={true}
    >
      {children}
    </Link>
  );
}

/**
 * Runner-only keep-alive for pages that list agents but do not yet know which
 * agent will be tested. Wakes a spun-down runner as soon as the user lands.
 */
export function VoiceRunnerKeepAlive() {
  useEffect(() => {
    const stopKeepAlive = startVoiceRunnerKeepAlive(
      process.env.NEXT_PUBLIC_VOICE_RUNNER_URL,
    );
    return stopKeepAlive;
  }, []);

  return null;
}
