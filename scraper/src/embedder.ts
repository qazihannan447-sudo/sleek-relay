import { withRateLimitBackoff, type RetryOptions } from "./llmRetry.js";

// Dev/demo-only, same rationale as llmClientGemini.ts: exercises the
// retrieval path (embed → search → answer) without Azure credentials.
// Embedding generation was deliberately left as a stubbed extension point
// in the core pipeline (chunkStore.ts) — this is that extension point
// filled in for local testing, not a production embedding service choice.

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface GeminiEmbedderConfig {
  apiKey: string;
  model?: string;
  /** Requests per batch call — Gemini's batchEmbedContents has a request-count ceiling. */
  batchSize?: number;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Overrides the default rate-limit backoff (2 retries, server-hint-aware). */
  retry?: RetryOptions;
}

const DEFAULT_MODEL = "gemini-embedding-2";
const DEFAULT_BATCH_SIZE = 20;
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface BatchEmbedResponse {
  embeddings?: Array<{ values?: number[] }>;
}

export function createGeminiEmbedder(config: GeminiEmbedderConfig): Embedder {
  const model = config.model ?? DEFAULT_MODEL;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async embed(texts: string[]): Promise<number[][]> {
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        // Embedding quota (100 req/min on the free tier) is separate from
        // the chat-completion quota and, unlike that one, comes with an
        // authoritative "retry in Ns" hint in the error body — worth
        // actually waiting out rather than failing fast (see llmRetry.ts).
        const body = await withRateLimitBackoff<BatchEmbedResponse>(async () => {
          const res = await fetchImpl(`${BASE_URL}/${model}:batchEmbedContents`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
            body: JSON.stringify({
              requests: batch.map((text) => ({
                model: `models/${model}`,
                content: { parts: [{ text }] }
              }))
            })
          });
          if (!res.ok) {
            throw new Error(`Gemini embedding request failed: ${res.status} ${await res.text()}`);
          }
          return (await res.json()) as BatchEmbedResponse;
        }, config.retry ?? { maxRetries: 2 });
        for (const embedding of body.embeddings ?? []) {
          results.push(embedding.values ?? []);
        }
      }
      return results;
    }
  };
}

export function loadGeminiEmbedderConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiEmbedderConfig {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Gemini is not configured: set GEMINI_API_KEY — generate a free key at https://aistudio.google.com/apikey"
    );
  }
  return { apiKey, model: env.GEMINI_EMBEDDING_MODEL };
}
