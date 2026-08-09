import 'server-only';

import {
  createAzureOpenAILlmClient,
  createGeminiLlmClient,
  extractDraft,
  loadAzureOpenAIConfigFromEnv,
  loadGeminiConfigFromEnv,
  type ExtractionDraft,
  type LlmClient,
} from '@sleek-relay/website-extraction/portal';

import {
  mapExtractionDraftToView,
  normalizeWebsiteInput,
  type RawExtractionDraft,
  type WebsiteExtractionDraftView,
} from './website-extraction';

export const LLM_CREDITS_ENRICH_NOTICE =
  'Enrich web scraping couldn’t be done because the LLM credits ended, but the structural information has been collected.';

export const LLM_ENRICH_FALLBACK_NOTICE =
  'Enrich web scraping couldn’t be completed, but the structural information has been collected.';

function tryCreateLlmClient(): LlmClient | undefined {
  try {
    return createAzureOpenAILlmClient(loadAzureOpenAIConfigFromEnv());
  } catch {
    // Azure is the production path; fall through to optional Gemini for local demos.
  }

  try {
    return createGeminiLlmClient(loadGeminiConfigFromEnv());
  } catch {
    // Structured-data-only extraction still works without an LLM.
    return undefined;
  }
}

function isLlmCreditsError(detail: string | undefined): boolean {
  if (!detail) {
    return false;
  }
  return (
    /\b429\b/i.test(detail) ||
    /quota/i.test(detail) ||
    /rate.?limit/i.test(detail) ||
    /RESOURCE_EXHAUSTED/i.test(detail) ||
    /credits?/i.test(detail) ||
    /aborted during backoff/i.test(detail)
  );
}

function toRawDraft(draft: ExtractionDraft): RawExtractionDraft {
  return {
    extractedAt: draft.extractedAt,
    failureReason: draft.failureReason,
    fields: draft.fields,
    normalizedUrl: draft.normalizedUrl,
    status: draft.status,
  };
}

function normalizeAndValidateUrl(websiteUrl: string): string {
  const normalizedInput = normalizeWebsiteInput(websiteUrl);
  if (!normalizedInput) {
    throw new Error('Enter a website URL before scraping.');
  }

  try {
    new URL(normalizedInput);
  } catch {
    throw new Error('Enter a valid website URL, for example https://example.com.');
  }

  return normalizedInput;
}

function draftHasLlmInferredFields(draft: WebsiteExtractionDraftView): boolean {
  return Object.values(draft.fields).some((field) => field?.source === 'llm_inferred');
}

/** Fast path: fetch + structured data only (no LLM). */
export async function runWebsiteExtractionQuick(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionDraftView> {
  const normalizedInput = normalizeAndValidateUrl(websiteUrl);

  const draft = await extractDraft(normalizedInput, {
    mode: 'structured',
    onboardingSessionId,
    timeoutMs: 8_000,
  });

  return mapExtractionDraftToView(toRawDraft(draft));
}

export type WebsiteExtractionEnrichResult = {
  draft: WebsiteExtractionDraftView;
  /** Friendly banner when structured scrape worked but LLM enrich did not. */
  enrichNotice?: string;
};

/** Deep path: fetch + structured data + LLM enrichment. */
export async function runWebsiteExtractionEnrich(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionEnrichResult> {
  const normalizedInput = normalizeAndValidateUrl(websiteUrl);
  const baseClient = tryCreateLlmClient();
  let lastLlmError: string | undefined;

  const llmClient = baseClient
    ? {
        async complete(input: Parameters<LlmClient['complete']>[0]) {
          try {
            return await baseClient.complete(input);
          } catch (error) {
            lastLlmError =
              error instanceof Error ? error.message : String(error);
            throw error;
          }
        },
      }
    : undefined;

  const draft = await extractDraft(normalizedInput, {
    llmClient,
    mode: llmClient ? 'full' : 'structured',
    onboardingSessionId,
    timeoutMs: 15_000,
  });

  const view = mapExtractionDraftToView(toRawDraft(draft));

  if (!baseClient) {
    return {
      draft: view,
      enrichNotice: LLM_ENRICH_FALLBACK_NOTICE,
    };
  }

  if (!draftHasLlmInferredFields(view)) {
    return {
      draft: view,
      enrichNotice: isLlmCreditsError(lastLlmError)
        ? LLM_CREDITS_ENRICH_NOTICE
        : LLM_ENRICH_FALLBACK_NOTICE,
    };
  }

  return { draft: view };
}

/** @deprecated Prefer runWebsiteExtractionQuick / runWebsiteExtractionEnrich. */
export async function runWebsiteExtraction(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionDraftView> {
  const result = await runWebsiteExtractionEnrich(websiteUrl, onboardingSessionId);
  return result.draft;
}
