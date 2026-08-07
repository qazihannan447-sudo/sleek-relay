import { describe, expect, it } from "vitest";
import { askQuestion, cosineSimilarity, searchChunks, type EmbeddedChunk } from "../src/demoAsk.js";
import type { Embedder } from "../src/embedder.js";
import type { LlmClient } from "../src/llmClient.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for a zero vector rather than NaN", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

function chunk(sourceUrl: string, pageType: string, text: string, embedding: number[]): EmbeddedChunk {
  return { sourceUrl, pageType: pageType as EmbeddedChunk["pageType"], chunkIndex: 0, text, embedding };
}

describe("searchChunks", () => {
  it("ranks chunks by similarity to the query, most similar first", () => {
    const chunks: EmbeddedChunk[] = [
      chunk("https://example.test/off-topic", "other", "irrelevant content", [0, 1]),
      chunk("https://example.test/services", "services", "we offer web design", [1, 0])
    ];
    const results = searchChunks(chunks, [1, 0], 5);
    expect(results[0]!.sourceUrl).toBe("https://example.test/services");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("respects topK", () => {
    const chunks: EmbeddedChunk[] = Array.from({ length: 10 }, (_, i) => chunk(`https://example.test/${i}`, "other", "x", [i, 0]));
    expect(searchChunks(chunks, [1, 0], 3)).toHaveLength(3);
  });
});

describe("askQuestion", () => {
  it("retrieves relevant chunks and returns an answer parsed from the LLM's JSON response", async () => {
    const embeddedChunks: EmbeddedChunk[] = [
      chunk("https://example.test/services", "services", "We offer web design and SEO.", [1, 0, 0]),
      chunk("https://example.test/contact", "contact", "Call us at 555-0000.", [0, 1, 0])
    ];

    const embedder: Embedder = {
      async embed(texts) {
        // "what services" query embeds close to the services chunk's vector.
        return texts.map(() => [1, 0, 0]);
      }
    };

    let capturedPrompt = "";
    const llmClient: LlmClient = {
      async complete({ userPrompt }) {
        capturedPrompt = userPrompt;
        return JSON.stringify({ answer: "We offer web design and SEO." });
      }
    };

    const result = await askQuestion("What services do you offer?", embeddedChunks, embedder, llmClient, 1);

    expect(result.answer).toBe("We offer web design and SEO.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.sourceUrl).toBe("https://example.test/services");
    expect(capturedPrompt).toContain("We offer web design and SEO.");
    expect(capturedPrompt).not.toContain("Call us at 555-0000."); // contact chunk shouldn't be in context when topK=1
  });

  it("falls back to the raw response text if the LLM's JSON is malformed, rather than losing the answer", async () => {
    const embeddedChunks: EmbeddedChunk[] = [chunk("https://example.test/services", "services", "We offer web design.", [1, 0])];
    const embedder: Embedder = { async embed(texts) { return texts.map(() => [1, 0]); } };
    const llmClient: LlmClient = { async complete() { return "Sorry, we offer web design (not valid JSON)"; } };

    const result = await askQuestion("What do you offer?", embeddedChunks, embedder, llmClient);
    expect(result.answer).toContain("web design");
  });
});
