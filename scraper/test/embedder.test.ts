import { describe, expect, it } from "vitest";
import { createGeminiEmbedder } from "../src/embedder.js";

const MODEL = "gemini-embedding-2";
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("createGeminiEmbedder", () => {
  it("sends a batchEmbedContents request and returns embeddings in order", async () => {
    let capturedBody: unknown;
    let capturedHeaders: Headers | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      expect(input).toBe(URL);
      capturedBody = JSON.parse(init!.body as string);
      capturedHeaders = new Headers(init!.headers);
      return jsonResponse({ embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] });
    };

    const embedder = createGeminiEmbedder({ apiKey: "test-key", fetchImpl });
    const result = await embedder.embed(["first text", "second text"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4]
    ]);
    expect(capturedHeaders?.get("x-goog-api-key")).toBe("test-key");
    expect(capturedBody).toEqual({
      requests: [
        { model: `models/${MODEL}`, content: { parts: [{ text: "first text" }] } },
        { model: `models/${MODEL}`, content: { parts: [{ text: "second text" }] } }
      ]
    });
  });

  it("splits requests exceeding batchSize into multiple calls", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = async () => {
      callCount++;
      return jsonResponse({ embeddings: [{ values: [1] }, { values: [2] }] });
    };

    const embedder = createGeminiEmbedder({ apiKey: "test-key", fetchImpl, batchSize: 2 });
    const result = await embedder.embed(["a", "b", "c", "d"]);

    expect(callCount).toBe(2); // 4 texts / batchSize 2
    expect(result).toHaveLength(4);
  });

  it("throws with a descriptive error on a non-ok response", async () => {
    const fetchImpl: typeof fetch = async () => new Response("quota exceeded", { status: 429 });
    // maxRetries: 0 keeps this test fast and focused on the error message,
    // not backoff timing (covered separately in llmRetry.test.ts).
    const embedder = createGeminiEmbedder({ apiKey: "test-key", fetchImpl, retry: { maxRetries: 0 } });

    await expect(embedder.embed(["text"])).rejects.toThrow(/429/);
  });
});
