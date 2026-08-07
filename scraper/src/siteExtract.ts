import { normalizeUrl, sameSite } from "./urlUtils.js";
import { loadRobots } from "./robots.js";
import { fetchPage, type HeadlessFetcher } from "./fetchPage.js";
import { extractStructuredData } from "./structuredData.js";
import { extractPageParagraphs, joinParagraphs, removeRepeatedBoilerplate } from "./contentClean.js";
import { chunkText } from "./chunk.js";
import { classifyPage } from "./pageTypes.js";
import { fetchSitemapUrls, extractPageLinks } from "./siteMap.js";
import { extractSiteFieldsWithLlm, classifyPageWithLlm, type SitePartialFields } from "./llmExtract.js";
import { accumulateListField } from "./merge.js";
import {
  SiteExtractionDraftSchema,
  SiteFieldValueSchemas,
  type SiteExtractionDraft,
  type SiteExtractionFields,
  type SiteFieldKey,
  type PageType,
  type PageSummary,
  type Chunk
} from "./siteSchema.js";
import type { Field } from "./schema.js";
import { createLogger, type Logger } from "./logger.js";
import {
  DEFAULT_USER_AGENT,
  DEFAULT_SITE_TOTAL_BUDGET_MS,
  DEFAULT_SITE_CRAWL_BUDGET_MS,
  DEFAULT_SITE_PER_PAGE_TIMEOUT_MS,
  DEFAULT_SITE_LLM_CALL_TIMEOUT_MS,
  DEFAULT_SITE_MAX_PAGES,
  DEFAULT_SITE_MAX_DEPTH,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
  DEFAULT_MAX_CHUNKS,
  MIN_LLM_BUDGET_MS
} from "./config.js";
import type { LlmClient } from "./llmClient.js";

// Which fields are worth asking the LLM about on each page type, so prompts
// (and cost) stay roughly flat regardless of how many pages get crawled —
// we never ask a Contact page about `services`.
const PAGE_TYPE_FOCUS: Record<PageType, SiteFieldKey[]> = {
  home: ["businessName", "category", "summary", "socialLinks"],
  about: ["businessName", "category", "summary"],
  services: ["services"],
  projects: ["projects"],
  partners: ["partners"],
  faq: ["faqs", "policies"],
  contact: ["phone", "contactEmail", "address", "hours", "socialLinks", "policies"],
  other: ["businessName", "category", "policies"],
  ignore: []
};

// Enrichment (phase 2) is best-effort and may not finish for every page —
// process the pages most likely to yield useful structured facts first, so
// a time-boxed run captures the highest-value fields even if it can't
// enrich everything.
const ENRICHMENT_PRIORITY: Record<PageType, number> = {
  services: 0,
  projects: 1,
  partners: 2,
  faq: 3,
  about: 4,
  contact: 5,
  home: 6,
  other: 7,
  ignore: 8
};

const LIST_KEY_OF: Partial<Record<SiteFieldKey, (item: unknown) => string>> = {
  faqs: (item) => (item as { question: string }).question,
  socialLinks: (item) => item as string,
  services: (item) => (item as { name: string }).name,
  projects: (item) => (item as { name: string }).name,
  partners: (item) => (item as { name: string }).name,
  policies: (item) => item as string
};

const SCALAR_KEYS: SiteFieldKey[] = ["businessName", "phone", "category", "contactEmail", "hours", "address", "summary"];

export interface ExtractSiteDraftOptions {
  userAgent?: string;
  /** Overall safety ceiling for the whole job. Default 15 min — this is an async background job, nothing waits on it live. */
  totalBudgetMs?: number;
  /** Budget reserved for phase 1 (crawl + chunk, no LLM) — the thing that actually determines coverage. Default 10 min. */
  crawlBudgetMs?: number;
  perPageTimeoutMs?: number;
  llmCallTimeoutMs?: number;
  /** Safety cap, not a real limiter for a typical small-business site. Default 300. */
  maxPages?: number;
  maxDepth?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  maxChunks?: number;
  llmClient?: LlmClient;
  headlessFetcher?: HeadlessFetcher;
  fetchImpl?: typeof fetch;
  onboardingSessionId?: string;
  onProgress?: (update: { phase: "crawl" | "enrich"; pagesVisited: number; queued: number; currentUrl: string }) => void;
}

interface QueueItem {
  url: string;
  linkText?: string;
  depth: number;
}

interface Contribution {
  fields: SitePartialFields;
}

// Bounds one operation (a page fetch, an LLM call) to whichever is
// shorter: its own individual timeout, or however much of the relevant
// budget remains. Without the individual cap, one slow/hanging call could
// consume the entire remaining deadline by itself and starve everything
// else still queued behind it.
function boundedSignal(controller: AbortController, deadline: number, individualTimeoutMs: number): AbortSignal {
  const remaining = Math.max(0, Math.min(individualTimeoutMs, deadline - Date.now()));
  return AbortSignal.any([controller.signal, AbortSignal.timeout(remaining)]);
}

// Dedup key for the `visited` set — www/apex are the same page (sameSite())
// but normalizeUrl() doesn't collapse them, so an exact-string visited-set
// would fetch "example.com/" and "www.example.com/" as two separate pages
// whenever a sitemap's canonical host differs from the seed URL's.
function dedupeKey(url: string): string {
  const u = new URL(url);
  u.hostname = u.hostname.replace(/^www\./i, "");
  return u.toString();
}

function websiteField(normalizedUrl: string): Field<string> {
  return { value: normalizedUrl, source: "structured_data", sourceUrl: normalizedUrl, confidence: "high" };
}

function buildDraft(
  inputUrl: string,
  normalizedUrl: string,
  fields: SiteExtractionFields,
  pages: PageSummary[],
  chunks: Chunk[],
  status: SiteExtractionDraft["status"],
  failureReason?: string
): SiteExtractionDraft {
  return SiteExtractionDraftSchema.parse({
    inputUrl,
    normalizedUrl,
    extractedAt: new Date().toISOString(),
    fields,
    pages,
    chunks,
    status,
    failureReason
  });
}

function validateSiteFields(fields: SitePartialFields, logger: Logger): SiteExtractionFields {
  const result: SitePartialFields = {};
  for (const key of Object.keys(fields) as SiteFieldKey[]) {
    const candidate = fields[key];
    if (!candidate) continue;
    const parsed = SiteFieldValueSchemas[key].safeParse(candidate.value);
    if (!parsed.success) {
      logger.warn({ event: "field_failed_schema_validation", field: key, source: candidate.source });
      continue;
    }
    result[key] = { ...candidate, value: parsed.data } as Field<unknown>;
  }
  return result as SiteExtractionFields;
}

function mergeContributions(contributions: Contribution[], normalizedUrl: string, logger: Logger): SiteExtractionFields {
  const merged: SitePartialFields = {};

  for (const key of SCALAR_KEYS) {
    const found = contributions.find((c) => c.fields[key] !== undefined);
    if (found) merged[key] = found.fields[key];
  }

  for (const [key, keyOf] of Object.entries(LIST_KEY_OF) as Array<[SiteFieldKey, (item: unknown) => string]>) {
    const candidates = contributions
      .map((c) => c.fields[key])
      .filter((f): f is Field<unknown[]> => f !== undefined && Array.isArray(f.value));
    const combined = accumulateListField(candidates, keyOf);
    if (combined) merged[key] = combined as Field<unknown>;
  }

  merged.website = websiteField(normalizedUrl);

  return validateSiteFields(merged, logger);
}

// Section 5/8 parity: extractSiteDraft() only ever produces a draft. Nothing
// here writes to a ChunkStore or any tenant/agent record — that's
// approveSiteDraft()'s job alone (siteApproval.ts). Never throws: every
// failure mode (invalid URL, robots block, a page 404ing mid-crawl, time or
// page-count exhaustion) degrades to a partial/empty draft instead.
//
// Two phases, deliberately decoupled:
//   Phase 1 (crawl + chunk): fetch every reachable page, classify it
//   heuristically, pull structured data, and chunk its content — no LLM
//   calls, so nothing here can be slowed or starved by LLM latency/rate
//   limits. This is what determines actual knowledge-base coverage.
//   Phase 2 (enrichment): best-effort LLM classification-refinement and
//   field extraction over whatever phase 1 covered, spending whatever
//   budget remains. If it runs out of time partway through, already-chunked
//   pages are unaffected — enrichment not finishing is expected, not an error.
export async function extractSiteDraft(inputUrl: string, options: ExtractSiteDraftOptions = {}): Promise<SiteExtractionDraft> {
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const totalBudgetMs = options.totalBudgetMs ?? DEFAULT_SITE_TOTAL_BUDGET_MS;
  const crawlBudgetMs = options.crawlBudgetMs ?? DEFAULT_SITE_CRAWL_BUDGET_MS;
  const perPageTimeoutMs = options.perPageTimeoutMs ?? DEFAULT_SITE_PER_PAGE_TIMEOUT_MS;
  const llmCallTimeoutMs = options.llmCallTimeoutMs ?? DEFAULT_SITE_LLM_CALL_TIMEOUT_MS;
  const maxPages = options.maxPages ?? DEFAULT_SITE_MAX_PAGES;
  const maxDepth = options.maxDepth ?? DEFAULT_SITE_MAX_DEPTH;
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const maxChunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;

  const logger = createLogger(options.onboardingSessionId);
  const deadline = Date.now() + totalBudgetMs;
  const crawlDeadline = Math.min(deadline, Date.now() + crawlBudgetMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalBudgetMs);

  try {
    let normalizedUrl: string;
    try {
      normalizedUrl = normalizeUrl(inputUrl);
    } catch {
      logger.warn({ event: "invalid_url", inputUrl });
      return buildDraft(inputUrl, inputUrl, {}, [], [], "empty", "invalid_url");
    }

    const seed = new URL(normalizedUrl);
    const origin = seed.origin;
    const hostname = seed.hostname;

    const robots = await loadRobots(origin, { userAgent, signal: controller.signal, fetchImpl: options.fetchImpl, logger });
    if (!robots.isAllowed(normalizedUrl)) {
      logger.warn({ event: "extraction_failed", url: normalizedUrl, reason: "blocked_by_robots" });
      return buildDraft(
        inputUrl,
        normalizedUrl,
        { website: websiteField(normalizedUrl) },
        [],
        [],
        "empty",
        "blocked_by_robots"
      );
    }

    const sitemapUrls = await fetchSitemapUrls(origin, { userAgent, fetchImpl: options.fetchImpl, signal: controller.signal });

    const visited = new Set<string>();
    const queue: QueueItem[] = [{ url: normalizedUrl, depth: 0 }];
    let usableSitemapCount = 0;
    if (sitemapUrls) {
      for (const raw of sitemapUrls) {
        try {
          const normalized = normalizeUrl(raw);
          // Same-site check tolerates a www/apex mismatch between the
          // sitemap's canonical URLs and the seed URL the owner supplied —
          // treating them as different domains would silently drop every
          // sitemap entry on a site that canonicalizes to the other label.
          if (!sameSite(new URL(normalized).hostname, hostname)) continue;
          if (dedupeKey(normalized) === dedupeKey(normalizedUrl)) continue;
          queue.push({ url: normalized, depth: 1 });
          usableSitemapCount++;
        } catch {
          // malformed sitemap entry — skip it, not fatal to the run
        }
      }
    }
    // Only treat the sitemap as authoritative (and skip link-following) if
    // it actually yielded usable, in-scope URLs — a sitemap that exists but
    // filtered down to nothing should fall back to link-following, not
    // leave the crawl with just the seed page.
    const sitemapIsAuthoritative = usableSitemapCount > 0;

    // ---- Phase 1: crawl + chunk (no LLM) ----
    const pages: PageSummary[] = [];
    const pagesParagraphs: Record<string, string[]> = {};
    const structuredByUrl = new Map<string, SitePartialFields>();
    const heuristicByUrl = new Map<string, PageType | "ambiguous">();
    const contributions: Contribution[] = [];
    let truncatedByCoverage = false;

    while (queue.length > 0 && pages.length < maxPages) {
      if (Date.now() >= crawlDeadline) {
        truncatedByCoverage = true;
        logger.warn({ event: "site_extraction_crawl_budget_exceeded", url: normalizedUrl, pagesVisited: pages.length });
        break;
      }

      const next = queue.shift()!;
      const nextKey = dedupeKey(next.url);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);

      if (!robots.isAllowed(next.url)) continue;

      const heuristicType = classifyPage(next.url, next.linkText);
      if (heuristicType === "ignore") continue;

      options.onProgress?.({ phase: "crawl", pagesVisited: pages.length, queued: queue.length, currentUrl: next.url });

      const pageSignal = boundedSignal(controller, crawlDeadline, perPageTimeoutMs);

      let html: string;
      try {
        const fetched = await fetchPage(next.url, {
          userAgent,
          signal: pageSignal,
          fetchImpl: options.fetchImpl,
          launchHeadless: options.headlessFetcher,
          logger
        });
        html = fetched.html;
      } catch (err) {
        pages.push({ url: next.url, pageType: heuristicType === "ambiguous" ? "other" : heuristicType, fetchStatus: "unreachable" });
        logger.warn({ event: "page_fetch_failed", url: next.url, detail: String(err) });
        continue; // one page failing doesn't abort the crawl
      }

      heuristicByUrl.set(next.url, heuristicType);
      pages.push({ url: next.url, pageType: heuristicType === "ambiguous" ? "other" : heuristicType, fetchStatus: "ok" });
      pagesParagraphs[next.url] = extractPageParagraphs(html);

      const structured = extractStructuredData(html, next.url) as SitePartialFields;
      if (Object.keys(structured).length > 0) {
        structuredByUrl.set(next.url, structured);
        contributions.push({ fields: structured });
      }

      // Sitemap is treated as the authoritative page list when it actually
      // yielded usable URLs — don't also follow links (avoids redundant
      // discovery/fetches).
      if (!sitemapIsAuthoritative && next.depth < maxDepth) {
        for (const link of extractPageLinks(html, next.url)) {
          if (visited.has(dedupeKey(link.url))) continue;
          queue.push({ url: link.url, linkText: link.linkText, depth: next.depth + 1 });
        }
      }
    }

    if (queue.length > 0 && pages.length >= maxPages) {
      truncatedByCoverage = true;
      logger.warn({ event: "site_extraction_page_cap_reached", url: normalizedUrl, maxPages });
    }

    // ---- Phase 2: best-effort LLM enrichment ----
    // Spends whatever's left of the overall budget after phase 1. Never
    // reduces coverage — every page phase 1 fetched is already chunked
    // regardless of what happens here.
    const fetchedPages = pages.filter((p) => p.fetchStatus === "ok");
    const enrichmentOrder = [...fetchedPages].sort(
      (a, b) => ENRICHMENT_PRIORITY[a.pageType] - ENRICHMENT_PRIORITY[b.pageType]
    );
    let pagesEnriched = 0;

    if (options.llmClient) {
      for (let i = 0; i < enrichmentOrder.length; i++) {
        if (Date.now() >= deadline) {
          logger.warn({
            event: "site_extraction_enrichment_budget_exceeded",
            url: normalizedUrl,
            pagesEnriched,
            pagesRemaining: enrichmentOrder.length - i
          });
          break;
        }

        const page = enrichmentOrder[i]!;
        const paragraphs = pagesParagraphs[page.url] ?? [];
        options.onProgress?.({
          phase: "enrich",
          pagesVisited: pagesEnriched,
          queued: enrichmentOrder.length - i,
          currentUrl: page.url
        });

        let pageType = page.pageType;
        if (heuristicByUrl.get(page.url) === "ambiguous") {
          pageType = await classifyPageWithLlm({
            client: options.llmClient,
            pageText: joinParagraphs(paragraphs, 2000),
            signal: boundedSignal(controller, deadline, llmCallTimeoutMs),
            logger
          });
          page.pageType = pageType; // refine in place — chunks are built after this phase
        }

        const structured = structuredByUrl.get(page.url) ?? {};
        const focusKeys = (PAGE_TYPE_FOCUS[pageType] ?? []).filter((k) => structured[k] === undefined);
        if (focusKeys.length > 0 && deadline - Date.now() > MIN_LLM_BUDGET_MS) {
          const llmFields = await extractSiteFieldsWithLlm({
            client: options.llmClient,
            pageText: joinParagraphs(paragraphs, 8000),
            focusKeys,
            sourceUrl: page.url,
            signal: boundedSignal(controller, deadline, llmCallTimeoutMs),
            logger
          });
          if (Object.keys(llmFields).length > 0) contributions.push({ fields: llmFields });
        }

        pagesEnriched++;
      }
    }

    // ---- Chunk (uses final, possibly-enrichment-refined page types) ----
    const cleanedParagraphs = removeRepeatedBoilerplate(pagesParagraphs);
    const chunks: Chunk[] = [];
    let chunkBudgetExceeded = false;
    for (const page of pages) {
      if (page.fetchStatus !== "ok") continue;
      const paragraphs = cleanedParagraphs[page.url] ?? [];
      if (paragraphs.length === 0) continue;
      const pieces = chunkText(paragraphs, { size: chunkSize, overlap: chunkOverlap });
      for (let i = 0; i < pieces.length; i++) {
        if (chunks.length >= maxChunks) {
          chunkBudgetExceeded = true;
          break;
        }
        chunks.push({ sourceUrl: page.url, pageType: page.pageType, chunkIndex: i, text: pieces[i]! });
      }
      if (chunkBudgetExceeded) break;
    }
    if (chunkBudgetExceeded) {
      truncatedByCoverage = true;
      logger.warn({ event: "chunk_budget_exceeded", url: normalizedUrl, maxChunks });
    }

    const fields = mergeContributions(contributions, normalizedUrl, logger);
    // Status reflects coverage (did every reachable page get fetched and
    // chunked), not enrichment completeness — partial LLM enrichment is
    // expected behavior, not a degraded result, per the coverage-first design.
    const status: SiteExtractionDraft["status"] = pages.length === 0 ? "empty" : truncatedByCoverage ? "partial" : "ok";

    logger.info({
      event: "site_extraction_complete",
      url: normalizedUrl,
      status,
      pagesVisited: pages.length,
      pagesEnriched,
      chunkCount: chunks.length
    });

    return buildDraft(inputUrl, normalizedUrl, fields, pages, chunks, status);
  } finally {
    clearTimeout(timer);
  }
}
