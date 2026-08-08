'use client';

import { useEffect } from 'react';

import {
  abandonBrowserVoicePrebootstrap,
  prepareBrowserVoicePrebootstrap,
} from '../../../lib/voice/warm-connect';

type VoiceConnectWarmupProps = {
  agentId: string;
};

/**
 * Pre-bootstraps the browser voice session while the agent config page is open
 * (agentId is already in the URL). Connect can then reuse that session instead
 * of waiting on conversation/token/runtime round-trips.
 */
export function VoiceConnectWarmup({ agentId }: VoiceConnectWarmupProps) {
  useEffect(() => {
    const runnerConfig = process.env.NEXT_PUBLIC_VOICE_RUNNER_URL;
    void prepareBrowserVoicePrebootstrap({
      agentId,
      runnerBaseUrlHint: runnerConfig,
    });

    return () => {
      void abandonBrowserVoicePrebootstrap({ agentId });
    };
  }, [agentId]);

  return null;
}
