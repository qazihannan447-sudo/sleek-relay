import {
  createBrowserVoiceBootstrap,
  createBrowserVoiceConversationDiscard,
  type BrowserStartupTimingName,
  type BrowserVoiceBootstrapResult,
  VOICE_SESSION_PREJOIN_MAX_AGE_MS,
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

// The microphone is intentionally NOT warmed here: capture must only start
// when the user clicks Connect, never from merely opening an agents page.
function startSideWarmups(runnerBaseUrlHint?: string | null): void {
  void warmVoiceRunnerNow(runnerBaseUrlHint);
}

async function finalizeUnusedConversation(
  conversationId: string,
  fetchImpl: BrowserTestFetch,
): Promise<void> {
  const discardConversation = createBrowserVoiceConversationDiscard({
    fetch: fetchImpl,
  });

  try {
    await discardConversation({
      conversationId,
      keepalive: true,
    });
  } catch {
    // Stale reconciler still deletes leftover `starting` rows.
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

// ---------------------------------------------------------------------------
// Session prestart: call the runner's /start while the test drawer is open so
// the bot is already in the Daily room (pipeline running, providers connected)
// before the user clicks Connect. Connect then only pays the browser join.
// The worker cancels prestarted sessions that no client joins (no-show guard),
// so the browser-side reuse window must stay below that worker timeout.
// ---------------------------------------------------------------------------

export type VoiceSessionPrestartResult = {
  bootstrap: BrowserVoiceBootstrapResult;
  startResponse: unknown;
  startedAtMs: number;
};

type PrestartEntry = {
  agentId: string;
  promise: Promise<VoiceSessionPrestartResult>;
  result: VoiceSessionPrestartResult | null;
};

/** Must stay comfortably below the worker's client no-show timeout (120s). */
const PRESTART_MAX_AGE_MS = VOICE_SESSION_PREJOIN_MAX_AGE_MS;

const prestartsByAgentId = new Map<string, PrestartEntry>();
/** Active UI consumers (drawer / agent page). Abandon when the count hits 0. */
const prestartConsumerCountByAgentId = new Map<string, number>();

function isPrestartStillUsable(
  result: VoiceSessionPrestartResult,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - result.startedAtMs <= PRESTART_MAX_AGE_MS;
}

async function postVoiceRunnerStart(
  startUrl: string,
  requestData: unknown,
  fetchImpl: BrowserTestFetch,
): Promise<unknown> {
  // Matches PipecatClient.startBot: POST with requestData as the JSON body.
  const response = await fetchImpl(startUrl, {
    body: JSON.stringify(requestData),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Voice runner /start failed with status ${response.status}.`);
  }

  return response.json();
}

/**
 * Start (or reuse) a bot session for an agent while the test drawer is open
 * (or earlier on Test-agent intent). Consumes the page-level prebootstrap (or
 * creates a fresh one) and calls the runner's /start so the bot boots ahead of
 * the Connect click.
 *
 * Runner wake (/health) runs in parallel with bootstrap and is awaited before
 * /start so a spun-down hosted runner is not hit cold by the heavier start.
 */
export function prepareVoiceSessionPrestart(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
  runnerBaseUrlHint?: string | null;
  startUrl: string;
}): Promise<VoiceSessionPrestartResult | null> {
  const agentId = args.agentId.trim();
  const startUrl = args.startUrl.trim();
  if (!agentId || !startUrl) {
    return Promise.resolve(null);
  }

  const fetchImpl = args.fetch ?? fetch.bind(globalThis);

  const existing = prestartsByAgentId.get(agentId);
  if (existing) {
    if (existing.result && !isPrestartStillUsable(existing.result)) {
      prestartsByAgentId.delete(agentId);
      void finalizeUnusedConversation(
        existing.result.bootstrap.conversationId,
        fetchImpl,
      );
    } else {
      return existing.promise.then(
        (result) => result,
        () => null,
      );
    }
  }

  const entry: PrestartEntry = {
    agentId,
    // Deferred via .then so the callback runs after `entry` is assigned.
    promise: Promise.resolve().then(async () => {
      const runnerWarm = warmVoiceRunnerNow(args.runnerBaseUrlHint);
      const bootstrap = await takeBrowserVoicePrebootstrap({
        agentId,
        fetch: fetchImpl,
        runnerBaseUrlHint: args.runnerBaseUrlHint,
      });
      // Prefer a woken runner before the heavier /start call.
      await runnerWarm;

      try {
        const startResponse = await postVoiceRunnerStart(
          startUrl,
          bootstrap.requestData,
          fetchImpl,
        );
        const result: VoiceSessionPrestartResult = {
          bootstrap,
          startResponse,
          startedAtMs: Date.now(),
        };
        entry.result = result;
        return result;
      } catch (error) {
        // The bot never started; release the reserved conversation.
        void finalizeUnusedConversation(
          bootstrap.conversationId,
          fetchImpl,
        );
        throw error;
      }
    }),
    result: null,
  };

  prestartsByAgentId.set(agentId, entry);

  return entry.promise.then(
    (result) => result,
    () => {
      if (prestartsByAgentId.get(agentId) === entry) {
        prestartsByAgentId.delete(agentId);
      }
      return null;
    },
  );
}

/**
 * Take a prestarted session for Connect. Awaits an in-flight prestart when
 * needed. Returns null when nothing usable exists (caller falls back to the
 * regular startBot path).
 */
export async function takeVoiceSessionPrestart(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
  onTimingEvent?: (_name: BrowserStartupTimingName) => void;
}): Promise<VoiceSessionPrestartResult | null> {
  const agentId = args.agentId.trim();
  const entry = prestartsByAgentId.get(agentId);
  if (!entry) {
    return null;
  }

  prestartsByAgentId.delete(agentId);
  const fetchImpl = args.fetch ?? fetch.bind(globalThis);

  try {
    const result = await entry.promise;
    if (!isPrestartStillUsable(result)) {
      void finalizeUnusedConversation(
        result.bootstrap.conversationId,
        fetchImpl,
      );
      return null;
    }

    args.onTimingEvent?.('conversation_creation_finished');
    args.onTimingEvent?.('session_token_finished');
    return result;
  } catch {
    return null;
  }
}

export function isVoiceSessionPrestartFresh(
  startedAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - startedAtMs <= VOICE_SESSION_PREJOIN_MAX_AGE_MS;
}

/**
 * Retain a prestarted session while a UI surface is mounted (agent page /
 * test drawer). Release is microtask-deferred so React Strict Mode remounts
 * can reclaim before the session is finalized.
 */
export function retainVoiceSessionPrestart(agentId: string): () => void {
  const id = agentId.trim();
  if (!id) {
    return () => {};
  }

  prestartConsumerCountByAgentId.set(
    id,
    (prestartConsumerCountByAgentId.get(id) ?? 0) + 1,
  );

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = (prestartConsumerCountByAgentId.get(id) ?? 1) - 1;
    if (next > 0) {
      prestartConsumerCountByAgentId.set(id, next);
      return;
    }

    prestartConsumerCountByAgentId.delete(id);
    queueMicrotask(() => {
      if ((prestartConsumerCountByAgentId.get(id) ?? 0) > 0) {
        return;
      }
      void abandonVoiceSessionPrestart({ agentId: id });
    });
  };
}

/**
 * Drop a prestarted session that was never connected (drawer close / agent
 * switch). The worker's no-show guard ends the orphaned bot session.
 */
export async function abandonVoiceSessionPrestart(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
}): Promise<void> {
  const agentId = args.agentId.trim();
  const entry = prestartsByAgentId.get(agentId);
  if (!entry) {
    return;
  }

  prestartsByAgentId.delete(agentId);
  const fetchImpl = args.fetch ?? fetch.bind(globalThis);

  try {
    const result = await entry.promise;
    await finalizeUnusedConversation(
      result.bootstrap.conversationId,
      fetchImpl,
    );
  } catch {
    // Prestart failed; its conversation was already finalized in prepare.
  }
}

/**
 * Drop cached bootstrap/prestart sessions after agent config changes (e.g. voice)
 * and rebuild a fresh prebootstrap from the portal. Connect must not reuse an
 * embedded runtime package that still carries the pre-save voiceId.
 */
export async function refreshBrowserVoiceWarmupAfterAgentChange(args: {
  agentId: string;
  fetch?: BrowserTestFetch;
  runnerBaseUrlHint?: string | null;
}): Promise<BrowserVoiceBootstrapResult | null> {
  const agentId = args.agentId.trim();
  if (!agentId) {
    return null;
  }

  const fetchImpl = args.fetch ?? fetch.bind(globalThis);
  const runnerBaseUrlHint =
    args.runnerBaseUrlHint ?? process.env.NEXT_PUBLIC_VOICE_RUNNER_URL;

  // Prestart first: it already consumed the prebootstrap entry and embeds the
  // stale runtime package in the runner /start body.
  await abandonVoiceSessionPrestart({ agentId, fetch: fetchImpl });
  await abandonBrowserVoicePrebootstrap({ agentId, fetch: fetchImpl });

  return prepareBrowserVoicePrebootstrap({
    agentId,
    fetch: fetchImpl,
    runnerBaseUrlHint,
  });
}

export function resetVoiceConnectWarmupForTests(): void {
  entriesByAgentId.clear();
  prestartsByAgentId.clear();
  prestartConsumerCountByAgentId.clear();
  runnerPingInFlight = null;
  runnerLastPingSuccessAtMs = 0;
  runnerKeepAliveSubscribers = 0;
  if (runnerKeepAliveTimer) {
    clearInterval(runnerKeepAliveTimer);
    runnerKeepAliveTimer = null;
  }
}
