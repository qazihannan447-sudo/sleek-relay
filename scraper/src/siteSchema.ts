import { z } from "zod";
import { field, FieldValueSchemas, type FieldKey } from "./schema.js";

// Multi-page pipeline's field superset. Deliberately NOT merged into
// schema.ts's FieldValueSchemas/ExtractionFieldsSchema — those stay exactly
// as Section 4 specifies for the existing single-page extractDraft(). This
// is a separate, additive schema for the site-crawl pipeline, reusing the
// same field() envelope so provenance metadata works identically.

const ServiceItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000).optional()
});

const ProjectItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(1000).optional(),
  url: z.string().url().optional()
});

const PartnerItemSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url().optional()
});

// Synthesized prose, not a scraped fact — always llm_inferred at the call
// site (siteExtract.ts enforces this), capped shorter than a fabricated
// "about page" would be, to keep it a summary rather than a copy.
const SummaryValueSchema = z.string().trim().min(1).max(1000);

// Short factual statements ("Returns accepted within 30 days...", "All
// prices include applicable taxes.") — no natural "name" per item the way
// services/projects/partners have, so this is a flat string list like
// socialLinks rather than the {name, description} shape.
const PolicyItemSchema = z.string().trim().min(1).max(300);

export const SiteFieldValueSchemas = {
  ...FieldValueSchemas,
  services: z.array(ServiceItemSchema).min(1),
  projects: z.array(ProjectItemSchema).min(1),
  partners: z.array(PartnerItemSchema).min(1),
  summary: SummaryValueSchema,
  policies: z.array(PolicyItemSchema).min(1)
} as const;

export type SiteFieldKey = keyof typeof SiteFieldValueSchemas;
export const NEW_SITE_FIELD_KEYS = [
  "services",
  "projects",
  "partners",
  "summary",
  "policies"
] as const satisfies readonly SiteFieldKey[];

// FieldKey (from schema.ts) is a subset of SiteFieldKey by construction.
export function isOriginalFieldKey(key: SiteFieldKey): key is FieldKey {
  return key in FieldValueSchemas;
}

export const SiteExtractionFieldsSchema = z.object({
  businessName: field(SiteFieldValueSchemas.businessName).optional(),
  website: field(SiteFieldValueSchemas.website).optional(),
  phone: field(SiteFieldValueSchemas.phone).optional(),
  category: field(SiteFieldValueSchemas.category).optional(),
  contactEmail: field(SiteFieldValueSchemas.contactEmail).optional(),
  hours: field(SiteFieldValueSchemas.hours).optional(),
  faqs: field(SiteFieldValueSchemas.faqs).optional(),
  address: field(SiteFieldValueSchemas.address).optional(),
  socialLinks: field(SiteFieldValueSchemas.socialLinks).optional(),
  services: field(SiteFieldValueSchemas.services).optional(),
  projects: field(SiteFieldValueSchemas.projects).optional(),
  partners: field(SiteFieldValueSchemas.partners).optional(),
  summary: field(SiteFieldValueSchemas.summary).optional(),
  policies: field(SiteFieldValueSchemas.policies).optional()
});
export type SiteExtractionFields = z.infer<typeof SiteExtractionFieldsSchema>;

export const PageTypeSchema = z.enum([
  "home",
  "about",
  "services",
  "projects",
  "partners",
  "faq",
  "contact",
  "other",
  "ignore"
]);
export type PageType = z.infer<typeof PageTypeSchema>;

export const PageSummarySchema = z.object({
  url: z.string().url(),
  pageType: PageTypeSchema,
  fetchStatus: z.enum(["ok", "unreachable", "skipped_robots", "skipped_budget"])
});
export type PageSummary = z.infer<typeof PageSummarySchema>;

export const ChunkSchema = z.object({
  sourceUrl: z.string().url(),
  pageType: PageTypeSchema,
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1)
});
export type Chunk = z.infer<typeof ChunkSchema>;

// Site-level draft. Same hard rule as ExtractionDraftSchema: this is the
// only output of extraction, and nothing here can trigger a write to
// storage — that's approveSiteDraft()'s job alone (siteApproval.ts).
export const SiteExtractionDraftSchema = z.object({
  inputUrl: z.string().url(),
  normalizedUrl: z.string().url(),
  extractedAt: z.string().datetime(),
  fields: SiteExtractionFieldsSchema,
  pages: z.array(PageSummarySchema),
  chunks: z.array(ChunkSchema),
  status: z.enum(["ok", "partial", "empty"]),
  failureReason: z.string().optional()
});
export type SiteExtractionDraft = z.infer<typeof SiteExtractionDraftSchema>;
