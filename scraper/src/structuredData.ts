import * as cheerio from "cheerio";
import type { Field, FieldKey } from "./schema.js";
import { resolveUrl } from "./urlUtils.js";

export type PartialFields = Partial<{ [K in FieldKey]: Field<unknown> }>;

// Schema.org has 50+ named LocalBusiness subtypes (Bakery, Plumber,
// ItalianRestaurant, ...) plus arbitrary custom ones — an allowlist of type
// names can't keep up with "arbitrary, unknown site structures" (Section 2).
// Instead, detect a business node by the presence of business-identifying
// signals alongside a name; the @type string itself is only used for the
// (optional, best-effort) `category` field.
const BUSINESS_SIGNAL_KEYS = ["telephone", "email", "address", "openingHoursSpecification", "sameAs"] as const;

function looksLikeBusinessNode(node: unknown): node is Record<string, unknown> {
  if (typeof node !== "object" || node === null) return false;
  const n = node as Record<string, unknown>;
  if (typeof n.name !== "string" || !n.name.trim()) return false;
  return BUSINESS_SIGNAL_KEYS.some((k) => n[k] !== undefined && n[k] !== null && n[k] !== "");
}

const GENERIC_TYPES = new Set(["localbusiness", "organization", "thing", "place"]);
function isGenericType(type: string): boolean {
  return GENERIC_TYPES.has(type.toLowerCase());
}

function high(value: unknown, sourceUrl: string): Field<unknown> {
  return { value, source: "structured_data", sourceUrl, confidence: "high" };
}

function collectJsonLdNodes(html: string): unknown[] {
  const $ = cheerio.load(html);
  const nodes: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw?.trim()) return;
    try {
      const parsed = JSON.parse(raw);
      const graph = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
      for (const node of Array.isArray(graph) ? graph : [graph]) {
        nodes.push(node);
      }
    } catch {
      // Malformed JSON-LD on the page — skip this block, keep scanning others.
    }
  });
  return nodes;
}

function extractHoursFromSpec(spec: unknown): Record<string, { open: string; close: string } | "closed"> | undefined {
  const specs = Array.isArray(spec) ? spec : [spec];
  const dayMap: Record<string, string> = {
    monday: "monday",
    tuesday: "tuesday",
    wednesday: "wednesday",
    thursday: "thursday",
    friday: "friday",
    saturday: "saturday",
    sunday: "sunday"
  };
  const result: Record<string, { open: string; close: string } | "closed"> = {};

  for (const entry of specs) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const days = Array.isArray(e.dayOfWeek) ? e.dayOfWeek : [e.dayOfWeek];
    const opens = typeof e.opens === "string" ? e.opens : undefined;
    const closes = typeof e.closes === "string" ? e.closes : undefined;

    for (const d of days) {
      if (typeof d !== "string") continue;
      const dayName = d.split("/").pop()?.toLowerCase();
      const key = dayName ? dayMap[dayName] : undefined;
      if (!key) continue;
      if (opens && closes) {
        result[key] = { open: opens, close: closes };
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Section 3/8: structured data (JSON-LD/schema.org, Open Graph) — highest
// confidence, cheapest, and takes precedence over LLM inference on merge.
export function extractStructuredData(html: string, sourceUrl: string): PartialFields {
  const fields: PartialFields = {};
  const $ = cheerio.load(html);

  // --- JSON-LD ---
  const businessNode = collectJsonLdNodes(html).find(looksLikeBusinessNode);

  if (businessNode) {
    if (typeof businessNode.name === "string" && businessNode.name.trim()) {
      fields.businessName = high(businessNode.name.trim(), sourceUrl);
    }
    if (typeof businessNode.telephone === "string" && businessNode.telephone.trim()) {
      fields.phone = high(businessNode.telephone.trim(), sourceUrl);
    }
    if (typeof businessNode.email === "string" && businessNode.email.trim()) {
      fields.contactEmail = high(businessNode.email.trim(), sourceUrl);
    }

    const addr = businessNode.address;
    if (typeof addr === "string" && addr.trim()) {
      fields.address = high(addr.trim(), sourceUrl);
    } else if (typeof addr === "object" && addr !== null) {
      const a = addr as Record<string, unknown>;
      const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim());
      if (parts.length > 0) {
        fields.address = high(parts.join(", "), sourceUrl);
      }
    }

    // "@type" is only a useful category when it's more specific than the
    // umbrella LocalBusiness/Organization types (e.g. "ItalianRestaurant" is
    // useful, "LocalBusiness" is not) — otherwise leave it for the LLM pass.
    if (typeof businessNode["@type"] === "string" && !isGenericType(businessNode["@type"])) {
      fields.category = high(businessNode["@type"] as string, sourceUrl);
    }

    const hours = businessNode.openingHoursSpecification;
    if (hours) {
      const parsedHours = extractHoursFromSpec(hours);
      if (parsedHours) {
        fields.hours = high(parsedHours, sourceUrl);
      }
    }

    const sameAs = businessNode.sameAs;
    if (sameAs) {
      const links = (Array.isArray(sameAs) ? sameAs : [sameAs]).filter(
        (l): l is string => typeof l === "string" && l.trim().length > 0
      );
      if (links.length > 0) {
        fields.socialLinks = high(links, sourceUrl);
      }
    }
  }

  // --- Open Graph (fills gaps only; JSON-LD already wins within this layer) ---
  if (!fields.businessName) {
    const ogTitle = $('meta[property="og:site_name"]').attr("content") ?? $('meta[property="og:title"]').attr("content");
    if (ogTitle?.trim()) {
      fields.businessName = high(ogTitle.trim(), sourceUrl);
    }
  }

  // --- Common hrefs for social links (mailto:/tel: and known social domains) ---
  if (!fields.contactEmail) {
    const mailHref = $('a[href^="mailto:"]').first().attr("href");
    if (mailHref) {
      const email = mailHref.replace(/^mailto:/i, "").split("?")[0]?.trim();
      if (email) fields.contactEmail = high(email, sourceUrl);
    }
  }
  if (!fields.phone) {
    const telHref = $('a[href^="tel:"]').first().attr("href");
    if (telHref) {
      const phone = telHref.replace(/^tel:/i, "").trim();
      if (phone) fields.phone = high(phone, sourceUrl);
    }
  }
  if (!fields.socialLinks) {
    const socialDomains = /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|tiktok\.com|youtube\.com/i;
    const links = new Set<string>();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (href && socialDomains.test(href)) {
        const resolved = resolveUrl(sourceUrl, href);
        if (resolved) links.add(resolved);
      }
    });
    if (links.size > 0) {
      fields.socialLinks = high(Array.from(links), sourceUrl);
    }
  }

  return fields;
}

// Cleaned, tag-stripped visible text for the LLM input — separate from the
// structured-data pass so the LLM step never sees markup, only prose.
export function extractCleanedText(html: string, maxChars = 8000): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, maxChars);
}
