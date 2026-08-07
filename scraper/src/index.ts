export { extractDraft } from "./extractDraft.js";
export type { ExtractDraftOptions } from "./extractDraft.js";

export { approveDraft } from "./approveDraft.js";
export type { ApprovedProfile, ApproveDraftOptions } from "./approveDraft.js";

export {
  ExtractionDraftSchema,
  ExtractionFieldsSchema,
  FieldValueSchemas,
  SourceSchema,
  ConfidenceSchema
} from "./schema.js";
export type { ExtractionDraft, ExtractionFields, Field, FieldKey, Source, Confidence } from "./schema.js";

export { createAzureOpenAILlmClient } from "./llmClient.js";
export type { LlmClient } from "./llmClient.js";

export { loadAzureOpenAIConfigFromEnv } from "./config.js";
export type { AzureOpenAIConfig } from "./config.js";

// Dev/demo-only — see llmClientGemini.ts for why this isn't for the pilot.
export { createGeminiLlmClient, loadGeminiConfigFromEnv } from "./llmClientGemini.js";
export type { GeminiConfig } from "./llmClientGemini.js";

export { playwrightHeadlessFetch } from "./headlessFetch.js";

// --- Multi-page site pipeline (beyond requirements.md's single-page spec —
// see plan discussion for scope) ---
export { extractSiteDraft } from "./siteExtract.js";
export type { ExtractSiteDraftOptions } from "./siteExtract.js";

export { approveSiteDraft, discardSiteDraft } from "./siteApproval.js";
export type { ApprovedSiteProfile, DiscardedSiteRecord, SiteApprovalOptions } from "./siteApproval.js";

export {
  SiteExtractionDraftSchema,
  SiteExtractionFieldsSchema,
  SiteFieldValueSchemas,
  PageTypeSchema,
  ChunkSchema
} from "./siteSchema.js";
export type { SiteExtractionDraft, SiteExtractionFields, SiteFieldKey, PageType, PageSummary, Chunk } from "./siteSchema.js";

export { InMemoryChunkStore } from "./chunkStore.js";
export type { ChunkStore } from "./chunkStore.js";

export { FileChunkStore } from "./fileChunkStore.js";
export type { FileChunkStoreConfig } from "./fileChunkStore.js";

export { SupabaseChunkStore, createSupabaseChunkStore, loadSupabaseChunkStoreConfigFromEnv } from "./supabaseChunkStore.js";
export type { SupabaseChunkStoreOptions, SupabaseChunkStoreConfig } from "./supabaseChunkStore.js";

export { classifyPage } from "./pageTypes.js";
export { chunkText } from "./chunk.js";

// Dev/demo-only retrieval — see demoAsk.ts for why this isn't the
// production retrieval layer.
export { createGeminiEmbedder, loadGeminiEmbedderConfigFromEnv } from "./embedder.js";
export type { Embedder, GeminiEmbedderConfig } from "./embedder.js";

export { embedChunks, cosineSimilarity, searchChunks, askQuestion } from "./demoAsk.js";
export type { EmbeddedChunk, ScoredChunk, AskQuestionResult } from "./demoAsk.js";
