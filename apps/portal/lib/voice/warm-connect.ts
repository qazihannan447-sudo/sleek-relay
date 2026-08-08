import {
  browserConversationLifecycleEvents,
  createBrowserVoiceBootstrap,
  createBrowserVoiceConversationLifecycle,
  type BrowserStartupTimingName,
  type BrowserVoiceBootstrapResult,
} from './browser-test';
import { resolveVoiceRunnerConfig } from './session';

type BrowserTestFetch = typeof fetch;

type PrebootstrapEntry = {
  agentId: string;
  promise: Promise<BrowserVoiceBootstrapResult>;
  result: BrowserVoiceBootstrapResult | null;
};

/** Ignore a cached token if it would expire too soon after Connect. */
const PREBOOTSTRAP_MIN_REMAINING_MS = 2 * 60 * 1000;

/**
 * Hosted runners (e.g. Render free tier) spin down after ~15 idle minutes and
 * take tens of seconds to wake. Re-ping well inside that window so the worker
 * stays warm for as long as a dashboard page that can start a session is open.
 */
const RUNNER_KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;
/** Treat a recent successful ping as proof the runner is awake. */
const RUNNER_PING_FRESHNESS_MS = 4 * 60 * 1000;
/** A sleeping instance can take a while to boot; retry before giving up. */
const RUNNER_PING_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

const entriesByAgentId = new Map<string, PrebootstrapEntry>();
let micWarmPromise: Promise<void> | null = null;
let runnerPingInFlight: Promise<void> | null = null;
let runnerLastPingSuccessAtMs = 0;
let runnerKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let runnerKeepAliveSubscribers = 0;

function isBootstrapStillUsable(
  result: BrowserVoiceBootstrapResult,
  nowMs: number = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(result.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }

  return expiresAtMs - nowMs >= PREBOOTSTRAP_MIN_REMAINING_MS;
}

async function warmMicrophonePermission(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  });

  for (const track of stream.getTracks()) {
    track.stop();
  }
}

async function pingVoiceRunner(runnerBaseUrl: string): Promise<void> {
  // no-cors keeps the response opaque, but resolution still means the runner
  // answered, which both wakes and confirms a spun-down instance.
  await fetch(`${runnerBaseUrl}/health`, {
    cache: 'no-store',
    method: 'GET',
    mode: 'no-cors',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pingVoiceRunnerWithRetries(runnerBaseUrl: string): Promise<void> {
  for (let attempt = 0; attempt <= RUNNER_PING_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await pingVoiceRunner(runnerBaseUrl);
      runnerLastPingSuccessAtMs = Date.now();
      return;
    } catch {
      if (attempt === RUNNER_PING_RETRY_DELAYS_MS.length) {
        return;
      }
      await sleep(RUNNER_PING_RETRY_DELAYS_MS[attempt]);
    }
  }
}

function warmVoiceRunnerNow(
  runnerBaseUrlHint?: string | null,
  options?: { force?: boolean },
): Promise<void> {
  const runnerConfig = resolveVoiceRunnerConfig(
    runnerBaseUrlHint ?? process.env.NEXT_PUBLIC_VOICE_RUNNER_URL,
  );
  if (runnerConfig.kind !== 'valid') {
    return Promise.resolve();
  }

  if (runnerPingInFlight) {
    return runnerPingInFlight;
  }

  const isFresh =
    Date.now() - runnerLastPingSuccessAtMs < RUNNER_PING_FRESHNESS_MS;
  if (isFresh && !options?.force) {
    return Promise.resolve();
  }

  runnerPingInFlight = pingVoiceRunnerWithRetries(runnerConfig.baseUrl).finally(
    () => {
      runnerPingInFlight = null;
    },
  );
  return runnerPingInFlight;
}

/**
 * Keep the voice runner awake while a page that can start a session is open.
 * Pings immediately, then on an interval below the hosting idle-sleep window.
 * Returns a stop function; the shared timer ends when no subscriber remains.
 */
export function startVoiceRunnerKeepAlive(
  runnerBaseUrlHint?: string | null,
): () => void {
  const runnerConfig = resolveVoiceRunnerConfig(
    runnerBaseUrlHint ?? process.env.NEXT_PUBLIC_VOICE_RUNNER_URL,
  );
  if (runnerConfig.kind !== 'valid') {
    return () => {};
  }

  runnerKeepAliveSubscribers += 1;
  void warmVoiceRunnerNow(runnerBaseUrlHint);

  if (!runnerKeepAliveTimer) {
    runnerKeepAliveTimer = setInterval(() => {
      void warmVoiceRunnerNow(runnerBaseUrlHint, { force: true });
    }, RUNNER_KEEP_ALIVE_INTERVAL_MS);
  }

  let stopped = false;
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    runnerKeepAliveSubscribers = Math.max(0, runnerKeepAliveSubscribers - 1);
    if (runnerKeepAliveSubscribers === 0 && runnerKeepAliveTimer) {
      clearInterval(runnerKeepAliveTimer);
      runnerKeepAliveTimer = null;
    }
  };
}

function startSideWarmups(runnerBaseUrlHint?: string | null): void {
  if (!micWarmPromise) {
    micWarmPromise = warmMicrophonePermission().catch(() => {
      micWarmPromise = null;
    });
  }

  void warmVoiceRunnerNow(runnerBaseUrlHint);
}

async function finalizeUnusedConversation(
  conversationId: string,
  fetchImpl: BrowserTestFetch,
): Promise<void> {
  const updateLifecycle = createBrowserVoiceConversationLifecycle({
    fetch: fetchImpl,
  });

  try {
    await updateLifecycle({
      conversationId,
      endReason: 'prebootstrap_unused',
      event: browserConversationLifecycleEvents.failed,
      keepalive: true,
    });
  } catch {
    // Stale reconciler still closes leftover `starting` rows.
  }
}

/**
 * Start (or reuse) bootstrap for an agent while the config page is open.
 * Creates the conversation + token + runtime package ahead of Connect.
 */
export function prepareBrowserVoicePrebootstrap(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
  runnerBaseUrlHint?: string | null;
}): Promise<BrowserVoiceBootstrapResult | null> {
  const agentId = args.agentId.trim();
  if (!agentId) {
    return Promise.resolve(null);
  }

  const fetchImpl = args.fetch ?? fetch.bind(globalThis);
  startSideWarmups(args.runnerBaseUrlHint);

  const existing = entriesByAgentId.get(agentId);
  if (existing) {
    if (existing.result && !isBootstrapStillUsable(existing.result)) {
      entriesByAgentId.delete(agentId);
      void finalizeUnusedConversation(existing.result.conversationId, fetchImpl);
    } else {
      return existing.promise.then(
        (result) => result,
        () => null,
      );
    }
  }

  const bootstrap = createBrowserVoiceBootstrap({ fetch: fetchImpl });
  const entry: PrebootstrapEntry = {
    agentId,
    promise: Promise.resolve().then(async () => {
      const result = await bootstrap({ agentId });
      entry.result = result;
      return result;
    }),
    result: null,
  };

  entriesByAgentId.set(agentId, entry);

  return entry.promise.then(
    (result) => result,
    () => {
      if (entriesByAgentId.get(agentId) === entry) {
        entriesByAgentId.delete(agentId);
      }
      return null;
    },
  );
}

/**
 * Take a prepared bootstrap for Connect. Awaits an in-flight prepare if needed.
 * Falls back to a fresh bootstrap when nothing usable is cached.
 */
export async function takeBrowserVoicePrebootstrap(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
  onTimingEvent?: (_name: BrowserStartupTimingName) => void;
  runnerBaseUrlHint?: string | null;
}): Promise<BrowserVoiceBootstrapResult> {
  const agentId = args.agentId.trim();
  const fetchImpl = args.fetch ?? fetch.bind(globalThis);
  startSideWarmups(args.runnerBaseUrlHint);

  const entry = entriesByAgentId.get(agentId);
  if (entry) {
    try {
      const result = await entry.promise;
      if (isBootstrapStillUsable(result)) {
        entriesByAgentId.delete(agentId);
        args.onTimingEvent?.('conversation_creation_finished');
        args.onTimingEvent?.('session_token_finished');
        return result;
      }

      entriesByAgentId.delete(agentId);
      void finalizeUnusedConversation(result.conversationId, fetchImpl);
    } catch {
      if (entriesByAgentId.get(agentId) === entry) {
        entriesByAgentId.delete(agentId);
      }
    }
  }

  const bootstrap = createBrowserVoiceBootstrap({ fetch: fetchImpl });
  return bootstrap({
    agentId,
    onTimingEvent: args.onTimingEvent,
  });
}

/**
 * Drop a prepared session that was never connected (page leave / agent switch).
 */
export async function abandonBrowserVoicePrebootstrap(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
}): Promise<void> {
  const agentId = args.agentId.trim();
  const entry = entriesByAgentId.get(agentId);
  if (!entry) {
    return;
  }

  entriesByAgentId.delete(agentId);
  const fetchImpl = args.fetch ?? fetch.bind(globalThis);

  try {
    const result = await entry.promise;
    await finalizeUnusedConversation(result.conversationId, fetchImpl);
  } catch {
    // Prepare failed; nothing to finalize.
  }
}

/** @deprecated Use prepareBrowserVoicePrebootstrap. */
export async function warmVoiceConnectPrerequisites(args: {
  agentId: string;
  runnerBaseUrlHint?: string | null;
}): Promise<void> {
  await prepareBrowserVoicePrebootstrap(args);
}

export function resetVoiceConnectWarmupForTests(): void {
  entriesByAgentId.clear();
  micWarmPromise = null;
  runnerPingInFlight = null;
  runnerLastPingSuccessAtMs = 0;
  runnerKeepAliveSubscribers = 0;
  if (runnerKeepAliveTimer) {
    clearInterval(runnerKeepAliveTimer);
    runnerKeepAliveTimer = null;
  }
}
