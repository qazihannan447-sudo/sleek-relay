import { FileChunkStore } from "./dist/index.js";

// A completely fresh process, no crawl, no network — proving the chunks
// saved by scratch-crawl-and-save.mjs's (now-dead) process are still here.
const chunkStore = new FileChunkStore({ dataDir: "./data/chunks" });
const chunks = await chunkStore.load("demo-tenant", "demo-agent");

console.log(`Loaded ${chunks.length} chunks from disk (fresh process, no memory carried over)`);
console.log("First chunk:");
console.log(JSON.stringify(chunks[0], null, 2));
