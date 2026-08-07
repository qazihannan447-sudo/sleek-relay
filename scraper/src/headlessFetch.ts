import type { HeadlessFetcher } from "./fetchPage.js";

// Lazily imports playwright so packages that never hit the JS-shell fallback
// path (and test runs that inject a mock fetcher) don't pay for a browser
// binary. Section 9: this only ever drives the single supplied business URL
// — it is a rendering step, not a general "give an agent internet access"
// tool, and stores no credentials.
export const playwrightHeadlessFetch: HeadlessFetcher = async (url, { userAgent, signal }) => {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();

    const onAbort = () => page.close().catch(() => undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await page.goto(url, { waitUntil: "networkidle" });
      return await page.content();
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  } finally {
    await browser.close();
  }
};
