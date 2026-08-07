/**
 * Slim entry for the portal onboarding scrape path.
 * Intentionally excludes Playwright/headless and the multi-page site pipeline
 * so Next.js / Vercel never try to bundle browser automation packages.
 */
export { extractDraft } from "./extractDraft.js";
export type { ExtractDraftOptions } from "./extractDraft.js";

export {
  ExtractionDraftSchema,
  ExtractionFieldsSchema,
  FieldValueSchemas,
  SourceSchema,
  ConfidenceSchema,
} from "./schema.js";
export type {
  ExtractionDraft,
  ExtractionFields,
  Field,
  FieldKey,
  Source,
  Confidence,
} from "./schema.js";

export { createAzureOpenAILlmClient } from "./llmClient.js";
export type { LlmClient } from "./llmClient.js";

export { loadAzureOpenAIConfigFromEnv } from "./config.js";
export type { AzureOpenAIConfig } from "./config.js";

export { createGeminiLlmClient, loadGeminiConfigFromEnv } from "./llmClientGemini.js";
export type { GeminiConfig } from "./llmClientGemini.js";
