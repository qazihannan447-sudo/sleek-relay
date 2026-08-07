import type { Field, FieldKey } from "./schema.js";
import { FieldValueSchemas } from "./schema.js";
import type { SiteFieldKey, PageType } from "./siteSchema.js";
import { SiteFieldValueSchemas } from "./siteSchema.js";
import type { LlmClient } from "./llmClient.js";
import type { Logger } from "./logger.js";
import type { PartialFields } from "./structuredData.js";

const SYSTEM_PROMPT = `You extract business-profile facts from the text of a single small-business website page.
Return ONLY a JSON object of the form {"fields": {...}}. Each key you include must be one of: businessName, phone, category, contactEmail, hours, faqs, address, socialLinks, services, projects, partners, summary, policies.
Only include a field if the page text directly and explicitly supports it. Never invent, guess, or infer a value that isn't stated or clearly implied by explicit content (e.g. "we accept walk-ins" counts as a FAQ-worthy fact; assuming standard business hours because none were mentioned does not).
For "services": array of {"name", optional "description"} for offerings explicitly listed.
For "projects": array of {"name", optional "description", optional "url"} for portfolio/case-study items explicitly listed.
For "partners": array of {"name", optional "url"} for partners/affiliations explicitly listed.
For "summary": write a short (2-3 sentence) neutral overview based only on this page's content, if there's enough to summarize.
For "policies": array of short factual policy statements explicitly stated on the page.
If nothing on the page supports a field, omit its key entirely. Return no commentary, only the JSON object.`;

function buildUserPrompt(pageText: string, missingKeys: FieldKey[]): string {
  return `Fields to look for (only include ones the text actually supports): ${missingKeys.join(", ")}\n\nPage text:\n"""\n${pageText}\n"""`;
}

export interface LlmExtractOptions {
  client: LlmClient;
  pageText: string;
  missingKeys: FieldKey[];
  sourceUrl: string;
  signal?: AbortSignal;
  logger?: Logger;
}

function inferConfidence(key: FieldKey): "medium" | "low" {
  // Fields usually stated as discrete facts (name, phone, email, address,
  // category, named services) get "medium"; fields reconstructed from freer
  // prose (faqs, hours, summary, policies) carry more interpretive leeway.
  return key === "faqs" || key === "hours" || key === "summary" || key === "policies"
    ? "low"
    : "medium";
}

// Pulls raw candidate values out of the LLM's JSON response. Deliberately
// does NOT validate value shapes here — that's a separate, uniform pass
// (validate.ts) applied to the merged draft regardless of source, per
// Section 8 step 5. This function's only job is coping with a
// structurally-malformed response (Section 7 row: "malformed/non-schema JSON").
function coerceToFields(parsed: unknown, sourceUrl: string): PartialFields {
  const result: PartialFields = {};
  if (typeof parsed !== "object" || parsed === null || !("fields" in parsed)) {
    throw new Error("response missing top-level \"fields\" object");
  }
  const fields = (parsed as Record<string, unknown>).fields;
  if (typeof fields !== "object" || fields === null) {
    throw new Error("\"fields\" is not an object");
  }

  for (const [key, rawValue] of Object.entries(fields as Record<string, unknown>)) {
    if (!(key in FieldValueSchemas)) continue; // unknown key from the model — ignore, not fatal
    const fieldKey = key as FieldKey;
    result[fieldKey] = {
      value: rawValue,
      source: "llm_inferred",
      sourceUrl,
      confidence: inferConfidence(fieldKey)
    } as Field<unknown>;
  }
  return result;
}

// Section 7: "LLM returns malformed/non-schema JSON -> discard, do not retry
// more than once, fall back to omitting the field." One retry (two attempts
// total), then give up on this pass entirely and return no LLM fields —
// structured-data fields already found are untouched by this failure.
export async function extractWithLlm(opts: LlmExtractOptions): Promise<PartialFields> {
  if (opts.missingKeys.length === 0) return {};

  const userPrompt = buildUserPrompt(opts.pageText, opts.missingKeys);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string;
    try {
      raw = await opts.client.complete({ systemPrompt: SYSTEM_PROMPT, userPrompt, signal: opts.signal });
    } catch (err) {
      lastError = err;
      opts.logger?.warn({ event: "llm_call_failed", attempt, detail: String(err) });
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      return coerceToFields(parsed, opts.sourceUrl);
    } catch (err) {
      lastError = err;
      opts.logger?.warn({ event: "llm_json_malformed", attempt, detail: String(err) });
    }
  }

  opts.logger?.warn({ event: "llm_extraction_abandoned", detail: String(lastError) });
  return {};
}

// --- Page classification fallback (siteExtract.ts) ---
// Only called for pages classifyPage()'s URL/nav-text heuristics couldn't
// confidently label. Lower-stakes than field extraction (a misclassified
// page just gets the wrong LLM focus-key set, not wrong data shown to the
// owner), so this is a single attempt with a safe "other" fallback rather
// than the Section-7 retry-once contract used for field extraction above.

const PAGE_TYPES = ["home", "about", "services", "projects", "partners", "faq", "contact", "other"] as const;

const CLASSIFY_SYSTEM_PROMPT = `Classify a single web page from a small-business website into exactly one category.
Categories: home, about, services, projects, partners, faq, contact, other.
Respond with ONLY a JSON object: {"pageType": "<one of the categories>"}. No commentary.`;

export interface ClassifyPageWithLlmOptions {
  client: LlmClient;
  pageText: string;
  signal?: AbortSignal;
  logger?: Logger;
}

export async function classifyPageWithLlm(opts: ClassifyPageWithLlmOptions): Promise<PageType> {
  try {
    const raw = await opts.client.complete({
      systemPrompt: CLASSIFY_SYSTEM_PROMPT,
      userPrompt: `Page text:\n"""\n${opts.pageText}\n"""`,
      signal: opts.signal
    });
    const parsed: unknown = JSON.parse(raw);
    const pageType =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).pageType : undefined;
    if (typeof pageType === "string" && (PAGE_TYPES as readonly string[]).includes(pageType)) {
      return pageType as PageType;
    }
  } catch (err) {
    opts.logger?.warn({ event: "llm_page_classification_failed", detail: String(err) });
  }
  return "other";
}

// --- Site pipeline variant (siteExtract.ts) ---
// Same retry-once/malformed-JSON handling as extractWithLlm above, but
// targets the larger site field superset (siteSchema.ts) and is scoped per
// call to just the fields relevant to one page's classified type (e.g. only
// ask about `services` on a page classified "services"), keeping prompts —
// and cost — roughly flat regardless of how many pages get crawled.

const SITE_SYSTEM_PROMPT = `You extract business-profile facts from the text of one page of a small-business website.
Return ONLY a JSON object of the form {"fields": {...}}. Only include keys from the requested list below.
Only include a field if the page text directly and explicitly supports it. Never invent, guess, or infer a value that isn't stated or clearly implied by explicit content.
For "summary": write a short (2-3 sentence) neutral overview of the business based only on this page's content, if there's enough to summarize.
If nothing on the page supports a field, omit its key entirely. Return no commentary, only the JSON object.`;

function buildSiteUserPrompt(pageText: string, focusKeys: SiteFieldKey[]): string {
  return `Fields to look for on this page (only include ones the text actually supports): ${focusKeys.join(", ")}\n\nPage text:\n"""\n${pageText}\n"""`;
}

export type SitePartialFields = Partial<Record<SiteFieldKey, Field<unknown>>>;

export interface SiteLlmExtractOptions {
  client: LlmClient;
  pageText: string;
  focusKeys: SiteFieldKey[];
  sourceUrl: string;
  signal?: AbortSignal;
  logger?: Logger;
}

function siteFieldConfidence(key: SiteFieldKey): "medium" | "low" {
  // "summary" is synthesized prose, never a scraped fact — always capped at
  // the low end regardless of how confident the model sounds.
  return key === "faqs" || key === "hours" || key === "summary" ? "low" : "medium";
}

function coerceToSiteFields(parsed: unknown, sourceUrl: string): SitePartialFields {
  const result: SitePartialFields = {};
  if (typeof parsed !== "object" || parsed === null || !("fields" in parsed)) {
    throw new Error('response missing top-level "fields" object');
  }
  const fields = (parsed as Record<string, unknown>).fields;
  if (typeof fields !== "object" || fields === null) {
    throw new Error('"fields" is not an object');
  }

  for (const [key, rawValue] of Object.entries(fields as Record<string, unknown>)) {
    if (!(key in SiteFieldValueSchemas)) continue;
    const fieldKey = key as SiteFieldKey;
    result[fieldKey] = {
      value: rawValue,
      source: "llm_inferred",
      sourceUrl,
      confidence: siteFieldConfidence(fieldKey)
    } as Field<unknown>;
  }
  return result;
}

export async function extractSiteFieldsWithLlm(opts: SiteLlmExtractOptions): Promise<SitePartialFields> {
  if (opts.focusKeys.length === 0) return {};

  const userPrompt = buildSiteUserPrompt(opts.pageText, opts.focusKeys);
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string;
    try {
      raw = await opts.client.complete({ systemPrompt: SITE_SYSTEM_PROMPT, userPrompt, signal: opts.signal });
    } catch (err) {
      lastError = err;
      opts.logger?.warn({ event: "llm_call_failed", attempt, detail: String(err) });
      continue;
    }

    try {
      const parsed = JSON.parse(raw);
      return coerceToSiteFields(parsed, opts.sourceUrl);
    } catch (err) {
      lastError = err;
      opts.logger?.warn({ event: "llm_json_malformed", attempt, detail: String(err) });
    }
  }

  opts.logger?.warn({ event: "llm_extraction_abandoned", detail: String(lastError) });
  return {};
}
