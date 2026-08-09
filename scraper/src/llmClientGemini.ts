import OpenAI from "openai";
import type { LlmClient } from "./llmClient.js";
import { withRateLimitBackoff } from "./llmRetry.js";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/** Prefer stable IDs — `-latest` aliases have returned 404 for some API keys. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash",
] as const;

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b404\b/.test(message) || /not found/i.test(message) || /was not found/i.test(message);
}

function modelCandidates(preferred: string): string[] {
  const ordered = [preferred, ...GEMINI_MODEL_FALLBACKS];
  return [...new Set(ordered.map((model) => model.trim()).filter(Boolean))];
}

// Local/dev/demo-only convenience adapter for exercising llmExtract.ts's
// prompt/parse/retry logic without Azure credentials — Gemini's free tier
// needs only a Google account and no billing setup.
//
// NOT for the pilot: it doesn't satisfy Section 9's "known, contractually
// acceptable processing region" requirement, and free-tier quota/model
// availability shifts over time (Google tightened the free tier in April
// 2026; check https://ai.google.dev/gemini-api/docs/models for which model
// IDs are currently free before relying on this for a demo). Production
// must go through createAzureOpenAILlmClient() pointed at the approved
// Foundry Canada East deployment instead. Both implement the same
// LlmClient interface, so extractDraft() doesn't know or care which one
// it's given.
export function createGeminiLlmClient(config: GeminiConfig): LlmClient {
  const client = new OpenAI({ baseURL: config.baseURL ?? DEFAULT_BASE_URL, apiKey: config.apiKey });
  const models = modelCandidates(config.model);

  return {
    async complete({ systemPrompt, userPrompt, signal }) {
      // Gemini's free tier has a low per-minute request quota that a
      // multi-page crawl (one or two calls per page) burns through fast —
      // back off and retry on 429 rather than treating it like a malformed
      // response (see llmRetry.ts for why this is a separate concern).
      let lastError: unknown;

      for (const model of models) {
        try {
          const completion = await withRateLimitBackoff(
            () =>
              client.chat.completions.create(
                {
                  model,
                  messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                  ],
                  response_format: { type: "json_object" },
                  temperature: 0
                },
                { signal }
              ),
            {},
            signal
          );
          return completion.choices[0]?.message?.content ?? "";
        } catch (err) {
          lastError = err;
          // Wrong/retired model IDs come back as 404 with an empty body —
          // try the next candidate before abandoning enrichment entirely.
          if (!isNotFoundError(err) || signal?.aborted) {
            throw err;
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError ?? "Gemini request failed"));
    }
  };
}

export function loadGeminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiConfig {
  // Accept GOOGLE_* as a fallback so one Gemini key can cover scrape + summaries.
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  const model =
    env.GEMINI_MODEL?.trim() ||
    env.GOOGLE_MODEL?.trim() ||
    DEFAULT_GEMINI_MODEL;
  if (!apiKey) {
    throw new Error(
      "Gemini is not configured: set GEMINI_API_KEY — generate a free key at https://aistudio.google.com/apikey"
    );
  }
  return { apiKey, model, baseURL: env.GEMINI_BASE_URL || env.GOOGLE_OPENAI_BASE_URL };
}
