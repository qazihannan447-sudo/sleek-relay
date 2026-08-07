import { extractSiteDraft } from "./dist/siteExtract.js";
import { approveSiteDraft, FileChunkStore } from "./dist/index.js";

// No llmClient — fast, no quota risk. Coverage/chunking has already been
// proven extensively; this run is specifically to prove persistence.
const draft = await extractSiteDraft("https://www.finovasolutions.tech/", {
  maxPages: 5,
  totalBudgetMs: 30_000,
  crawlBudgetMs: 30_000
});
console.log(`Crawled ${draft.pages.length} pages, ${draft.chunks.length} chunks`);

const chunkStore = new FileChunkStore({ dataDir: "./data/chunks" });
const approved = await approveSiteDraft(draft, "owner@example.com", new Date(), "demo-tenant", "demo-agent", chunkStore);
console.log(`Approved and saved ${approved.chunkCount} chunks for tenant=demo-tenant agent=demo-agent`);
console.log("Process exiting now — nothing in memory survives past this point.");
