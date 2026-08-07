import { FileChunkStore, createGeminiLlmClient, loadGeminiConfigFromEnv, createGeminiEmbedder, loadGeminiEmbedderConfigFromEnv, embedChunks, askQuestion } from "./dist/index.js";

// The specific unverified link: chunks loaded back from persisted storage
// (saved by a previous, now-dead process) rather than a fresh draft.chunks.
const chunkStore = new FileChunkStore({ dataDir: "./data/chunks" });
const chunks = await chunkStore.load("demo-tenant", "demo-agent");
console.log(`Loaded ${chunks.length} chunks from disk (no crawl this run)`);

if (chunks.length === 0) {
  console.error("No stored chunks found — run scratch-crawl-and-save.mjs first.");
  process.exit(1);
}

const embedder = createGeminiEmbedder(loadGeminiEmbedderConfigFromEnv());
const embeddedChunks = await embedChunks(chunks, embedder);
console.log(`Embedded ${embeddedChunks.length} chunks loaded from storage`);

const question = process.argv[2] ?? "What does Finova do?";
console.log(`\nQuestion: ${question}`);

const llmClient = createGeminiLlmClient(loadGeminiConfigFromEnv());
const result = await askQuestion(question, embeddedChunks, embedder, llmClient, 5);

console.log("\n=== ANSWER ===");
console.log(result.answer);
console.log("\n=== SOURCES ===");
for (const s of result.sources) {
  console.log(`  [${s.score.toFixed(3)}] ${s.pageType} — ${s.sourceUrl}`);
}
