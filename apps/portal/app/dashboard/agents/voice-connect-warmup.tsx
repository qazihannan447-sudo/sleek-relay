'use client';

import { useEffect } from 'react';

import {
  abandonBrowserVoicePrebootstrap,
  prepareBrowserVoicePrebootstrap,
  startVoiceRunnerKeepAlive,
} from '../../../lib/voice/warm-connect';

type VoiceConnectWarmupProps = {
  agentId: string;
};

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
    void prepareBrowserVoicePrebootstrap({
      agentId,
      runnerBaseUrlHint: runnerConfig,
    });

    return () => {
      stopKeepAlive();
      void abandonBrowserVoicePrebootstrap({ agentId });
    };
  }, [agentId]);

  return null;
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
