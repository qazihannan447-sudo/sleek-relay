import OpenAI from "openai";
import type { LlmClient } from "./llmClient.js";
import { withRateLimitBackoff } from "./llmRetry.js";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

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

  return {
    async complete({ systemPrompt, userPrompt, signal }) {
      // Gemini's free tier has a low per-minute request quota that a
      // multi-page crawl (one or two calls per page) burns through fast —
      // back off and retry on 429 rather than treating it like a malformed
      // response (see llmRetry.ts for why this is a separate concern).
      const completion = await withRateLimitBackoff(
        () =>
          client.chat.completions.create(
            {
              model: config.model,
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
    }
  };
}

export function loadGeminiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY;
  // "-latest" aliases track whatever Google currently recommends, avoiding
  // the hardcoded-version-getting-deprecated problem (gemini-2.5-flash was
  // already blocked for new API keys despite still being listed in the
  // /models catalog).
  const model = env.GEMINI_MODEL ?? "gemini-flash-latest";
  if (!apiKey) {
    throw new Error(
      "Gemini is not configured: set GEMINI_API_KEY — generate a free key at https://aistudio.google.com/apikey"
    );
  }
  return { apiKey, model, baseURL: env.GEMINI_BASE_URL };
}
