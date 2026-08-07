import { describe, expect, it } from "vitest";
import { extractDraft } from "../src/extractDraft.js";
import { ALLOW_ALL_ROBOTS_TXT, calledUrls, mockFetch, stubLlmClient, textResponse } from "./helpers.js";

const SITE = "https://example-bakery.test";
const ROBOTS_URL = `${SITE}/robots.txt`;

const HTML_WITH_JSONLD = `
<!doctype html>
<html>
<head>
  <title>Example Bakery</title>
  <meta property="og:site_name" content="Example Bakery" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Example Bakery",
    "telephone": "+1 555-123-4567",
    "email": "hello@example-bakery.test",
    "address": {
      "streetAddress": "123 Main St",
      "addressLocality": "Springfield",
      "addressRegion": "IL",
      "postalCode": "62701"
    },
    "openingHoursSpecification": [
      { "dayOfWeek": "https://schema.org/Monday", "opens": "08:00", "closes": "17:00" }
    ],
    "sameAs": ["https://www.facebook.com/examplebakery"]
  }
  </script>
</head>
<body>
  <p>We are a family-owned bakery. We accept walk-ins and also take custom cake orders.</p>
</body>
</html>`;

const HTML_MINIMAL = `
<!doctype html>
<html><head><title>Plain Site</title></head>
<body><p>Just some unrelated text with no structured markers.</p></body></html>`;

describe("extractDraft — normal extraction", () => {
  it("returns business name and a contact method from JSON-LD, plus LLM-filled category", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML_WITH_JSONLD)
    });
    const llmClient = stubLlmClient([JSON.stringify({ fields: { category: "bakery" } })]);

    const draft = await extractDraft(SITE, { fetchImpl, llmClient });

    expect(draft.status).toBe("ok");
    expect(draft.fields.businessName?.value).toBe("Example Bakery");
    expect(draft.fields.businessName?.source).toBe("structured_data");
    expect(draft.fields.businessName?.confidence).toBe("high");
    expect(draft.fields.phone?.value).toBe("+1 555-123-4567");
    expect(draft.fields.contactEmail?.value).toBe("hello@example-bakery.test");
    expect(draft.fields.address?.value).toContain("Springfield");
    expect(draft.fields.hours?.value).toEqual({ monday: { open: "08:00", close: "17:00" } });
    expect(draft.fields.socialLinks?.value).toEqual(["https://www.facebook.com/examplebakery"]);
    // "@type": "LocalBusiness" is too generic to use as category, so this
    // field is left missing by structured-data extraction and filled by the LLM.
    expect(draft.fields.category?.value).toBe("bakery");
    expect(draft.fields.category?.source).toBe("llm_inferred");
    expect(draft.fields.category?.confidence).toBe("medium");
    expect(draft.fields.website?.value).toBe(`${SITE}/`);
  });
});

describe("extractDraft — JSON-LD only, LLM finds nothing further", () => {
  it("returns only the structured-data fields when no selectors/LLM matches exist", async () => {
    // "@type": "LocalBusiness" is a generic umbrella type, so structured-data
    // extraction deliberately does not surface it as `category` (see structuredData.ts).
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML_WITH_JSONLD)
    });
    // LLM finds nothing extra on the page.
    const llmClient = stubLlmClient([JSON.stringify({ fields: {} })]);

    const draft = await extractDraft(SITE, { fetchImpl, llmClient });

    expect(draft.status).toBe("ok");
    expect(draft.fields.businessName?.source).toBe("structured_data");
    expect(draft.fields.category).toBeUndefined();
    expect(draft.fields.faqs).toBeUndefined();
  });
});

describe("extractDraft — URL unreachable", () => {
  it("returns an empty draft and never throws or blocks", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => {
        throw new TypeError("network error: connection refused");
      }
    });

    const draft = await extractDraft(SITE, { fetchImpl });

    expect(draft.status).toBe("empty");
    expect(draft.failureReason).toBe("url_unreachable");
    expect(draft.fetchedPages).toEqual([]);
    // The trivially-known website field is still populated — no page visit required.
    expect(draft.fields.website?.value).toBe(`${SITE}/`);
    expect(draft.fields.businessName).toBeUndefined();
  });
});

describe("extractDraft — LLM returns malformed JSON", () => {
  it("drops the LLM fields after one retry, keeps structured-data fields, never throws", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML_MINIMAL)
    });
    const llmClient = stubLlmClient(["this is not json {{{", "still not json"]);

    const draft = await extractDraft(SITE, { fetchImpl, llmClient });

    expect(draft.status).toBe("ok");
    expect(llmClient.callCount).toBe(2); // one retry, then give up — never more
    expect(draft.fields.businessName).toBeUndefined();
    expect(draft.fields.category).toBeUndefined();
    // website is always derivable regardless of page content.
    expect(draft.fields.website?.value).toBe(`${SITE}/`);
  });
});

describe("extractDraft — extracted value fails schema validation", () => {
  it("drops just the offending field (malformed phone), keeps the rest of the draft", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML_MINIMAL)
    });
    const llmClient = stubLlmClient([
      JSON.stringify({
        fields: {
          businessName: "Plain Site Co",
          phone: "call us anytime, we love chatting!" // not a phone number -> fails PhoneValueSchema
        }
      })
    ]);

    const draft = await extractDraft(SITE, { fetchImpl, llmClient });

    expect(draft.fields.businessName?.value).toBe("Plain Site Co");
    expect(draft.fields.businessName?.source).toBe("llm_inferred");
    expect(draft.fields.phone).toBeUndefined();
  });
});

describe("extractDraft — robots.txt disallowed path is skipped", () => {
  it("never fetches the page when robots.txt disallows the path", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse("User-agent: *\nDisallow: /\n"),
      [`${SITE}/`]: () => textResponse(HTML_WITH_JSONLD) // would prove a violation if ever called
    });

    const draft = await extractDraft(SITE, { fetchImpl });

    expect(draft.status).toBe("empty");
    expect(draft.failureReason).toBe("blocked_by_robots");
    expect(calledUrls(fetchImpl)).toEqual([ROBOTS_URL]); // page URL never fetched
  });
});

describe("extractDraft — idempotency", () => {
  it("re-running on the same URL produces a fresh, independent draft with no shared state", async () => {
    const fetchImpl = mockFetch({
      [ROBOTS_URL]: () => textResponse(ALLOW_ALL_ROBOTS_TXT),
      [`${SITE}/`]: () => textResponse(HTML_WITH_JSONLD)
    });
    const llmClient = stubLlmClient([JSON.stringify({ fields: {} }), JSON.stringify({ fields: {} })]);

    const first = await extractDraft(SITE, { fetchImpl, llmClient });
    const second = await extractDraft(SITE, { fetchImpl, llmClient });

    expect(first.fields.businessName?.value).toBe(second.fields.businessName?.value);
    expect(first.extractedAt).not.toBe(second.extractedAt);
  });
});
