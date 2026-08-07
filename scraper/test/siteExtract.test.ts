import { describe, expect, it } from "vitest";
import { extractSiteDraft } from "../src/siteExtract.js";
import type { LlmClient } from "../src/llmClient.js";
import { ALLOW_ALL_ROBOTS_TXT, calledUrls, mockFetch, notFoundResponse, textResponse } from "./helpers.js";

const SITE = "https://example-agency.test";
const ROBOTS_URL = `${SITE}/robots.txt`;
const SITEMAP_URL = `${SITE}/sitemap.xml`;

const HOME_HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Agency","telephone":"555-000-1111"}</script>
</head><body>
<nav><a href="/">Home</a><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a></nav>
<a href="/private">Private</a>
<a href="/login">Login</a>
<a href="https://external.test/partner">External Partner</a>
<p>Welcome to Example Agency, a full-service digital agency.</p>
</body></html>`;

const SERVICES_HTML = `<!doctype html><html><body>
<h1>Our Services</h1>
<p>We offer web design and search engine optimization for small businesses.</p>
</body></html>`;

const CONTACT_HTML = `<!doctype html><html><body>
<p>Reach us any time.</p>
<a href="mailto:hello@example-agency.test">Email us</a>
<a href="tel:+15550002222">Call us</a>
</body></html>`;

function baseRoutes() {
  return {
    [ROBOTS_URL]: () => textResponse("User-agent: *\nAllow: /\nDisallow: /private\n"),
    [SITEMAP_URL]: () => notFoundResponse(),
    [`${SITE}/`]: () => textResponse(HOME_HTML),
    [`${SITE}/about`]: () => {
      throw new TypeError("network error");
    },
    [`${SITE}/services`]: () => textResponse(SERVICES_HTML),
    [`${SITE}/contact`]: () => textResponse(CONTACT_HTML),
    [`${SITE}/private`]: () => textResponse("<html><body>should never be fetched</body></html>"),
    [`${SITE}/login`]: () => textResponse("<html><body>should never be fetched</body></html>")
  };
}

const servicesAwareLlmClient: LlmClient = {
  async complete({ userPrompt }) {
    if (userPrompt.includes("services")) {
      return JSON.stringify({ fields: { services: [{ name: "Web Design" }, { name: "SEO" }] } });
    }
    return JSON.stringify({ fields: {} });
  }
};

describe("extractSiteDraft — normal multi-page run", () => {
  it("crawls same-domain pages via link-following, skips ignored/disallowed paths, merges across pages", async () => {
    const fetchImpl = mockFetch(baseRoutes());

    const draft = await extractSiteDraft(SITE, { fetchImpl, llmClient: servicesAwareLlmClient });

    expect(draft.status).toBe("ok");
    expect(draft.fields.businessName?.value).toBe("Example Agency");
    expect(draft.fields.businessName?.source).toBe("structured_data");
    expect(draft.fields.phone?.value).toBe("555-000-1111");
    expect(draft.fields.contactEmail?.value).toBe("hello@example-agency.test");
    expect(draft.fields.services?.value).toEqual([{ name: "Web Design" }, { name: "SEO" }]);
    expect(draft.fields.services?.source).toBe("llm_inferred");

    const visited = calledUrls(fetchImpl);
    expect(visited).not.toContain(`${SITE}/private`);
    expect(visited).not.toContain(`${SITE}/login`);
    expect(visited).not.toContain("https://external.test/partner");
  });

  it("records the unreachable page but continues crawling the rest", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const draft = await extractSiteDraft(SITE, { fetchImpl, llmClient: servicesAwareLlmClient });

    const aboutPage = draft.pages.find((p) => p.url === `${SITE}/about`);
    expect(aboutPage?.fetchStatus).toBe("unreachable");

    const servicesPage = draft.pages.find((p) => p.url === `${SITE}/services`);
    expect(servicesPage?.fetchStatus).toBe("ok");
    expect(servicesPage?.pageType).toBe("services");
  });

  it("produces chunks tagged with source page and page type", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const draft = await extractSiteDraft(SITE, { fetchImpl, llmClient: servicesAwareLlmClient });

    expect(draft.chunks.length).toBeGreaterThan(0);
    const servicesChunk = draft.chunks.find((c) => c.sourceUrl === `${SITE}/services`);
    expect(servicesChunk?.pageType).toBe("services");
    expect(servicesChunk?.text).toContain("web design");
  });
});

describe("extractSiteDraft — page-count budget truncation", () => {
  it("sets status 'partial' when maxPages is reached before the queue empties", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const draft = await extractSiteDraft(SITE, { fetchImpl, llmClient: servicesAwareLlmClient, maxPages: 2 });

    expect(draft.status).toBe("partial");
    expect(draft.pages.length).toBeLessThanOrEqual(2);
  });
});

describe("extractSiteDraft — robots.txt blocks the seed URL entirely", () => {
  it("returns an empty draft without fetching anything", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse("User-agent: *\nDisallow: /\n"),
      [`${SITE}/`]: () => textResponse(HOME_HTML)
    });
    const draft = await extractSiteDraft(SITE, { fetchImpl });

    expect(draft.status).toBe("empty");
    expect(draft.failureReason).toBe("blocked_by_robots");
    expect(calledUrls(fetchImpl)).toEqual([ROBOTS_URL]);
  });
});

describe("extractSiteDraft — no LLM client configured", () => {
  it("still returns a valid, structured-data-only draft", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const draft = await extractSiteDraft(SITE, { fetchImpl });

    expect(draft.status).toBe("ok");
    expect(draft.fields.businessName?.source).toBe("structured_data");
    expect(draft.fields.services).toBeUndefined();
  });
});

// Regression: a real crawl against a www-seeded URL whose sitemap listed
// apex-domain URLs visited the homepage twice ("www.x.test/" and "x.test/"
// as if they were different pages) because the visited-set dedup compared
// exact URL strings instead of a www/apex-normalized key.
describe("extractSiteDraft — www/apex sitemap dedup", () => {
  const WWW_SITE = "https://www.example-agency.test";
  const APEX_SITE = "https://example-agency.test";
  const WWW_ROBOTS_URL = `${WWW_SITE}/robots.txt`;
  const WWW_SITEMAP_URL = `${WWW_SITE}/sitemap.xml`;

  it("does not re-visit the seed page when the sitemap lists it under the apex domain", async () => {
    const sitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${APEX_SITE}/</loc></url>
  <url><loc>${APEX_SITE}/about</loc></url>
</urlset>`;
    const fetchImpl = mockFetch({
      [WWW_ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [WWW_SITEMAP_URL]: () => textResponse(sitemap),
      [`${WWW_SITE}/`]: () => textResponse(HOME_HTML),
      [`${APEX_SITE}/about`]: () => textResponse("<html><body><p>About us.</p></body></html>")
    });

    const draft = await extractSiteDraft(WWW_SITE, { fetchImpl });

    const homeVisits = draft.pages.filter((p) => new URL(p.url).pathname === "/");
    expect(homeVisits).toHaveLength(1);
    expect(draft.pages.map((p) => p.url)).toContain(`${APEX_SITE}/about`);
  });
});

// Regression: a real multi-page run showed LLM latency directly reducing
// how many pages got fetched, because crawling and LLM extraction were
// interleaved in one loop sharing one time budget. Phase 1 (crawl+chunk)
// must now be completely unaffected by how slow or broken the LLM is.
describe("extractSiteDraft — coverage is decoupled from LLM enrichment", () => {
  it("still fetches and chunks every reachable page when the LLM client never resolves", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const hangingLlmClient: LlmClient = {
      complete({ signal }) {
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
    };

    const draft = await extractSiteDraft(SITE, {
      fetchImpl,
      llmClient: hangingLlmClient,
      totalBudgetMs: 1500,
      crawlBudgetMs: 1500,
      llmCallTimeoutMs: 300
    });

    // Phase 1 coverage is intact: home, services, contact all fetched and
    // chunked (about is a genuine fetch failure, not a casualty of the LLM).
    const okPages = draft.pages.filter((p) => p.fetchStatus === "ok");
    expect(okPages.map((p) => p.url).sort()).toEqual([`${SITE}/`, `${SITE}/contact`, `${SITE}/services`].sort());
    expect(draft.chunks.length).toBeGreaterThan(0);
    expect(draft.chunks.some((c) => c.sourceUrl === `${SITE}/services`)).toBe(true);
  });
});

// Regression risk: enrichment is best-effort and may not finish for every
// page, so the pages most likely to yield useful structured facts
// (services/projects/partners/faq) should be processed before generic ones,
// regardless of the order they were crawled in.
describe("extractSiteDraft — enrichment priority order", () => {
  it("enriches a services page before a lower-priority contact/home page, even though it was crawled last", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const promptsInOrder: string[] = [];
    const recordingLlmClient: LlmClient = {
      async complete({ userPrompt }) {
        promptsInOrder.push(userPrompt);
        return JSON.stringify({ fields: {} });
      }
    };

    await extractSiteDraft(SITE, { fetchImpl, llmClient: recordingLlmClient });

    expect(promptsInOrder.length).toBeGreaterThan(0);
    // Crawl order is home, services, contact (about fails and is skipped) —
    // home is visited first and still needs an LLM call (category/summary),
    // so without priority sorting the first prompt would be about home. It
    // must instead be services' prompt (priority 0 beats home's priority 6).
    expect(promptsInOrder[0]).toContain("web design");
  });
});

describe("extractSiteDraft — policies field", () => {
  it("extracts policy statements from a contact/other page as a flat string list", async () => {
    const fetchImpl = mockFetch(baseRoutes());
    const policyAwareLlmClient: LlmClient = {
      async complete({ userPrompt }) {
        if (userPrompt.includes("policies")) {
          return JSON.stringify({
            fields: { policies: ["Returns accepted within 30 days with original receipt.", "All prices include applicable taxes."] }
          });
        }
        return JSON.stringify({ fields: {} });
      }
    };

    const draft = await extractSiteDraft(SITE, { fetchImpl, llmClient: policyAwareLlmClient });

    expect(draft.fields.policies?.source).toBe("llm_inferred");
    expect(draft.fields.policies?.value).toEqual([
      "Returns accepted within 30 days with original receipt.",
      "All prices include applicable taxes."
    ]);
  });
});
