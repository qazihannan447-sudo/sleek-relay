// Section 6: identify with a real user-agent.
export const DEFAULT_USER_AGENT =
  "SleekRelayOnboardingBot/1.0 (+https://sleekrelay.example/onboarding-bot; single-page extraction at owner request)";

// Section 6: total extraction (fetch + parse + LLM pass) within ~15s.
export const DEFAULT_TIMEOUT_MS = 15_000;

// Reserve enough of the budget that a started LLM call has a realistic
// chance to return before the deadline; otherwise skip it and ship
// structured-data-only results rather than start work we'll abandon.
export const MIN_LLM_BUDGET_MS = 3_000;

// Coverage-first limits profile for the multi-page site pipeline
// (siteExtract.ts). The goal here is the agent knowing "almost everything"
// about the site, not a bounded quick prefill — so these are safety
// ceilings against a pathologically large site, not the thing that's
// expected to actually kick in for a typical small business. This is
// already an async background job (Section 5/9 discussion): nothing is
// waiting on it synchronously, so a multi-minute total budget is fine.
export const DEFAULT_SITE_TOTAL_BUDGET_MS = 900_000; // 15 min safety ceiling
// Phase 1 (crawl + chunk, no LLM) gets most of the budget, since it's what
// actually determines coverage. Phase 2 (LLM enrichment) gets whatever's
// left — see siteExtract.ts's two-phase split.
export const DEFAULT_SITE_CRAWL_BUDGET_MS = 600_000; // 10 min
export const DEFAULT_SITE_PER_PAGE_TIMEOUT_MS = 15_000;
// A hanging/slow LLM call must not be able to consume the entire remaining
// enrichment budget by itself — cap each individual call independently of
// the overall deadline, same rationale as the per-page fetch timeout above.
export const DEFAULT_SITE_LLM_CALL_TIMEOUT_MS = 20_000;
export const DEFAULT_SITE_MAX_PAGES = 300;
export const DEFAULT_SITE_MAX_DEPTH = 3;
export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 150;
export const DEFAULT_MAX_CHUNKS = 5_000;

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

// Bring-your-own-LLM (Section 9): endpoint/deployment/credential are all
// externally configured, pointed at the approved Foundry Canada East
// deployment — nothing about the model is embedded/opaque in this package.
export function loadAzureOpenAIConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AzureOpenAIConfig {
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = env.AZURE_OPENAI_API_VERSION ?? "2024-10-21";

  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      "Azure OpenAI is not configured: set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT " +
        "(pointed at the approved Foundry Canada East deployment)."
    );
  }
  return { endpoint, apiKey, deployment, apiVersion };
}
