import { extractSiteDraft } from "./dist/siteExtract.js";
import { createGeminiLlmClient, loadGeminiConfigFromEnv, createGeminiEmbedder, loadGeminiEmbedderConfigFromEnv, embedChunks, askQuestion } from "./dist/index.js";

// Crawl only (no llmClient) — chunks don't depend on LLM enrichment, and
// this keeps today's chat-completions quota free for the one synthesis
// call at the end instead of ~40 per-page enrichment calls.
console.error("Crawling...");
const draft = await extractSiteDraft("https://www.finovasolutions.tech/", {
  totalBudgetMs: 60_000,
  crawlBudgetMs: 60_000,
  onProgress: (u) => process.stderr.write(`\r[${u.phase}] visited=${u.pagesVisited} queued=${u.queued}          `)
});
console.error(`\nCrawled ${draft.pages.length} pages, ${draft.chunks.length} chunks, status=${draft.status}`);

console.error("Embedding chunks...");
const embedder = createGeminiEmbedder(loadGeminiEmbedderConfigFromEnv());
const embeddedChunks = await embedChunks(draft.chunks, embedder);
console.error(`Embedded ${embeddedChunks.length} chunks`);

const question = process.argv[2] ?? "What services do you provide?";
console.error(`\nQuestion: ${question}`);

const llmClient = createGeminiLlmClient(loadGeminiConfigFromEnv());
const result = await askQuestion(question, embeddedChunks, embedder, llmClient, 5);

console.log("\n=== ANSWER ===");
console.log(result.answer);
console.log("\n=== SOURCES ===");
for (const s of result.sources) {
  console.log(`  [${s.score.toFixed(3)}] ${s.pageType} — ${s.sourceUrl}`);
}
