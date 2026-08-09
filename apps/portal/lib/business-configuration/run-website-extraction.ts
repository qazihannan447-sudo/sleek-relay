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

function describeLlmProvider(): 'azure' | 'gemini' | 'none' {
  try {
    loadAzureOpenAIConfigFromEnv();
    return 'azure';
  } catch {
    // continue
  }

  try {
    loadGeminiConfigFromEnv();
    return 'gemini';
  } catch {
    return 'none';
  }
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
  /** Set when contact/structured fields worked but Gemini/Azure enrich did not. */
  enrichWarning?: string;
};

/** Deep path: fetch + structured data + LLM enrichment. */
export async function runWebsiteExtractionEnrich(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionEnrichResult> {
  const normalizedInput = normalizeAndValidateUrl(websiteUrl);
  const provider = describeLlmProvider();
  const llmClient = tryCreateLlmClient();

  if (!llmClient) {
    const draft = await extractDraft(normalizedInput, {
      mode: 'structured',
      onboardingSessionId,
      timeoutMs: 15_000,
    });
    return {
      draft: mapExtractionDraftToView(toRawDraft(draft)),
      enrichWarning:
        'No LLM is configured for website enrich (set GEMINI_API_KEY or AZURE_OPENAI_*). Only structured contact fields were filled.',
    };
  }

  const draft = await extractDraft(normalizedInput, {
    llmClient,
    mode: 'full',
    onboardingSessionId,
    timeoutMs: 15_000,
  });

  const view = mapExtractionDraftToView(toRawDraft(draft));
  const hasLlmField = Object.values(view.fields).some(
    (field) => field?.source === 'llm_inferred',
  );

  if (!hasLlmField) {
    return {
      draft: view,
      enrichWarning:
        provider === 'gemini'
          ? 'Gemini enrich ran but returned no extra fields (often a bad/retired GEMINI_MODEL, or a 404/quota error). Contact fields below still came from the page. Set GEMINI_MODEL=gemini-2.5-flash and retry.'
          : 'LLM enrich returned no extra fields. Contact fields below still came from the page.',
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
