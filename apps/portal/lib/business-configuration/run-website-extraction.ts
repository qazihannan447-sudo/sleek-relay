import 'server-only';

import {
  createAzureOpenAILlmClient,
  createGeminiLlmClient,
  extractDraft,
  loadAzureOpenAIConfigFromEnv,
  loadGeminiConfigFromEnv,
  type ExtractionDraft,
  type LlmClient,
} from '@sleek-relay/website-extraction';

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

export async function runWebsiteExtraction(
  websiteUrl: string,
  onboardingSessionId?: string,
): Promise<WebsiteExtractionDraftView> {
  const normalizedInput = normalizeWebsiteInput(websiteUrl);
  if (!normalizedInput) {
    throw new Error('Enter a website URL before scraping.');
  }

  try {
    new URL(normalizedInput);
  } catch {
    throw new Error('Enter a valid website URL, for example https://example.com.');
  }

  const draft = await extractDraft(normalizedInput, {
    llmClient: tryCreateLlmClient(),
    onboardingSessionId,
    timeoutMs: 15_000,
  });

  return mapExtractionDraftToView(toRawDraft(draft));
}
