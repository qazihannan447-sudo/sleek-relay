import { describe, expect, it } from "vitest";
import { fetchSitemapUrls, extractPageLinks } from "../src/siteMap.js";
import { mockFetch, textResponse, notFoundResponse } from "./helpers.js";

const SITE = "https://example.test";

describe("fetchSitemapUrls", () => {
  it("parses <url><loc> entries from a plain sitemap", async () => {
    const sitemap = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.test/about</loc></url>
  <url><loc>https://example.test/services</loc></url>
</urlset>`;
    const fetchImpl = mockFetch({ [`${SITE}/sitemap.xml`]: () => textResponse(sitemap) });
    const urls = await fetchSitemapUrls(SITE, { userAgent: "TestBot/1.0", fetchImpl });
    expect(urls).toEqual(["https://example.test/about", "https://example.test/services"]);
  });

  it("returns undefined when there is no sitemap", async () => {
    const fetchImpl = mockFetch({ [`${SITE}/sitemap.xml`]: () => notFoundResponse() });
    const urls = await fetchSitemapUrls(SITE, { userAgent: "TestBot/1.0", fetchImpl });
    expect(urls).toBeUndefined();
  });

  it("returns undefined rather than throwing on malformed XML", async () => {
    const fetchImpl = mockFetch({ [`${SITE}/sitemap.xml`]: () => textResponse("not xml at all") });
    const urls = await fetchSitemapUrls(SITE, { userAgent: "TestBot/1.0", fetchImpl });
    expect(urls).toBeUndefined();
  });
});

describe("extractPageLinks", () => {
  it("extracts same-domain links, deduped and normalized", () => {
    const html = `<html><body>
      <a href="/about">About</a>
      <a href="/about">About again</a>
      <a href="/services">Services</a>
      <a href="https://example.test/contact#footer">Contact</a>
    </body></html>`;
    const links = extractPageLinks(html, `${SITE}/`);
    expect(links.map((l) => l.url)).toEqual([
      "https://example.test/about",
      "https://example.test/services",
      "https://example.test/contact"
    ]);
    expect(links.find((l) => l.url.endsWith("/about"))?.linkText).toBe("About");
  });

  it("filters out cross-domain links", () => {
    const html = `<a href="https://other.test/page">External</a><a href="/local">Local</a>`;
    const links = extractPageLinks(html, `${SITE}/`);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://example.test/local");
  });

  it("filters out non-http(s) links (mailto, tel, javascript)", () => {
    const html = `<a href="mailto:x@example.test">Mail</a><a href="tel:+1234">Call</a><a href="javascript:void(0)">JS</a><a href="/real">Real</a>`;
    const links = extractPageLinks(html, `${SITE}/`);
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe("https://example.test/real");
  });
});
