import type { LlmClient } from "./llmClient.js";
import { withRateLimitBackoff } from "./llmRetry.js";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/** Prefer stable IDs — `-latest` aliases have returned 404 for some API keys. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MODEL_FALLBACKS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-1.5-flash",
] as const;

const DEFAULT_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function isNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b404\b/.test(message) || /not found/i.test(message) || /was not found/i.test(message);
}

function modelCandidates(preferred: string): string[] {
  const ordered = [preferred, ...GEMINI_MODEL_FALLBACKS];
  return [...new Set(ordered.map((model) => model.trim()).filter(Boolean))];
}

function normalizeNativeBaseUrl(baseURL?: string): string {
  if (!baseURL?.trim()) {
    return DEFAULT_NATIVE_BASE_URL;
  }
  // Older configs pointed at the OpenAI-compat path; native generateContent
  // lives under /v1beta/models/{model}:generateContent instead.
  return baseURL
    .trim()
    .replace(/\/openai\/?$/i, "")
    .replace(/\/$/, "");
}

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

async function generateContent(args: {
  apiKey: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const modelPath = args.model.startsWith("models/")
    ? args.model
    : `models/${args.model}`;
  const url = `${args.baseURL}/${modelPath}:generateContent`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": args.apiKey,
    },
    signal: args.signal,
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: args.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: args.userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  const rawText = await response.text();
  let payload: GeminiGenerateContentResponse | null = null;
  if (rawText) {
    try {
      payload = JSON.parse(rawText) as GeminiGenerateContentResponse;
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      rawText.trim() ||
      `${response.status} status code (no body)`;
    throw new Error(`${response.status} ${detail}`);
  }

  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned an empty generateContent response");
  }

  return text;
}

// Local/dev/demo-only convenience adapter for exercising llmExtract.ts's
// prompt/parse/retry logic without Azure credentials — Gemini's free tier
// needs only a Google account and no billing setup.
//
// Uses the native Gemini generateContent API (not the OpenAI-compatible
// shim). The OpenAI path was returning bare 404s for models that still work
// on the native models list / generateContent endpoint.
//
// NOT for the pilot: it doesn't satisfy Section 9's "known, contractually
// acceptable processing region" requirement. Production should prefer
// createAzureOpenAILlmClient() pointed at Foundry Canada East.
export function createGeminiLlmClient(config: GeminiConfig): LlmClient {
  const apiKey = config.apiKey;
  const baseURL = normalizeNativeBaseUrl(config.baseURL);
  const models = modelCandidates(config.model);

  return {
    async complete({ systemPrompt, userPrompt, signal }) {
      let lastError: unknown;

      for (const model of models) {
        try {
          return await withRateLimitBackoff(
            () =>
              generateContent({
                apiKey,
                baseURL,
                model,
                systemPrompt,
                userPrompt,
                signal,
              }),
            {},
            signal
          );
        } catch (err) {
          lastError = err;
          if (!isNotFoundError(err) || signal?.aborted) {
            throw err;
          }
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError ?? "Gemini request failed"));
    },
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
  return {
    apiKey,
    model,
    baseURL: env.GEMINI_BASE_URL || env.GOOGLE_OPENAI_BASE_URL,
  };
}
