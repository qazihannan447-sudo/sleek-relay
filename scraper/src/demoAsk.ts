import type { Chunk } from "./siteSchema.js";
import type { Embedder } from "./embedder.js";
import type { LlmClient } from "./llmClient.js";

// Dev/demo-only: proves the chunks siteExtract.ts produces are actually
// answerable, end to end (embed -> similarity search -> LLM synthesis from
// retrieved context). This is NOT the production retrieval layer — it's a
// minimal, self-contained stand-in so the pipeline's output can be tested
// meaningfully, since neither embedding generation nor a query/search
// capability exist in ChunkStore (deliberately deferred — see chunkStore.ts).
// A real agent would replace this with its own retrieval stack (likely
// backed by whatever vector store ChunkStore eventually wraps).

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export async function embedChunks(chunks: Chunk[], embedder: Embedder): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  const embeddings = await embedder.embed(chunks.map((c) => c.text));
  return chunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] ?? [] }));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface ScoredChunk extends EmbeddedChunk {
  score: number;
}

export function searchChunks(embeddedChunks: EmbeddedChunk[], queryEmbedding: number[], topK = 5): ScoredChunk[] {
  return embeddedChunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(chunk.embedding, queryEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

const ANSWER_SYSTEM_PROMPT = `You answer a visitor's question about a business using ONLY the provided context, which was scraped from the business's own website.
Return ONLY a JSON object: {"answer": "<your answer>"}.
If the context doesn't contain enough information to answer, say so honestly in the answer rather than guessing or inventing details — never present something as fact that isn't in the context.`;

export interface AskQuestionResult {
  answer: string;
  sources: Array<{ sourceUrl: string; pageType: string; score: number }>;
}

export async function askQuestion(
  question: string,
  embeddedChunks: EmbeddedChunk[],
  embedder: Embedder,
  llmClient: LlmClient,
  topK = 5
): Promise<AskQuestionResult> {
  const [queryEmbedding] = await embedder.embed([question]);
  const topChunks = searchChunks(embeddedChunks, queryEmbedding ?? [], topK);

  const context = topChunks.map((c) => `[${c.pageType} — ${c.sourceUrl}]\n${c.text}`).join("\n\n---\n\n");
  const raw = await llmClient.complete({
    systemPrompt: ANSWER_SYSTEM_PROMPT,
    userPrompt: `Context:\n"""\n${context}\n"""\n\nQuestion: ${question}`
  });

  let answer: string;
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown };
    answer = typeof parsed.answer === "string" ? parsed.answer : raw;
  } catch {
    answer = raw; // malformed JSON — surface the raw text rather than losing the answer entirely
  }

  return {
    answer,
    sources: topChunks.map((c) => ({ sourceUrl: c.sourceUrl, pageType: c.pageType, score: c.score }))
  };
}
