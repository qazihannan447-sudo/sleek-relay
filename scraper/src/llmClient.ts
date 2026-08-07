import { AzureOpenAI } from "openai";
import type { AzureOpenAIConfig } from "./config.js";
import { withRateLimitBackoff } from "./llmRetry.js";

export interface LlmCompleteInput {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
}

export interface LlmClient {
  complete(input: LlmCompleteInput): Promise<string>;
}

// Section 6/9: this client is configured with no `tools`/`functions` and no
// browsing capability — it receives text and returns text. It is pointed at
// whatever Azure OpenAI deployment the caller configures (bring-your-own-LLM,
// e.g. the approved Foundry Canada East deployment); nothing about the model
// choice is embedded in this package.
export function createAzureOpenAILlmClient(config: AzureOpenAIConfig): LlmClient {
  const client = new AzureOpenAI({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    deployment: config.deployment,
    apiVersion: config.apiVersion
  });

  return {
    async complete({ systemPrompt, userPrompt, signal }) {
      const completion = await withRateLimitBackoff(
        () =>
          client.chat.completions.create(
            {
              model: config.deployment,
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
