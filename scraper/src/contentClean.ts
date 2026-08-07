import * as cheerio from "cheerio";

// Structural stripping before text extraction. Broader than
// structuredData.ts's extractCleanedText (script/style/noscript/svg only) —
// nav/header/footer and cookie-banner-shaped elements are boilerplate too,
// and matter more here since this text gets chunked and stored, not just
// used for one LLM call.
const BOILERPLATE_SELECTOR =
  "nav, header, footer, script, style, noscript, svg, " +
  "[class*='cookie' i], [id*='cookie' i], [class*='consent' i], [id*='consent' i], " +
  "[class*='banner' i], [id*='banner' i]";

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dt, dd";

// Paragraph-level text, preserving block boundaries so chunk.ts can pack
// them without severing sentences mid-thought. Each entry is one cleaned,
// whitespace-collapsed block; empty/boilerplate blocks are dropped.
export function extractPageParagraphs(html: string): string[] {
  const $ = cheerio.load(html);
  $(BOILERPLATE_SELECTOR).remove();

  const seen = new Set<string>();
  const paragraphs: string[] = [];
  $(BLOCK_SELECTOR).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length < 2) return;
    if (seen.has(text)) return; // exact-duplicate blocks on the same page (repeated CTAs etc.)
    seen.add(text);
    paragraphs.push(text);
  });

  // Fallback for pages with no matching block elements (rare, e.g. a single <div> soup).
  if (paragraphs.length === 0) {
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    if (bodyText) paragraphs.push(bodyText);
  }
  return paragraphs;
}

// Single blob for LLM prompt input, capped — same shape as
// structuredData.ts's extractCleanedText but built from the paragraph list
// so the same cleaning pass backs both chunking and LLM extraction.
export function joinParagraphs(paragraphs: string[], maxChars = 8000): string {
  return paragraphs.join(" ").slice(0, maxChars);
}

// Cross-page pass: a paragraph appearing near-identically on most pages of
// the same crawl is almost certainly leftover boilerplate (a CTA block,
// address footer, etc. that structural stripping didn't catch) rather than
// page-specific content.
export function removeRepeatedBoilerplate(pagesParagraphs: Record<string, string[]>): Record<string, string[]> {
  const urls = Object.keys(pagesParagraphs);
  if (urls.length < 3) return pagesParagraphs; // too few pages to detect a repeat pattern reliably

  const counts = new Map<string, number>();
  for (const url of urls) {
    for (const paragraph of new Set(pagesParagraphs[url])) {
      counts.set(paragraph, (counts.get(paragraph) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(urls.length * 0.6); // appears on 60%+ of crawled pages
  const boilerplate = new Set(Array.from(counts.entries()).filter(([, n]) => n >= threshold).map(([p]) => p));

  const result: Record<string, string[]> = {};
  for (const url of urls) {
    result[url] = pagesParagraphs[url]!.filter((p) => !boilerplate.has(p));
  }
  return result;
}
