import { extractSiteDraft } from "./dist/siteExtract.js";
import { createGeminiLlmClient, loadGeminiConfigFromEnv } from "./dist/index.js";

const llmClient = createGeminiLlmClient(loadGeminiConfigFromEnv());

const start = Date.now();
const draft = await extractSiteDraft("https://www.finovasolutions.tech/", {
  llmClient,
  totalBudgetMs: 180_000, // bounded for this verification run, not the new 15-min default
  crawlBudgetMs: 120_000,
  onProgress: (u) => console.error(`[${u.phase}] visited=${u.pagesVisited} queued=${u.queued} current=${u.currentUrl}`)
});
console.error(`elapsed: ${Date.now() - start}ms`);

console.log(
  JSON.stringify(
    {
      fields: draft.fields,
      pages: draft.pages,
      status: draft.status,
      chunkCount: draft.chunks.length,
      pageTypeCounts: draft.pages.reduce((acc, p) => ({ ...acc, [p.pageType]: (acc[p.pageType] ?? 0) + 1 }), {})
    },
    null,
    2
  )
);
