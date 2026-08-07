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

/** Deep path: fetch + structured data + LLM enrichment. */
export async function runWebsiteExtractionEnrich(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionDraftView> {
  const normalizedInput = normalizeAndValidateUrl(websiteUrl);

  const draft = await extractDraft(normalizedInput, {
    llmClient: tryCreateLlmClient(),
    mode: 'full',
    onboardingSessionId,
    timeoutMs: 15_000,
  });

  return mapExtractionDraftToView(toRawDraft(draft));
}

/** @deprecated Prefer runWebsiteExtractionQuick / runWebsiteExtractionEnrich. */
export async function runWebsiteExtraction(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionDraftView> {
  return runWebsiteExtractionEnrich(websiteUrl, onboardingSessionId);
}
